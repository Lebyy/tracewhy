use crate::compare::load_manifest;
use crate::fs_security::{create_new_private_file, create_private_directory, replace_file};
use crate::model::SCHEMA_VERSION;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tar::{Archive, Builder, Header, HeaderMode};

const MAX_COMPRESSED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 8;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_EVENTS_BYTES: u64 = 32 * 1024 * 1024;
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
const BUNDLE_FILES: [&str; 4] = ["manifest.json", "events.jsonl", "stdout.log", "stderr.log"];

pub fn pack_recording(source: &Path, output: &Path) -> Result<(), String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = temporary_output(output);
    let result = pack_recording_to(source, &temporary);
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    replace_file(&temporary, output)
        .map_err(|error| format!("Cannot move bundle to {}: {error}", output.display()))
}

fn pack_recording_to(source: &Path, output: &Path) -> Result<(), String> {
    let file = create_new_private_file(output)
        .map_err(|error| format!("Cannot create {}: {error}", output.display()))?;
    let encoder = GzEncoder::new(file, Compression::best());
    let mut archive = Builder::new(encoder);
    archive.mode(HeaderMode::Deterministic);
    for name in BUNDLE_FILES {
        let path = source.join(name);
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!(
                "Bundle source is not a regular file: {}",
                path.display()
            ));
        }
        enforce_entry_size(name, metadata.len())?;
        let mut input = File::open(&path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        let mut header = Header::new_gnu();
        header.set_size(metadata.len());
        header.set_mode(0o600);
        header.set_uid(0);
        header.set_gid(0);
        header.set_mtime(0);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        archive
            .append_data(&mut header, name, &mut input)
            .map_err(|error| format!("Cannot add {name} to bundle: {error}"))?;
    }
    let encoder = archive
        .into_inner()
        .map_err(|error| format!("Cannot finish bundle: {error}"))?;
    let file = encoder
        .finish()
        .map_err(|error| format!("Cannot compress bundle: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Cannot flush {}: {error}", output.display()))
}

pub fn extract_bundle(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::metadata(archive_path)
        .map_err(|error| format!("Cannot read {}: {error}", archive_path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "Bundle is not a regular file: {}",
            archive_path.display()
        ));
    }
    if metadata.len() > MAX_COMPRESSED_BYTES {
        return Err(format!(
            "Bundle is {} bytes; the maximum is {MAX_COMPRESSED_BYTES} bytes.",
            metadata.len()
        ));
    }
    create_private_directory(destination)
        .map_err(|error| format!("Cannot create {}: {error}", destination.display()))?;
    let result = extract_bundle_into(archive_path, destination);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(destination);
        return Err(error);
    }
    Ok(())
}

fn extract_bundle_into(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|error| format!("Cannot read {}: {error}", archive_path.display()))?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let entries = archive
        .entries()
        .map_err(|error| format!("Cannot read bundle: {error}"))?;
    let mut seen = BTreeSet::new();
    let mut entry_count = 0;
    // Bundles are untrusted: admit only flat, allowlisted regular files with bounded sizes.
    for entry in entries {
        entry_count += 1;
        if entry_count > MAX_ENTRIES {
            return Err(format!("Bundle contains more than {MAX_ENTRIES} entries."));
        }
        let mut entry = entry.map_err(|error| format!("Cannot read bundle entry: {error}"))?;
        if !entry.header().entry_type().is_file() {
            return Err("Bundle entries must be regular files.".into());
        }
        let path = entry
            .path()
            .map_err(|error| format!("Bundle contains an invalid path: {error}"))?;
        let name = validated_entry_name(&path)?.to_owned();
        if !seen.insert(name.clone()) {
            return Err(format!("Bundle contains duplicate entry: {name}"));
        }
        let size = entry.size();
        enforce_entry_size(&name, size)?;
        let output_path = destination.join(&name);
        let mut output = create_new_private_file(&output_path)
            .map_err(|error| format!("Cannot create {}: {error}", output_path.display()))?;
        let copied = io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract {name}: {error}"))?;
        if copied != size {
            return Err(format!(
                "Bundle entry {name} ended before its declared size."
            ));
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot flush {}: {error}", output_path.display()))?;
    }
    for required in ["manifest.json", "events.jsonl"] {
        if !seen.contains(required) {
            return Err(format!("Bundle is missing {required}."));
        }
    }
    let manifest = load_manifest(destination)?;
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Bundle schema {} is incompatible with schema {SCHEMA_VERSION}.",
            manifest.schema_version
        ));
    }
    Ok(())
}

