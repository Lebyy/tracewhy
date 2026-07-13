use crate::fs_security::private_file_options;
use crate::model::*;
use crate::normalize::is_runtime_noise;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_EVENTS_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EVENT_LINE_BYTES: usize = 64 * 1024;
const MAX_EVENTS: usize = 250_000;
const MAX_LOG_BYTES: u64 = 4 * 1024 * 1024;
const MAX_FINDINGS: usize = 2_000;

pub fn compare_recordings(good_dir: &Path, bad_dir: &Path) -> Result<Comparison, String> {
    let good_manifest = load_manifest(good_dir)?;
    let bad_manifest = load_manifest(bad_dir)?;
    if good_manifest.schema_version != SCHEMA_VERSION
        || bad_manifest.schema_version != SCHEMA_VERSION
    {
        return Err(format!(
            "Incompatible schema version; this build supports schema {SCHEMA_VERSION}."
        ));
    }
    let good_events = load_events(good_dir)?;
    let bad_events = load_events(bad_dir)?;
    let mut warnings = Vec::new();
    if good_manifest.command != bad_manifest.command {
        warnings.push("The root commands differ materially; findings may be less reliable.".into());
    }
    warnings.extend(
        good_manifest
            .warnings
            .iter()
            .map(|w| format!("Good recording: {w}")),
    );
    warnings.extend(
        bad_manifest
            .warnings
            .iter()
            .map(|w| format!("Bad recording: {w}")),
    );
    let incomplete =
        !good_manifest.completeness.trace_complete || !bad_manifest.completeness.trace_complete;
    if incomplete {
        warnings.push("At least one trace is incomplete; confidence has been reduced.".into());
    }

    let good_stderr = load_optional_log(&good_dir.join("stderr.log"))?;
    let bad_stderr = load_optional_log(&bad_dir.join("stderr.log"))?;
    let mut findings = diagnose(
        &good_manifest,
        &bad_manifest,
        &good_events,
        &bad_events,
        &format!("{good_stderr}\n{bad_stderr}"),
        incomplete,
    );
    if findings.len() == MAX_FINDINGS {
        warnings.push(format!(
            "The comparison reached the {MAX_FINDINGS}-finding limit; repetitive findings may be omitted."
        ));
    }
    findings.sort_by(|a, b| b.score.cmp(&a.score).then(a.finding_id.cmp(&b.finding_id)));
    let ignored_differences = ignored_noise(&good_events, &bad_events);
    let comparison_id = stable_id(&good_manifest.recording_id, &bad_manifest.recording_id);

    Ok(Comparison {
        schema_version: SCHEMA_VERSION,
        tracewhy_version: TRACEWHY_VERSION.into(),
        comparison_id,
        created_at: [
            good_manifest.started_at.as_str(),
            bad_manifest.started_at.as_str(),
        ]
        .into_iter()
        .max()
        .unwrap_or("")
        .to_string(),
        good: RecordingSummary::from(&good_manifest),
        bad: RecordingSummary::from(&bad_manifest),
        findings,
        processes: ProcessSides {
            good: build_processes(&good_events),
            bad: build_processes(&bad_events),
        },
        events: EventSides {
            good: good_events,
            bad: bad_events,
        },
        ignored_differences,
        warnings,
    })
}

pub fn load_manifest(dir: &Path) -> Result<RecordingManifest, String> {
    let path = dir.join("manifest.json");
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Cannot inspect {}: {e}", path.display()))?;
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "{} is {} bytes; the maximum is {MAX_MANIFEST_BYTES} bytes.",
            path.display(),
            metadata.len()
        ));
    }
    let text =
        fs::read_to_string(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("Invalid {}: {e}", path.display()))
}

