use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u32 = 1;
pub const TRACEWHY_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventResult {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl EventResult {
    pub fn success(value: impl Into<String>) -> Self {
        Self {
            kind: "success".into(),
            value: Some(value.into()),
            code: None,
        }
    }

    pub fn error(code: impl Into<String>) -> Self {
        Self {
            kind: "error".into(),
            value: None,
            code: Some(code.into()),
        }
    }

    pub fn is_success(&self) -> bool {
        self.kind == "success"
    }
    pub fn is_error(&self) -> bool {
        self.kind == "error"
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RawReference {
    pub file: String,
    pub line: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct NormalizedEvent {
    pub schema_version: u32,
    pub event_id: String,
    pub process_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_process_id: Option<String>,
    pub sequence: usize,
    pub category: String,
    pub operation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    pub result: EventResult,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub details: BTreeMap<String, serde_json::Value>,
    pub raw_ref: RawReference,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExitResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    pub success: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SystemInfo {
    pub platform: String,
    pub kernel: String,
    pub architecture: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distribution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub libc: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputInfo {
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Completeness {
    pub trace_complete: bool,
    pub parser_unparsed_lines: usize,
    pub processes_may_have_escaped: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordingManifest {
    pub schema_version: u32,
    pub tracewhy_version: String,
    pub recording_id: String,
    pub name: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub exit: ExitResult,
    pub system: SystemInfo,
    pub environment: BTreeMap<String, String>,
    pub output: OutputInfo,
    pub warnings: Vec<String>,
    pub completeness: Completeness,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Finding {
    pub finding_id: String,
    #[serde(rename = "type")]
    pub finding_type: String,
    pub title: String,
    pub classification: String,
    pub confidence: String,
    pub score: i32,
    pub summary: String,
    pub reasons: Vec<String>,
    pub good_event_ids: Vec<String>,
    pub bad_event_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessNode {
    pub process_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_process_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordingSummary {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub exit: ExitResult,
    pub system: SystemInfo,
    pub warnings: Vec<String>,
}

impl From<&RecordingManifest> for RecordingSummary {
    fn from(value: &RecordingManifest) -> Self {
        Self {
            name: value.name.clone(),
            command: value.command.clone(),
            args: value.args.clone(),
            cwd: value.cwd.clone(),
            exit: value.exit.clone(),
            system: value.system.clone(),
            warnings: value.warnings.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct IgnoredDifference {
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub good_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bad_event_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EventSides {
    pub good: Vec<NormalizedEvent>,
    pub bad: Vec<NormalizedEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessSides {
    pub good: Vec<ProcessNode>,
    pub bad: Vec<ProcessNode>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Comparison {
    pub schema_version: u32,
    pub tracewhy_version: String,
    pub comparison_id: String,
    pub created_at: String,
    pub good: RecordingSummary,
    pub bad: RecordingSummary,
    pub findings: Vec<Finding>,
    pub events: EventSides,
    pub processes: ProcessSides,
    pub ignored_differences: Vec<IgnoredDifference>,
    pub warnings: Vec<String>,
}
