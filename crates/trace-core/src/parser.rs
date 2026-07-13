use crate::model::{EventResult, NormalizedEvent, RawReference, SCHEMA_VERSION};
use crate::normalize::{join_resource, normalize_path};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{self, BufRead, BufReader, Cursor};
use std::path::Path;

const MAX_TRACE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TRACE_FILES: usize = 8_192;
const MAX_TRACE_LINE_BYTES: usize = 64 * 1024;
const MAX_PARSED_EVENTS: usize = 250_000;

#[derive(Clone, Debug)]
struct ParsedLine {
    pid: u32,
    timestamp: f64,
    operation: String,
    resource: Option<String>,
    result: EventResult,
    details: BTreeMap<String, serde_json::Value>,
    raw_file: String,
    raw_line: usize,
}

#[derive(Clone, Debug)]
pub struct ParseOutcome {
    pub events: Vec<NormalizedEvent>,
    pub unparsed_lines: usize,
}

pub fn parse_trace_dir(
    recording: &str,
    trace_dir: &Path,
    home: Option<&str>,
    project_root: Option<&str>,
) -> io::Result<ParseOutcome> {
    let mut files = Vec::new();
    let mut trace_bytes = 0_u64;
    for entry in fs::read_dir(trace_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_file() && entry.file_name().to_string_lossy().starts_with("trace")
        {
            trace_bytes = trace_bytes
                .checked_add(entry.metadata()?.len())
                .ok_or_else(|| invalid_data("Trace size overflowed the supported range."))?;
            if trace_bytes > MAX_TRACE_BYTES {
                return Err(invalid_data(format!(
                    "Trace input exceeds the {MAX_TRACE_BYTES}-byte safety limit."
                )));
            }
            files.push(entry);
            if files.len() > MAX_TRACE_FILES {
                return Err(invalid_data(format!(
                    "Trace input contains more than {MAX_TRACE_FILES} files."
                )));
            }
        }
    }
    files.sort_by_key(|entry| pid_from_filename(&entry.file_name().to_string_lossy()).unwrap_or(0));

    let mut parsed = Vec::new();
    let mut unparsed = 0;
    for entry in files {
        let filename = entry.file_name().to_string_lossy().to_string();
        let pid = pid_from_filename(&filename).unwrap_or(1);
        let file = fs::File::open(entry.path())?;
        let remaining = MAX_PARSED_EVENTS.saturating_sub(parsed.len());
        let (mut lines, missed) = parse_lines(
            pid,
            &filename,
            BoundedLines::new(BufReader::new(file)),
            remaining,
        )?;
        parsed.append(&mut lines);
        unparsed += missed;
    }
    Ok(finalize(recording, parsed, home, project_root, unparsed))
}

pub fn parse_strace_text(recording: &str, pid: u32, text: &str) -> ParseOutcome {
    let (parsed, unparsed) = parse_text(pid, &format!("trace.{pid}"), text);
    finalize(recording, parsed, None, None, unparsed)
}

fn parse_text(pid: u32, filename: &str, text: &str) -> (Vec<ParsedLine>, usize) {
    parse_lines(
        pid,
        filename,
        BoundedLines::new(Cursor::new(text.as_bytes())),
        MAX_PARSED_EVENTS,
    )
    .expect("test trace text must stay within parser limits")
}