pub fn load_events(dir: &Path) -> Result<Vec<NormalizedEvent>, String> {
    let path = dir.join("events.jsonl");
    let metadata =
        fs::metadata(&path).map_err(|e| format!("Cannot inspect {}: {e}", path.display()))?;
    if metadata.len() > MAX_EVENTS_BYTES {
        return Err(format!(
            "{} is {} bytes; the maximum is {MAX_EVENTS_BYTES} bytes.",
            path.display(),
            metadata.len()
        ));
    }
    let file = fs::File::open(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let mut events = Vec::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_EVENT_LINE_BYTES {
            return Err(format!(
                "Event at {}:{} exceeds {MAX_EVENT_LINE_BYTES} bytes.",
                path.display(),
                index + 1
            ));
        }
        if events.len() >= MAX_EVENTS {
            return Err(format!(
                "{} contains more than {MAX_EVENTS} events.",
                path.display()
            ));
        }
        let event: NormalizedEvent = serde_json::from_str(&line).map_err(|error| {
            format!("Invalid event at {}:{}: {error}", path.display(), index + 1)
        })?;
        if event.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "Event at {}:{} uses schema {}; expected {SCHEMA_VERSION}.",
                path.display(),
                index + 1,
                event.schema_version
            ));
        }
        events.push(event);
    }
    Ok(events)
}

fn load_optional_log(path: &Path) -> Result<String, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(format!("Cannot inspect {}: {error}", path.display())),
    };
    if metadata.len() > MAX_LOG_BYTES {
        return Err(format!(
            "{} is {} bytes; the maximum is {MAX_LOG_BYTES} bytes.",
            path.display(),
            metadata.len()
        ));
    }
    fs::read_to_string(path).map_err(|error| format!("Cannot read {}: {error}", path.display()))
}

fn diagnose(
    good_manifest: &RecordingManifest,
    bad_manifest: &RecordingManifest,
    good: &[NormalizedEvent],
    bad: &[NormalizedEvent],
    stderr: &str,
    incomplete: bool,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    let cwd_changed = good_manifest.cwd != bad_manifest.cwd;
    direct_resource_findings(&mut findings, good, bad, stderr, incomplete, cwd_changed);
    executable_findings(&mut findings, good, bad, incomplete);
    cwd_finding(
        &mut findings,
        good_manifest,
        bad_manifest,
        good,
        bad,
        incomplete,
    );
    environment_findings(&mut findings, good_manifest, bad_manifest, incomplete);
    child_findings(
        &mut findings,
        good_manifest,
        bad_manifest,
        good,
        bad,
        incomplete,
    );
    findings
}