fn validated_entry_name(path: &Path) -> Result<&str, String> {
    let mut name = None;
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(value) if name.is_none() => {
                name = value.to_str();
                if name.is_none() {
                    return Err("Bundle paths must be valid UTF-8.".into());
                }
            }
            _ => return Err(format!("Bundle path is not allowed: {}", path.display())),
        }
    }
    let name = name.ok_or_else(|| "Bundle contains an empty path.".to_string())?;
    if !BUNDLE_FILES.contains(&name) {
        return Err(format!("Bundle contains an unexpected file: {name}"));
    }
    Ok(name)
}

fn enforce_entry_size(name: &str, size: u64) -> Result<(), String> {
    let maximum = match name {
        "manifest.json" => MAX_MANIFEST_BYTES,
        "events.jsonl" => MAX_EVENTS_BYTES,
        "stdout.log" | "stderr.log" => MAX_LOG_BYTES,
        _ => return Err(format!("Bundle contains an unexpected file: {name}")),
    };
    if size > maximum {
        return Err(format!(
            "Bundle entry {name} is {size} bytes; the maximum is {maximum} bytes."
        ));
    }
    Ok(())
}

fn temporary_output(output: &Path) -> PathBuf {
    let mut name = output.as_os_str().to_os_string();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    name.push(format!(".tmp-{}-{nonce}", std::process::id()));
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("tracewhy-{name}-{}-{nonce}", std::process::id()))
    }

    fn recording_fixture(path: &Path) {
        fs::create_dir(path).expect("fixture directory must be created");
        let manifest = serde_json::json!({
            "schema_version": 1,
            "tracewhy_version": "1.0.0",
            "recording_id": "r",
            "name": "r",
            "started_at": "2026-01-01T00:00:00Z",
            "duration_ms": 1,
            "command": "true",
            "args": [],
            "cwd": "$PROJECT",
            "exit": { "code": 0, "success": true },
            "system": { "platform": "linux", "kernel": "test", "architecture": "x64" },
            "environment": {},
            "output": {
                "stdout_bytes": 0,
                "stderr_bytes": 0,
                "stdout_truncated": false,
                "stderr_truncated": false
            },
            "warnings": [],
            "completeness": {
                "trace_complete": true,
                "parser_unparsed_lines": 0,
                "processes_may_have_escaped": false
            }
        });
        fs::write(
            path.join("manifest.json"),
            serde_json::to_vec(&manifest).expect("manifest must serialize"),
        )
        .expect("manifest must be written");
        fs::write(path.join("events.jsonl"), "").expect("events must be written");
        fs::write(path.join("stdout.log"), "").expect("stdout must be written");
        fs::write(path.join("stderr.log"), "").expect("stderr must be written");
    }

    #[test]
    fn round_trips_a_recording() {
        let root = temporary("bundle-roundtrip");
        let source = root.join("source");
        let output = root.join("recording.tracewhy");
        let extracted = root.join("extracted");
        fs::create_dir(&root).expect("test root must be created");
        recording_fixture(&source);

        pack_recording(&source, &output).expect("recording must pack");
        extract_bundle(&output, &extracted).expect("recording must extract");

        assert!(extracted.join("manifest.json").is_file());
        assert!(extracted.join("events.jsonl").is_file());
        fs::remove_dir_all(root).expect("test root must be removed");
    }

    #[test]
    fn rejects_parent_directory_paths() {
        let root = temporary("bundle-traversal");
        let output = root.join("malicious.tracewhy");
        let extracted = root.join("extracted");
        fs::create_dir(&root).expect("test root must be created");
        let file = File::create(&output).expect("archive must be created");
        let mut encoder = GzEncoder::new(file, Compression::fast());
        let mut header = Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o600);
        header.set_entry_type(tar::EntryType::Regular);
        header.as_mut_bytes()[..13].copy_from_slice(b"../escape.txt");
        header.set_cksum();
        encoder
            .write_all(header.as_bytes())
            .expect("header must be written");
        encoder
            .write_all(&[0; 1024])
            .expect("archive terminator must be written");
        encoder.finish().expect("archive must finish");

        let error = extract_bundle(&output, &extracted).expect_err("traversal must be rejected");
        assert!(error.contains("not allowed"));
        assert!(!root.join("escape.txt").exists());
        fs::remove_dir_all(root).expect("test root must be removed");
    }

    #[test]
    fn rejects_non_regular_entries() {
        let root = temporary("bundle-symlink");
        let output = root.join("malicious.tracewhy");
        let extracted = root.join("extracted");
        fs::create_dir(&root).expect("test root must be created");
        let file = File::create(&output).expect("archive must be created");
        let encoder = GzEncoder::new(file, Compression::fast());
        let mut archive = Builder::new(encoder);
        let mut header = Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_cksum();
        archive
            .append_link(&mut header, "manifest.json", "/etc/passwd")
            .expect("link must be added");
        let encoder = archive.into_inner().expect("archive must finish");
        encoder.finish().expect("compression must finish");

        let error = extract_bundle(&output, &extracted).expect_err("symlink must be rejected");
        assert!(error.contains("regular files"));
        fs::remove_dir_all(root).expect("test root must be removed");
    }

    #[test]
    fn rejects_duplicate_entries() {
        let root = temporary("bundle-duplicate");
        let output = root.join("malicious.tracewhy");
        let extracted = root.join("extracted");
        fs::create_dir(&root).expect("test root must be created");
        let file = File::create(&output).expect("archive must be created");
        let encoder = GzEncoder::new(file, Compression::fast());
        let mut archive = Builder::new(encoder);
        for _ in 0..2 {
            let mut header = Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_size(0);
            header.set_mode(0o600);
            header.set_cksum();
            archive
                .append_data(&mut header, "manifest.json", io::empty())
                .expect("entry must be added");
        }
        let encoder = archive.into_inner().expect("archive must finish");
        encoder.finish().expect("compression must finish");

        let error = extract_bundle(&output, &extracted).expect_err("duplicate must be rejected");
        assert!(error.contains("duplicate entry"));
        fs::remove_dir_all(root).expect("test root must be removed");
    }

    #[test]
    fn rejects_oversized_entries_before_extraction() {
        let root = temporary("bundle-oversized");
        let output = root.join("malicious.tracewhy");
        let extracted = root.join("extracted");
        fs::create_dir(&root).expect("test root must be created");
        let file = File::create(&output).expect("archive must be created");
        let mut encoder = GzEncoder::new(file, Compression::fast());
        let mut header = Header::new_gnu();
        header
            .set_path("manifest.json")
            .expect("path must be valid");
        header.set_size(MAX_MANIFEST_BYTES + 1);
        header.set_mode(0o600);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        encoder
            .write_all(header.as_bytes())
            .expect("header must be written");
        encoder.finish().expect("compression must finish");

        let error = extract_bundle(&output, &extracted).expect_err("oversized entry must fail");
        assert!(error.contains("maximum"));
        fs::remove_dir_all(root).expect("test root must be removed");
    }
}