fn parse_lines<I>(
    pid: u32,
    filename: &str,
    lines: I,
    event_limit: usize,
) -> io::Result<(Vec<ParsedLine>, usize)>
where
    I: IntoIterator<Item = io::Result<String>>,
{
    let mut parsed = Vec::new();
    let mut unparsed = 0;
    let mut pending: HashMap<String, (String, usize, f64)> = HashMap::new();

    for (index, raw) in lines.into_iter().enumerate() {
        let raw = raw?;
        let line_no = index + 1;
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (timestamp, body) = strip_timestamp(trimmed);

        if body.contains("<unfinished ...>") {
            if let Some(operation) = body.split('(').next().map(str::trim) {
                pending.insert(
                    operation.to_string(),
                    (body.replace("<unfinished ...>", ""), line_no, timestamp),
                );
            }
            continue;
        }

        let (combined, source_line, source_timestamp) =
            if body.starts_with("<...") && body.contains("resumed>") {
                let Some(end) = body.find("resumed>") else {
                    unparsed += 1;
                    continue;
                };
                let operation = body[4..end].trim();
                if let Some((start, original_line, original_ts)) = pending.remove(operation) {
                    (
                        format!("{}{}", start, &body[end + "resumed>".len()..]),
                        original_line,
                        original_ts,
                    )
                } else {
                    unparsed += 1;
                    continue;
                }
            } else {
                (body.to_string(), line_no, timestamp)
            };

        if let Some(line) = parse_complete(pid, filename, source_line, source_timestamp, &combined)
        {
            if parsed.len() >= event_limit {
                return Err(invalid_data(format!(
                    "Trace input contains more than {MAX_PARSED_EVENTS} parsed events."
                )));
            }
            parsed.push(line);
        } else if !combined.starts_with("--- SIG") && !combined.starts_with("strace:") {
            unparsed += 1;
        }
    }
    unparsed += pending.len();
    Ok((parsed, unparsed))
}

struct BoundedLines<R> {
    reader: R,
    finished: bool,
}

impl<R: BufRead> BoundedLines<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            finished: false,
        }
    }
}

impl<R: BufRead> Iterator for BoundedLines<R> {
    type Item = io::Result<String>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.finished {
            return None;
        }
        // Once a line exceeds the cap, consume its remainder without retaining more input.
        let mut bytes = Vec::new();
        let mut exceeded = false;
        let mut saw_data = false;
        loop {
            let available = match self.reader.fill_buf() {
                Ok(available) => available,
                Err(error) => return Some(Err(error)),
            };
            if available.is_empty() {
                self.finished = true;
                if !saw_data {
                    return None;
                }
                break;
            }
            saw_data = true;
            let newline = available.iter().position(|byte| *byte == b'\n');
            let content_length = newline.unwrap_or(available.len());
            if bytes.len() + content_length > MAX_TRACE_LINE_BYTES {
                exceeded = true;
            } else if !exceeded {
                bytes.extend_from_slice(&available[..content_length]);
            }
            let consumed = newline.map_or(available.len(), |position| position + 1);
            self.reader.consume(consumed);
            if newline.is_some() {
                break;
            }
        }
        if exceeded {
            return Some(Err(invalid_data(format!(
                "Trace line exceeds the {MAX_TRACE_LINE_BYTES}-byte safety limit."
            ))));
        }
        Some(
            String::from_utf8(bytes)
                .map_err(|error| invalid_data(format!("Trace input is not valid UTF-8: {error}"))),
        )
    }
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn parse_complete(
    pid: u32,
    filename: &str,
    line_no: usize,
    timestamp: f64,
    body: &str,
) -> Option<ParsedLine> {
    if let Some(exit) = body
        .strip_prefix("+++ exited with ")
        .and_then(|v| v.strip_suffix(" +++"))
    {
        return Some(ParsedLine {
            pid,
            timestamp,
            operation: "exit_group".into(),
            resource: None,
            result: EventResult::success(exit.trim()),
            details: BTreeMap::new(),
            raw_file: filename.into(),
            raw_line: line_no,
        });
    }
    if let Some(signal) = body
        .strip_prefix("+++ killed by ")
        .and_then(|v| v.strip_suffix(" +++"))
    {
        let mut details = BTreeMap::new();
        details.insert("signal".into(), json!(signal.trim()));
        return Some(ParsedLine {
            pid,
            timestamp,
            operation: "exit_group".into(),
            resource: None,
            result: EventResult::error(signal.trim()),
            details,
            raw_file: filename.into(),
            raw_line: line_no,
        });
    }

    let open = body.find('(')?;
    let operation = body[..open].split_whitespace().last()?.to_string();
    if !is_selected_operation(&operation) {
        return None;
    }
    let close = find_closing_paren(body, open)?;
    let args_text = &body[open + 1..close];
    let result_text = body[close + 1..].trim().strip_prefix('=')?.trim();
    let args = split_args(args_text);
    let mut details = BTreeMap::new();
    let resource = resource_for(&operation, &args, &mut details);
    if resource
        .as_deref()
        .is_some_and(|value| !value.starts_with('/'))
    {
        details.insert("path_was_relative".into(), json!(true));
    }
    let result = parse_result(result_text);
    if matches!(operation.as_str(), "clone" | "clone3" | "fork" | "vfork") && result.is_success() {
        if let Some(value) = &result.value {
            details.insert("child_pid".into(), json!(value));
        }
    }

    Some(ParsedLine {
        pid,
        timestamp,
        operation,
        resource,
        result,
        details,
        raw_file: filename.into(),
        raw_line: line_no,
    })
}