fn direct_resource_findings(
    findings: &mut Vec<Finding>,
    good: &[NormalizedEvent],
    bad: &[NormalizedEvent],
    stderr: &str,
    incomplete: bool,
    cwd_changed: bool,
) {
    let good_success: HashMap<(&str, &str), &NormalizedEvent> = good
        .iter()
        .filter(|event| event.result.is_success())
        .filter_map(|event| {
            Some((
                (event.operation.as_str(), event.resource.as_deref()?),
                event,
            ))
        })
        .collect();
    let mut seen_direct = HashSet::new();
    let mut diagnosed_libraries: HashSet<String> = HashSet::new();
    for bad_event in bad.iter().filter(|event| event.result.is_error()) {
        let Some(resource) = bad_event.resource.as_deref() else {
            continue;
        };
        let Some(good_event) = good_success
            .get(&(bad_event.operation.as_str(), resource))
            .copied()
        else {
            continue;
        };
        if cwd_changed && used_relative_path(good_event) && used_relative_path(bad_event) {
            continue;
        }
        let code = bad_event.result.code.as_deref().unwrap_or("UNKNOWN");
        if !seen_direct.insert((bad_event.operation.as_str(), resource, code)) {
            continue;
        }
        let (finding_type, title, base) = match code {
            "ENOENT" | "ENOTDIR" if bad_event.category == "library" => (
                "shared_library_difference",
                format!("Shared library is unavailable: {}", basename(resource)),
                75,
            ),
            "ENOENT" | "ENOTDIR" => (
                "missing_file",
                format!("File or directory is missing: {}", basename(resource)),
                75,
            ),
            "EACCES" | "EPERM" => (
                "permission_problem",
                format!("Permission blocks access to {}", basename(resource)),
                75,
            ),
            _ => continue,
        };
        let mut score = base;
        let mut reasons = vec![
            "The operation succeeds in the good run and fails in the bad run.".into(),
            format!("The bad run returned {code}."),
        ];
        if stderr.contains(basename(resource)) {
            score += 20;
            reasons.push("The resource is referenced in captured error output.".into());
        }
        if incomplete {
            score -= 25;
            reasons.push("Confidence reduced because a trace is incomplete.".into());
        }
        let summary = format!(
            "{} succeeds for `{resource}` in the good run but returns {code} in the bad run.",
            bad_event.operation
        );
        if finding_type == "shared_library_difference" {
            let library = basename(resource).to_string();
            if !diagnosed_libraries.insert(library) {
                continue;
            }
        }
        add_finding(
            findings,
            make_finding(
                finding_type,
                &format!("{resource}:{}", bad_event.process_id),
                title,
                summary,
                score,
                reasons,
                FindingEvidence::new(
                    vec![good_event.event_id.clone()],
                    vec![bad_event.event_id.clone()],
                ),
            ),
        );
    }

    let good_libs: HashMap<String, &NormalizedEvent> = good
        .iter()
        .filter(|event| event.category == "library" && event.result.is_success())
        .filter(|event| !(cwd_changed && used_relative_path(event)))
        .filter_map(|event| Some((basename(event.resource.as_deref()?).to_string(), event)))
        .collect();
    let mut bad_libs: BTreeMap<String, Vec<&NormalizedEvent>> = BTreeMap::new();
    for event in bad
        .iter()
        .filter(|event| event.category == "library" && event.result.is_error())
        .filter(|event| !(cwd_changed && used_relative_path(event)))
    {
        if let Some(resource) = event.resource.as_deref() {
            bad_libs
                .entry(basename(resource).to_string())
                .or_default()
                .push(event);
        }
    }
    for (library, candidates) in bad_libs {
        if diagnosed_libraries.contains(&library) {
            continue;
        }
        if let Some(good_event) = good_libs.get(&library) {
            let good_resource = good_event.resource.as_deref().unwrap_or(&library);
            // Loaders probe many fallback directories; retain the failed path closest to the
            // successful path so one library produces one representative evidence pair.
            let Some(bad_event) = candidates.into_iter().min_by_key(|event| {
                path_distance(good_resource, event.resource.as_deref().unwrap_or(""))
            }) else {
                continue;
            };
            let resource = bad_event.resource.as_deref().unwrap_or(&library);
            let mut score = 75 - if incomplete { 25 } else { 0 };
            let mut reasons = vec![
                "The library loads in the good run and is missing in the bad run.".into(),
                "The difference is loader-related.".into(),
            ];
            if stderr.contains(&library) {
                score += 20;
                reasons.push("The library is referenced in captured error output.".into());
            }
            diagnosed_libraries.insert(library.clone());
            add_finding(
                findings,
                make_finding(
                    "shared_library_difference",
                    resource,
                    format!("Shared library differs: {library}"),
                    format!(
                        "The good run loads `{good_resource}`, while the bad loader returns {} for `{resource}`.",
                        bad_event.result.code.as_deref().unwrap_or("an error")
                    ),
                    score,
                    reasons,
                    FindingEvidence::new(
                        vec![good_event.event_id.clone()],
                        vec![bad_event.event_id.clone()],
                    ),
                ),
            );
        }
    }
}

