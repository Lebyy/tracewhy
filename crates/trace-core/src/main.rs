use std::env;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use trace_core::bundle::{extract_bundle, pack_recording};
use trace_core::compare::{compare_recordings, write_events};
use trace_core::fs_security::{create_new_private_file, replace_file};
use trace_core::parser::parse_trace_dir;

fn main() {
    if let Err(error) = run() {
        eprintln!("tracewhy-trace-core: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        return Err(usage());
    };
    match command {
        "parse" => {
            let recording = required(&args, "--recording")?;
            let trace_dir = PathBuf::from(required(&args, "--trace-dir")?);
            let output = PathBuf::from(required(&args, "--output")?);
            let home = optional(&args, "--home");
            let root = optional(&args, "--project-root");
            let outcome =
                parse_trace_dir(recording, &trace_dir, home, root).map_err(|e| e.to_string())?;
            write_events(&output, &outcome.events).map_err(|e| e.to_string())?;
            println!(
                "{{\"schema_version\":1,\"events\":{},\"unparsed_lines\":{}}}",
                outcome.events.len(),
                outcome.unparsed_lines
            );
        }
        "compare" => {
            let good = Path::new(required(&args, "--good")?);
            let bad = Path::new(required(&args, "--bad")?);
            let comparison = compare_recordings(good, bad)?;
            if let Some(output) = optional(&args, "--output") {
                write_json_atomic(Path::new(output), &comparison)?;
            } else {
                serde_json::to_writer_pretty(std::io::stdout().lock(), &comparison)
                    .map_err(|e| e.to_string())?;
                println!();
            }
        }
        "pack-bundle" => {
            let source = Path::new(required(&args, "--source")?);
            let output = Path::new(required(&args, "--output")?);
            pack_recording(source, output)?;
        }
        "extract-bundle" => {
            let archive = Path::new(required(&args, "--archive")?);
            let destination = Path::new(required(&args, "--destination")?);
            extract_bundle(archive, destination)?;
        }
        "--version" | "version" => println!("{}", env!("CARGO_PKG_VERSION")),
        _ => return Err(usage()),
    }
    Ok(())
}

fn write_json_atomic<T: serde::Serialize>(output: &Path, value: &T) -> Result<(), String> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let mut temporary_name = output.as_os_str().to_os_string();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    temporary_name.push(format!(".tmp-{}-{nonce}", std::process::id()));
    let temporary = PathBuf::from(temporary_name);
    let result = (|| {
        let file = create_new_private_file(&temporary)
            .map_err(|error| format!("Cannot create {}: {error}", temporary.display()))?;
        let mut writer = BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, value).map_err(|error| error.to_string())?;
        writer.write_all(b"\n").map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
        writer
            .get_ref()
            .sync_all()
            .map_err(|error| format!("Cannot flush {}: {error}", temporary.display()))
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    replace_file(&temporary, output)
        .map_err(|error| format!("Cannot move output to {}: {error}", output.display()))
}

fn required<'a>(args: &'a [String], flag: &str) -> Result<&'a str, String> {
    optional(args, flag).ok_or_else(|| format!("Missing {flag}.\n{}", usage()))
}

fn optional<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter()
        .position(|value| value == flag)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}

fn usage() -> String {
    [
        "Usage: tracewhy-trace-core parse --recording NAME --trace-dir DIR --output FILE [--home DIR --project-root DIR]",
        "       tracewhy-trace-core compare --good DIR --bad DIR [--output FILE]",
        "       tracewhy-trace-core pack-bundle --source DIR --output FILE",
        "       tracewhy-trace-core extract-bundle --archive FILE --destination DIR",
    ]
    .join("\n")
}