fn finalize(
    recording: &str,
    mut parsed: Vec<ParsedLine>,
    home: Option<&str>,
    project_root: Option<&str>,
    unparsed_lines: usize,
) -> ParseOutcome {
    parsed.sort_by(|a, b| {
        a.timestamp
            .total_cmp(&b.timestamp)
            .then(a.pid.cmp(&b.pid))
            .then(a.raw_line.cmp(&b.raw_line))
    });
    parsed.retain(|line| {
        !matches!(line.operation.as_str(), "exit" | "exit_group")
            || line.result.value.as_deref() != Some("?")
    });
    let mut pids: BTreeSet<u32> = parsed.iter().map(|line| line.pid).collect();
    for line in &parsed {
        if let Some(child) = line
            .details
            .get("child_pid")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse().ok())
        {
            pids.insert(child);
        }
    }
    // Stable process identities remove host-specific PIDs while preserving creation order.
    let pid_map: BTreeMap<u32, String> = pids
        .into_iter()
        .enumerate()
        .map(|(i, pid)| (pid, format!("p{}", i + 1)))
        .collect();
    let mut parents: HashMap<u32, u32> = HashMap::new();
    for line in &parsed {
        if let Some(child) = line
            .details
            .get("child_pid")
            .and_then(|v| v.as_str())
            .and_then(|v| v.parse().ok())
        {
            parents.insert(child, line.pid);
        }
    }

    resolve_relative_resources(&mut parsed, project_root.unwrap_or("."));
    let mut events = Vec::with_capacity(parsed.len());
    for (sequence, mut line) in parsed.into_iter().enumerate() {
        normalize_process_references(&mut line, &pid_map);
        let mut resource = line
            .resource
            .map(|value| normalize_path(&value, home, project_root));
        if resource.as_deref() == Some("") {
            resource = None;
        }
        let category = category_for(&line.operation, resource.as_deref(), &line.result);
        let process_id = pid_map
            .get(&line.pid)
            .cloned()
            .unwrap_or_else(|| "p1".into());
        let parent_process_id = parents
            .get(&line.pid)
            .and_then(|pid| pid_map.get(pid))
            .cloned();
        events.push(NormalizedEvent {
            schema_version: SCHEMA_VERSION,
            event_id: format!("{recording}:{}", sequence + 1),
            process_id,
            parent_process_id,
            sequence: sequence + 1,
            category,
            operation: line.operation,
            resource,
            result: line.result,
            details: line.details,
            raw_ref: RawReference {
                file: line.raw_file,
                line: line.raw_line,
            },
        });
    }
    ParseOutcome {
        events,
        unparsed_lines,
    }
}

fn normalize_process_references(line: &mut ParsedLine, pid_map: &BTreeMap<u32, String>) {
    if matches!(
        line.operation.as_str(),
        "clone" | "clone3" | "fork" | "vfork" | "wait4"
    ) {
        if let Some(process_id) = line
            .result
            .value
            .as_deref()
            .and_then(|value| value.parse().ok())
            .and_then(|pid| pid_map.get(&pid))
        {
            line.result.value = Some(process_id.clone());
        }
    }
    if matches!(
        line.operation.as_str(),
        "clone" | "clone3" | "fork" | "vfork"
    ) {
        if let Some(process_id) = line
            .details
            .get("child_pid")
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse().ok())
            .and_then(|pid| pid_map.get(&pid))
        {
            line.details.insert("child_pid".into(), json!(process_id));
        }
    }
}