fn executable_findings(
    findings: &mut Vec<Finding>,
    good: &[NormalizedEvent],
    bad: &[NormalizedEvent],
    incomplete: bool,
) {
    let good_exec: Vec<_> = good
        .iter()
        .filter(|event| event.category == "executable" && event.result.is_success())
        .collect();
    let bad_exec: Vec<_> = bad
        .iter()
        .filter(|event| event.category == "executable" && event.result.is_success())
        .collect();
    let mut seen = HashSet::new();
    for (index, (g, b)) in good_exec.iter().zip(bad_exec.iter()).enumerate() {
        let (Some(good_path), Some(bad_path)) = (g.resource.as_deref(), b.resource.as_deref())
        else {
            continue;
        };
        if good_path == bad_path {
            continue;
        }
        if !seen.insert((good_path, bad_path)) {
            continue;
        }
        let name = if basename(good_path) == basename(bad_path) {
            basename(good_path)
        } else {
            basename(bad_path)
        };
        let score = 80 - if incomplete { 25 } else { 0 };
        let reasons = vec![
            "Aligned process executions resolve to different executable paths.".into(),
            "The divergence occurs in process execution, before later child behavior.".into(),
        ];
        add_finding(
            findings,
            make_finding(
                "different_executable",
                &format!("{name}:{index}"),
                format!("Different executable selected for {name}"),
                format!(
                    "The good run executes `{good_path}`, while the bad run executes `{bad_path}`."
                ),
                score,
                reasons,
                FindingEvidence::new(vec![g.event_id.clone()], vec![b.event_id.clone()]),
            ),
        );
    }
}

fn child_findings(
    findings: &mut Vec<Finding>,
    good_manifest: &RecordingManifest,
    bad_manifest: &RecordingManifest,
    good: &[NormalizedEvent],
    bad: &[NormalizedEvent],
    incomplete: bool,
) {
    let good_exits = exit_events(good);
    let bad_exits = exit_events(bad);
    for (process, bad_exit) in &bad_exits {
        if process == "p1" {
            continue;
        }
        let Some(good_exit) = good_exits.get(process) else {
            continue;
        };
        if good_exit.result == bad_exit.result {
            continue;
        }
        let score = 75 - if incomplete { 25 } else { 0 };
        let reasons = vec![
            "An aligned child process exits differently between runs.".into(),
            "The difference is attached directly to the failing child.".into(),
        ];
        add_finding(
            findings,
            make_finding(
                "child_process_failure",
                process,
                format!("Child process {process} exits differently"),
                format!(
                    "The good child {}; the bad child {}.",
                    event_exit_description(good_exit),
                    event_exit_description(bad_exit)
                ),
                score,
                reasons,
                FindingEvidence::new(
                    vec![good_exit.event_id.clone()],
                    vec![bad_exit.event_id.clone()],
                ),
            ),
        );
    }
    if good_manifest.exit.success
        && !bad_manifest.exit.success
        && !findings
            .iter()
            .any(|f| f.finding_type != "environment_difference" && f.score >= 75)
    {
        let score = 60 - if incomplete { 25 } else { 0 };
        add_finding(
            findings,
            make_finding(
                "child_process_failure",
                "root",
                "Command exits differently".into(),
                format!(
                    "The good command succeeds, while the bad command {}.",
                    manifest_exit_description(&bad_manifest.exit)
                ),
                score,
                vec!["The root result differs, but the trace does not provide a stronger direct contrast.".into()],
                FindingEvidence::default(),
            ),
        );
    }
}

fn event_exit_description(event: &NormalizedEvent) -> String {
    if let Some(signal) = event.details.get("signal").and_then(|value| value.as_str()) {
        return format!("exits after signal {signal}");
    }
    if let Some(value) = event.result.value.as_deref() {
        return format!("exits with code {value}");
    }
    if let Some(code) = event.result.code.as_deref() {
        return format!("exits with {code}");
    }
    "has an unknown exit result".into()
}

fn manifest_exit_description(exit: &ExitResult) -> String {
    if let Some(signal) = exit.signal.as_deref() {
        return format!("exits after signal {signal}");
    }
    if let Some(code) = exit.code {
        return format!("exits with code {code}");
    }
    "exits unsuccessfully".into()
}

fn exit_events(events: &[NormalizedEvent]) -> BTreeMap<String, &NormalizedEvent> {
    events
        .iter()
        .filter(|event| event.operation == "exit_group")
        .map(|event| (event.process_id.clone(), event))
        .collect()
}

