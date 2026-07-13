export const SCHEMA_VERSION = 1 as const;

export type EventCategory =
  | "process"
  | "file"
  | "permission"
  | "executable"
  | "library"
  | "environment";

export interface EventResult {
  kind: "success" | "error";
  value?: string;
  code?: string;
}

export interface RawReference {
  file: string;
  line: number;
}

export interface NormalizedEvent {
  schema_version: 1;
  event_id: string;
  process_id: string;
  parent_process_id?: string;
  sequence: number;
  category: EventCategory;
  operation: string;
  resource?: string;
  result: EventResult;
  details?: Record<string, string | number | boolean | string[]>;
  raw_ref: RawReference;
}

export interface RecordingManifest {
  schema_version: 1;
  tracewhy_version: string;
  recording_id: string;
  name: string;
  started_at: string;
  duration_ms: number;
  command: string;
  args: string[];
  cwd: string;
  exit: { code?: number; signal?: string; success: boolean };
  system: {
    platform: string;
    kernel: string;
    architecture: string;
    distribution?: string;
    libc?: string;
  };
  environment: Record<string, string>;
  output: {
    stdout_bytes: number;
    stderr_bytes: number;
    stdout_truncated: boolean;
    stderr_truncated: boolean;
  };
  warnings: string[];
  completeness: {
    trace_complete: boolean;
    parser_unparsed_lines: number;
    processes_may_have_escaped: boolean;
  };
}

export type FindingType =
  | "missing_file"
  | "permission_problem"
  | "different_executable"
  | "shared_library_difference"
  | "child_process_failure"
  | "working_directory_difference"
  | "environment_difference";

export interface Finding {
  finding_id: string;
  type: FindingType;
  title: string;
  classification: "confirmed_difference" | "likely_cause" | "supporting_difference";
  confidence: "high" | "medium" | "low";
  score: number;
  summary: string;
  reasons: string[];
  good_event_ids: string[];
  bad_event_ids: string[];
}

export interface ProcessNode {
  process_id: string;
  parent_process_id?: string;
  executable?: string;
  exit_code?: number;
  signal?: string;
}

export interface RecordingSummary {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  exit: RecordingManifest["exit"];
  system: RecordingManifest["system"];
  warnings: string[];
}

export interface Comparison {
  schema_version: 1;
  tracewhy_version: string;
  comparison_id: string;
  created_at: string;
  good: RecordingSummary;
  bad: RecordingSummary;
  findings: Finding[];
  events: { good: NormalizedEvent[]; bad: NormalizedEvent[] };
  processes: { good: ProcessNode[]; bad: ProcessNode[] };
  ignored_differences: Array<{ reason: string; good_event_id?: string; bad_event_id?: string }>;
  warnings: string[];
}

export type CapabilityId =
  | "process_tree"
  | "file_access"
  | "permissions"
  | "executable_selection"
  | "path_resolution"
  | "working_directory"
  | "child_exit"
  | "shared_libraries";

export interface DiagnosticCase {
  case_id: string;
  label: string;
  description: string;
  capabilities: CapabilityId[];
  comparison: Comparison;
}

export interface ComparisonSuite {
  schema_version: 1;
  kind: "comparison_suite";
  title: string;
  description: string;
  generated_at: string;
  cases: DiagnosticCase[];
}

export type ReportPayload = Comparison | ComparisonSuite;