fn resolve_relative_resources(lines: &mut [ParsedLine], root: &str) {
    // Replay per-process cwd and open descriptors so relative *at paths keep their meaning.
    let mut cwd: HashMap<u32, String> = HashMap::new();
    let mut fds: HashMap<(u32, String), String> = HashMap::new();
    for line in lines {
        let current = cwd
            .entry(line.pid)
            .or_insert_with(|| root.to_string())
            .clone();
        if let Some(resource) = line.resource.clone() {
            let dirfd = line.details.get("dirfd").and_then(|v| v.as_str());
            let resolved = if resource.starts_with('/') {
                resource
            } else if let Some(fd) = dirfd.filter(|fd| *fd != "AT_FDCWD") {
                fds.get(&(line.pid, fd.to_string()))
                    .map(|base| join_resource(base, &resource))
                    .unwrap_or_else(|| join_resource(&current, &resource))
            } else {
                join_resource(&current, &resource)
            };
            line.resource = Some(resolved.clone());
            if line.operation == "chdir" && line.result.is_success() {
                cwd.insert(line.pid, resolved.clone());
            }
            if matches!(line.operation.as_str(), "open" | "openat" | "openat2")
                && line.result.is_success()
            {
                if let Some(fd) = &line.result.value {
                    fds.insert((line.pid, fd.clone()), resolved);
                }
            }
        }
    }
}

fn pid_from_filename(filename: &str) -> Option<u32> {
    filename.rsplit('.').next()?.parse().ok()
}

fn strip_timestamp(line: &str) -> (f64, &str) {
    let mut parts = line.splitn(2, char::is_whitespace);
    let first = parts.next().unwrap_or("");
    let rest = parts.next().unwrap_or(line).trim_start();
    if let Ok(value) = first.parse::<f64>() {
        (value, rest)
    } else {
        (0.0, line)
    }
}

fn find_closing_paren(value: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, ch) in value[open..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' && quoted {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
            continue;
        }
        if quoted {
            continue;
        }
        if ch == '(' {
            depth += 1;
        }
        if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(open + offset);
            }
        }
    }
    None
}