fn cwd_finding(
    findings: &mut Vec<Finding>,
    good_manifest: &RecordingManifest,
    bad_manifest: &RecordingManifest,
    good_events: &[NormalizedEvent],
    bad_events: &[NormalizedEvent],
    incomplete: bool,
) {
    if good_manifest.cwd == bad_manifest.cwd {
        return;
    }
    let good_relative: HashMap<(&str, Option<&str>), &NormalizedEvent> = good_events
        .iter()
        .filter(|event| event.result.is_success() && used_relative_path(event))
        .map(|event| ((event.operation.as_str(), event.resource.as_deref()), event))
        .collect();
    let contrast = bad_events
        .iter()
        .filter(|event| event.result.is_error() && used_relative_path(event))
        .find_map(|bad_event| {
            good_relative
                .get(&(bad_event.operation.as_str(), bad_event.resource.as_deref()))
                .map(|good_event| (*good_event, bad_event))
        });
    let evidence = contrast
        .map(|(good_event, bad_event)| {
            FindingEvidence::new(
                vec![good_event.event_id.clone()],
                vec![bad_event.event_id.clone()],
            )
        })
        .unwrap_or_default();
    let has_contrast = contrast.is_some();
    let mut reasons =
        vec!["Relative files and executable lookups resolve from the working directory.".into()];
    if has_contrast {
        reasons.push(
            "The same relative operation succeeds in the good run and fails in the bad run.".into(),
        );
    }
    add_finding(
        findings,
        make_finding(
            "working_directory_difference",
            "root",
            if has_contrast {
                "A relative path resolves from different directories"
            } else {
                "Commands start in different working directories"
            }
            .into(),
            format!(
                "The good run starts in `{}` and the bad run starts in `{}`.",
                good_manifest.cwd, bad_manifest.cwd
            ),
            (if has_contrast { 85 } else { 65 }) - if incomplete { 25 } else { 0 },
            reasons,
            evidence,
        ),
    );
}

fn used_relative_path(event: &NormalizedEvent) -> bool {
    event
        .details
        .get("path_was_relative")
        .and_then(|value| value.as_bool())
        == Some(true)
}

fn environment_findings(
    findings: &mut Vec<Finding>,
    good: &RecordingManifest,
    bad: &RecordingManifest,
    incomplete: bool,
) {
    const ALLOWLIST: [&str; 8] = [
        "PATH",
        "LD_LIBRARY_PATH",
        "LANG",
        "LC_ALL",
        "NODE_PATH",
        "PYTHONPATH",
        "RUSTUP_TOOLCHAIN",
        "BUN_INSTALL",
    ];
    for key in ALLOWLIST {
        let g = good.environment.get(key);
        let b = bad.environment.get(key);
        if g == b {
            continue;
        }
        add_finding(findings, make_finding(
            "environment_difference", key, format!("Environment variable differs: {key}"),
            format!("`{key}` differs between the good and bad environments and can affect command or resource resolution."),
            50 - if incomplete { 25 } else { 0 },
            vec!["The variable is on TraceWhy's resolution-relevant allowlist.".into()], FindingEvidence::default(),
        ));
    }
}

#[derive(Default)]
struct FindingEvidence {
    good_event_ids: Vec<String>,
    bad_event_ids: Vec<String>,
}

impl FindingEvidence {
    fn new(good_event_ids: Vec<String>, bad_event_ids: Vec<String>) -> Self {
        Self {
            good_event_ids,
            bad_event_ids,
        }
    }
}

fn make_finding(
    finding_type: &str,
    key: &str,
    title: String,
    summary: String,
    score: i32,
    reasons: Vec<String>,
    evidence: FindingEvidence,
) -> Finding {
    let confidence = if score >= 75
        && (!evidence.good_event_ids.is_empty() || !evidence.bad_event_ids.is_empty())
    {
        "high"
    } else if score >= 50 {
        "medium"
    } else {
        "low"
    };
    Finding {
        finding_id: format!("{finding_type}:{}", sanitize_id(key)),
        finding_type: finding_type.into(),
        title,
        classification: if score >= 50 {
            "likely_cause".into()
        } else {
            "supporting_difference".into()
        },
        confidence: confidence.into(),
        score,
        summary,
        reasons,
        good_event_ids: evidence.good_event_ids,
        bad_event_ids: evidence.bad_event_ids,
    }
}

fn add_finding(findings: &mut Vec<Finding>, finding: Finding) {
    if findings.len() < MAX_FINDINGS {
        findings.push(finding);
    }
}

fn build_processes(events: &[NormalizedEvent]) -> Vec<ProcessNode> {
    let mut nodes: BTreeMap<String, ProcessNode> = BTreeMap::new();
    for event in events {
        let node = nodes
            .entry(event.process_id.clone())
            .or_insert_with(|| ProcessNode {
                process_id: event.process_id.clone(),
                parent_process_id: event.parent_process_id.clone(),
                executable: None,
                exit_code: None,
                signal: None,
            });
        if event.category == "executable" && event.result.is_success() {
            node.executable = event.resource.clone();
        }
        if event.operation == "exit_group" {
            node.exit_code = event.result.value.as_deref().and_then(|v| v.parse().ok());
            node.signal = event
                .details
                .get("signal")
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
    }
    nodes.into_values().collect()
}

fn ignored_noise(good: &[NormalizedEvent], bad: &[NormalizedEvent]) -> Vec<IgnoredDifference> {
    let good_keys: BTreeSet<_> = good.iter().map(event_key).collect();
    let bad_keys: BTreeSet<_> = bad.iter().map(event_key).collect();
    let mut ignored = Vec::new();
    for event in good.iter().filter(|event| {
        is_runtime_noise(event.resource.as_deref()) && !bad_keys.contains(&event_key(event))
    }) {
        ignored.push(IgnoredDifference {
            reason: "Known runtime or operating-system noise".into(),
            good_event_id: Some(event.event_id.clone()),
            bad_event_id: None,
        });
    }
    for event in bad.iter().filter(|event| {
        is_runtime_noise(event.resource.as_deref()) && !good_keys.contains(&event_key(event))
    }) {
        ignored.push(IgnoredDifference {
            reason: "Known runtime or operating-system noise".into(),
            good_event_id: None,
            bad_event_id: Some(event.event_id.clone()),
        });
    }
    ignored.truncate(1_000);
    ignored
}

fn event_key(event: &NormalizedEvent) -> String {
    format!(
        "{}|{}|{}|{:?}",
        event.process_id,
        event.operation,
        event.resource.as_deref().unwrap_or(""),
        event.result
    )
}

fn basename(value: &str) -> &str {
    value.rsplit('/').next().unwrap_or(value)
}

fn path_distance(left: &str, right: &str) -> usize {
    let left: Vec<_> = left
        .split('/')
        .filter(|component| !component.is_empty())
        .collect();
    let right: Vec<_> = right
        .split('/')
        .filter(|component| !component.is_empty())
        .collect();
    let common = left
        .iter()
        .zip(&right)
        .take_while(|(left, right)| left == right)
        .count();
    left.len() + right.len() - (common * 2)
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn stable_id(good: &str, bad: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (good, bad).hash(&mut hasher);
    format!("comparison-{:016x}", hasher.finish())
}

pub fn write_events(path: &Path, events: &[NormalizedEvent]) -> io::Result<()> {
    if events.len() > MAX_EVENTS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Recording contains more than {MAX_EVENTS} events."),
        ));
    }
    let file = private_file_options()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)?;
    let mut output = BufWriter::new(file);
    let mut written = 0_u64;
    for event in events {
        let encoded = serde_json::to_vec(event).map_err(io::Error::other)?;
        if encoded.len() > MAX_EVENT_LINE_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Serialized event exceeds {MAX_EVENT_LINE_BYTES} bytes."),
            ));
        }
        written = written
            .checked_add(encoded.len() as u64 + 1)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "Event output size overflowed.")
            })?;
        if written > MAX_EVENTS_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Serialized events exceed {MAX_EVENTS_BYTES} bytes."),
            ));
        }
        output.write_all(&encoded)?;
        output.write_all(b"\n")?;
    }
    output.flush()?;
    output.get_ref().sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(id: &str, resource: &str, result: EventResult, category: &str) -> NormalizedEvent {
        NormalizedEvent {
            schema_version: 1,
            event_id: id.into(),
            process_id: "p1".into(),
            parent_process_id: None,
            sequence: 1,
            category: category.into(),
            operation: "openat".into(),
            resource: Some(resource.into()),
            result,
            details: BTreeMap::new(),
            raw_ref: RawReference {
                file: "trace.1".into(),
                line: 1,
            },
        }
    }

    fn operation_event(
        id: &str,
        process: &str,
        operation: &str,
        resource: Option<&str>,
        result: EventResult,
        category: &str,
    ) -> NormalizedEvent {
        NormalizedEvent {
            schema_version: 1,
            event_id: id.into(),
            process_id: process.into(),
            parent_process_id: (process != "p1").then(|| "p1".into()),
            sequence: 2,
            category: category.into(),
            operation: operation.into(),
            resource: resource.map(str::to_string),
            result,
            details: BTreeMap::new(),
            raw_ref: RawReference {
                file: "trace.1".into(),
                line: 2,
            },
        }
    }

    fn manifest(name: &str, success: bool) -> RecordingManifest {
        RecordingManifest {
            schema_version: 1,
            tracewhy_version: "1.0.0".into(),
            recording_id: name.into(),
            name: name.into(),
            started_at: "2026-01-01T00:00:00Z".into(),
            duration_ms: 1,
            command: "demo".into(),
            args: vec![],
            cwd: "$PROJECT".into(),
            exit: ExitResult {
                code: Some(if success { 0 } else { 1 }),
                signal: None,
                success,
            },
            system: SystemInfo {
                platform: "linux".into(),
                kernel: "test".into(),
                architecture: "x64".into(),
                distribution: None,
                libc: None,
            },
            environment: BTreeMap::new(),
            output: OutputInfo {
                stdout_bytes: 0,
                stderr_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
            },
            warnings: vec![],
            completeness: Completeness {
                trace_complete: true,
                parser_unparsed_lines: 0,
                processes_may_have_escaped: false,
            },
        }
    }

    #[test]
    fn ranks_missing_file_as_high_confidence() {
        let good = vec![event(
            "good:1",
            "$PROJECT/config.json",
            EventResult::success("3"),
            "file",
        )];
        let bad = vec![event(
            "bad:1",
            "$PROJECT/config.json",
            EventResult::error("ENOENT"),
            "file",
        )];
        let findings = diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good,
            &bad,
            "config.json missing",
            false,
        );
        assert_eq!(findings[0].finding_type, "missing_file");
        assert_eq!(findings[0].confidence, "high");
        assert!(findings[0].score >= 75);
    }

    #[test]
    fn incomplete_capture_reduces_confidence() {
        let good = vec![event("good:1", "/x", EventResult::success("3"), "file")];
        let bad = vec![event(
            "bad:1",
            "/x",
            EventResult::error("EACCES"),
            "permission",
        )];
        let findings = diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good,
            &bad,
            "",
            true,
        );
        assert_ne!(findings[0].confidence, "high");
    }

    #[test]
    fn diagnoses_permission_executable_library_and_child_differences() {
        let good_permission = vec![event(
            "good:1",
            "/work/locked",
            EventResult::success("3"),
            "file",
        )];
        let bad_permission = vec![event(
            "bad:1",
            "/work/locked",
            EventResult::error("EACCES"),
            "permission",
        )];
        assert_eq!(
            diagnose(
                &manifest("good", true),
                &manifest("bad", false),
                &good_permission,
                &bad_permission,
                "",
                false
            )[0]
            .finding_type,
            "permission_problem"
        );

        let good_exec = vec![operation_event(
            "good:1",
            "p1",
            "execve",
            Some("/opt/node/bin/node"),
            EventResult::success("0"),
            "executable",
        )];
        let bad_exec = vec![operation_event(
            "bad:1",
            "p1",
            "execve",
            Some("/usr/bin/node"),
            EventResult::success("0"),
            "executable",
        )];
        assert!(diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good_exec,
            &bad_exec,
            "",
            false
        )
        .iter()
        .any(|f| f.finding_type == "different_executable"));

        let good_lib = vec![event(
            "good:1",
            "/good/libdemo.so",
            EventResult::success("3"),
            "library",
        )];
        let bad_lib = vec![event(
            "bad:1",
            "/bad/libdemo.so",
            EventResult::error("ENOENT"),
            "library",
        )];
        assert!(diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good_lib,
            &bad_lib,
            "",
            false
        )
        .iter()
        .any(|f| f.finding_type == "shared_library_difference"));

        let good_child = vec![operation_event(
            "good:1",
            "p2",
            "exit_group",
            None,
            EventResult::success("0"),
            "process",
        )];
        let bad_child = vec![operation_event(
            "bad:1",
            "p2",
            "exit_group",
            None,
            EventResult::success("7"),
            "process",
        )];
        let child_findings = diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good_child,
            &bad_child,
            "",
            false,
        );
        let child_finding = child_findings
            .iter()
            .find(|finding| finding.finding_type == "child_process_failure")
            .expect("child exit difference must be diagnosed");
        assert_eq!(
            child_finding.summary,
            "The good child exits with code 0; the bad child exits with code 7."
        );
    }

    #[test]
    fn deduplicates_loader_search_paths_for_the_same_library() {
        let good = vec![event(
            "good:1",
            "/good/libdemo.so",
            EventResult::success("3"),
            "library",
        )];
        let bad = vec![
            event(
                "bad:1",
                "/bad/tls/aarch64/libdemo.so",
                EventResult::error("ENOENT"),
                "library",
            ),
            event(
                "bad:2",
                "/bad/libdemo.so",
                EventResult::error("ENOENT"),
                "library",
            ),
        ];
        let findings = diagnose(
            &manifest("good", true),
            &manifest("bad", false),
            &good,
            &bad,
            "libdemo.so missing",
            false,
        );
        let library_findings: Vec<_> = findings
            .iter()
            .filter(|finding| finding.finding_type == "shared_library_difference")
            .collect();
        assert_eq!(library_findings.len(), 1);
        assert_eq!(library_findings[0].bad_event_ids, ["bad:2"]);
    }

    #[test]
    fn diagnoses_working_directory_and_allowlisted_environment() {
        let mut good = manifest("good", true);
        let mut bad = manifest("bad", false);
        good.cwd = "/work/good".into();
        bad.cwd = "/work/bad".into();
        good.environment
            .insert("PATH".into(), "/opt/bin:/usr/bin".into());
        bad.environment.insert("PATH".into(), "/usr/bin".into());
        let findings = diagnose(&good, &bad, &[], &[], "", false);
        assert!(findings
            .iter()
            .any(|f| f.finding_type == "working_directory_difference"));
        assert!(findings
            .iter()
            .any(|f| f.finding_type == "environment_difference"));
    }

    #[test]
    fn ranks_relative_path_failure_as_working_directory_difference() {
        let mut good_manifest = manifest("good", true);
        let mut bad_manifest = manifest("bad", false);
        good_manifest.cwd = "/work/good".into();
        bad_manifest.cwd = "/work/bad".into();
        let mut good = vec![event(
            "good:1",
            "$PROJECT/config.json",
            EventResult::success("3"),
            "file",
        )];
        let mut bad = vec![event(
            "bad:1",
            "$PROJECT/config.json",
            EventResult::error("ENOENT"),
            "file",
        )];
        good[0]
            .details
            .insert("path_was_relative".into(), serde_json::Value::Bool(true));
        bad[0]
            .details
            .insert("path_was_relative".into(), serde_json::Value::Bool(true));

        let findings = diagnose(
            &good_manifest,
            &bad_manifest,
            &good,
            &bad,
            "config.json missing",
            false,
        );

        assert_eq!(findings[0].finding_type, "working_directory_difference");
        assert_eq!(findings[0].confidence, "high");
        assert!(!findings
            .iter()
            .any(|finding| finding.finding_type == "missing_file"));
    }
}