fn split_args(value: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut start = 0;
    let mut depth = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (i, ch) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' && quoted {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
            continue;
        }
        if quoted {
            continue;
        }
        match ch {
            '[' | '{' | '(' => depth += 1,
            ']' | '}' | ')' => depth -= 1,
            ',' if depth == 0 => {
                args.push(value[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    args.push(value[start..].trim().to_string());
    args
}

fn unquote(value: &str) -> Option<String> {
    let start = value.find('"')?;
    let mut result = String::new();
    let mut escaped = false;
    for ch in value[start + 1..].chars() {
        if escaped {
            result.push(match ch {
                'n' => '\n',
                't' => '\t',
                'r' => '\r',
                other => other,
            });
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(result);
        } else {
            result.push(ch);
        }
    }
    None
}

fn resource_for(
    operation: &str,
    args: &[String],
    details: &mut BTreeMap<String, serde_json::Value>,
) -> Option<String> {
    match operation {
        "openat" | "openat2" | "newfstatat" | "readlinkat" | "faccessat" | "faccessat2"
        | "execveat" => {
            if let Some(dirfd) = args.first() {
                details.insert("dirfd".into(), json!(descriptor_token(dirfd)));
            }
            args.get(1).and_then(|value| unquote(value))
        }
        "open" | "access" | "stat" | "lstat" | "readlink" | "chdir" | "execve" => {
            args.first().and_then(|value| unquote(value))
        }
        _ => None,
    }
}

fn parse_result(value: &str) -> EventResult {
    let mut parts = value.split_whitespace();
    let first = parts.next().unwrap_or("");
    if first == "-1" {
        EventResult::error(parts.next().unwrap_or("UNKNOWN"))
    } else {
        EventResult::success(descriptor_token(first.trim_end_matches(',')))
    }
}

fn descriptor_token(value: &str) -> &str {
    // strace -yy appends a resolved path to descriptors, for example 3</tmp/file>.
    value
        .split_once('<')
        .map_or(value, |(token, _)| token)
        .trim()
}

fn category_for(operation: &str, resource: Option<&str>, result: &EventResult) -> String {
    if result
        .code
        .as_deref()
        .map(|code| matches!(code, "EACCES" | "EPERM"))
        .unwrap_or(false)
    {
        return "permission".into();
    }
    if matches!(operation, "execve" | "execveat") {
        return "executable".into();
    }
    if resource.map(is_library).unwrap_or(false) {
        return "library".into();
    }
    if matches!(
        operation,
        "clone" | "clone3" | "fork" | "vfork" | "wait4" | "waitid" | "exit" | "exit_group"
    ) {
        return "process".into();
    }
    "file".into()
}

fn is_library(resource: &str) -> bool {
    resource.ends_with(".so")
        || resource.contains(".so.")
        || resource.contains("/ld-linux")
        || resource.contains("/ld-musl")
}

fn is_selected_operation(operation: &str) -> bool {
    matches!(
        operation,
        "execve"
            | "execveat"
            | "clone"
            | "clone3"
            | "fork"
            | "vfork"
            | "wait4"
            | "waitid"
            | "exit"
            | "exit_group"
            | "open"
            | "openat"
            | "openat2"
            | "access"
            | "faccessat"
            | "faccessat2"
            | "stat"
            | "lstat"
            | "newfstatat"
            | "readlink"
            | "readlinkat"
            | "chdir"
            | "fchdir"
            | "getcwd"
            | "getuid"
            | "geteuid"
            | "getgid"
            | "getegid"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_complete_errors_and_escaped_paths() {
        let output = parse_strace_text(
            "bad",
            421,
            "1720000000.1 openat(AT_FDCWD, \"config\\\"prod.json\", O_RDONLY) = -1 ENOENT (No such file)\n",
        );
        assert_eq!(output.unparsed_lines, 0);
        assert_eq!(
            output.events[0].resource.as_deref(),
            Some("config\"prod.json")
        );
        assert_eq!(output.events[0].result.code.as_deref(), Some("ENOENT"));
        assert_eq!(
            output.events[0]
                .details
                .get("path_was_relative")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn joins_unfinished_and_resumed_lines() {
        let trace = "1720000000.1 openat(AT_FDCWD, \"/tmp/a\", O_RDONLY <unfinished ...>\n1720000000.2 <... openat resumed>) = 3\n";
        let output = parse_strace_text("good", 1, trace);
        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].result.is_success());
    }

    #[test]
    fn maps_processes_and_exit() {
        let trace = concat!(
            "1.0 clone(child_stack=NULL) = 222\n",
            "1.05 wait4(222, NULL, 0, NULL) = 222\n",
            "1.1 exit_group(0) = ?\n",
            "1.2 +++ exited with 0 +++\n",
        );
        let output = parse_strace_text("good", 111, trace);
        assert_eq!(output.events[0].process_id, "p1");
        assert_eq!(output.events[0].result.value.as_deref(), Some("p2"));
        assert_eq!(
            output.events[0]
                .details
                .get("child_pid")
                .and_then(|value| value.as_str()),
            Some("p2")
        );
        assert_eq!(output.events[1].result.value.as_deref(), Some("p2"));
        assert_eq!(output.events.len(), 3);
        assert_eq!(output.events[2].operation, "exit_group");
        assert_eq!(output.events[2].result.value.as_deref(), Some("0"));
    }

    #[test]
    fn strips_descriptor_path_annotations() {
        let trace = "1.0 openat(AT_FDCWD</work/app>, \"config.toml\", O_RDONLY) = 3</work/app/config.toml>\n";
        let output = parse_strace_text("good", 111, trace);
        assert_eq!(output.events[0].result.value.as_deref(), Some("3"));
        assert_eq!(
            output.events[0]
                .details
                .get("dirfd")
                .and_then(|value| value.as_str()),
            Some("AT_FDCWD")
        );
    }

    #[test]
    fn rejects_oversized_trace_lines_without_retaining_them() {
        let input = vec![b'a'; MAX_TRACE_LINE_BYTES + 1];
        let error = BoundedLines::new(Cursor::new(input))
            .next()
            .expect("one line must be read")
            .expect_err("oversized line must fail");
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn malformed_trace_text_does_not_panic() {
        let alphabet = b"()[]{}\\\"<>=,-+ abcdef0123456789";
        let mut state = 0x9e37_79b9_u32;
        for case in 0..2_000 {
            let length = case % 257;
            let mut trace = String::with_capacity(length + 1);
            for _ in 0..length {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                trace.push(alphabet[state as usize % alphabet.len()] as char);
            }
            trace.push('\n');
            let _ = parse_strace_text("fuzz", 1, &trace);
        }
    }
}
