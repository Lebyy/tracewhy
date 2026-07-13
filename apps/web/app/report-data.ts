import type {
  CapabilityId,
  Comparison,
  ComparisonSuite,
  DiagnosticCase,
  Finding,
  NormalizedEvent,
  ProcessNode,
  RecordingSummary,
  ReportPayload,
} from "@tracewhy/schema";

const CAPABILITY_IDS = new Set<string>([
  "process_tree",
  "file_access",
  "permissions",
  "executable_selection",
  "path_resolution",
  "working_directory",
  "child_exit",
  "shared_libraries",
] satisfies CapabilityId[]);

const EVENT_CATEGORIES = new Set([
  "process",
  "file",
  "permission",
  "executable",
  "library",
  "environment",
]);

const FINDING_TYPES = new Set([
  "missing_file",
  "permission_problem",
  "different_executable",
  "shared_library_difference",
  "child_process_failure",
  "working_directory_difference",
  "environment_difference",
]);

export function parseReportPayload(value: unknown): ReportPayload {
  if (isComparisonSuite(value) || isComparison(value)) return value;
  throw new Error("The attached report does not match TraceWhy schema v1.");
}

export function isComparisonSuite(value: unknown): value is ComparisonSuite {
  if (!isRecord(value) || value.schema_version !== 1 || value.kind !== "comparison_suite") return false;
  return typeof value.title === "string"
    && typeof value.description === "string"
    && typeof value.generated_at === "string"
    && isArrayOf(value.cases, isDiagnosticCase);
}

function isDiagnosticCase(value: unknown): value is DiagnosticCase {
  return isRecord(value)
    && typeof value.case_id === "string"
    && typeof value.label === "string"
    && typeof value.description === "string"
    && isArrayOf(value.capabilities, isCapabilityId)
    && isComparison(value.comparison);
}

function isComparison(value: unknown): value is Comparison {
  if (!isRecord(value) || value.schema_version !== 1) return false;
  return typeof value.tracewhy_version === "string"
    && typeof value.comparison_id === "string"
    && typeof value.created_at === "string"
    && isRecordingSummary(value.good)
    && isRecordingSummary(value.bad)
    && isArrayOf(value.findings, isFinding)
    && isSides(value.events, isNormalizedEvent)
    && isSides(value.processes, isProcessNode)
    && isArrayOf(value.ignored_differences, isIgnoredDifference)
    && isStringArray(value.warnings);
}

function isRecordingSummary(value: unknown): value is RecordingSummary {
  if (!isRecord(value)) return false;
  return typeof value.name === "string"
    && typeof value.command === "string"
    && isStringArray(value.args)
    && typeof value.cwd === "string"
    && isExit(value.exit)
    && isSystem(value.system)
    && isStringArray(value.warnings);
}

function isExit(value: unknown): value is RecordingSummary["exit"] {
  return isRecord(value)
    && typeof value.success === "boolean"
    && isOptional(value.code, isInteger)
    && isOptional(value.signal, isString);
}

function isSystem(value: unknown): value is RecordingSummary["system"] {
  return isRecord(value)
    && typeof value.platform === "string"
    && typeof value.kernel === "string"
    && typeof value.architecture === "string"
    && isOptional(value.distribution, isString)
    && isOptional(value.libc, isString);
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false;
  return typeof value.finding_id === "string"
    && isSetMember(value.type, FINDING_TYPES)
    && typeof value.title === "string"
    && isOneOf(value.classification, ["confirmed_difference", "likely_cause", "supporting_difference"])
    && isOneOf(value.confidence, ["high", "medium", "low"])
    && isInteger(value.score)
    && typeof value.summary === "string"
    && isStringArray(value.reasons)
    && isStringArray(value.good_event_ids)
    && isStringArray(value.bad_event_ids);
}

function isNormalizedEvent(value: unknown): value is NormalizedEvent {
  if (!isRecord(value) || value.schema_version !== 1) return false;
  return typeof value.event_id === "string"
    && isProcessId(value.process_id)
    && isOptional(value.parent_process_id, isProcessId)
    && isNonNegativeInteger(value.sequence)
    && isSetMember(value.category, EVENT_CATEGORIES)
    && typeof value.operation === "string"
    && isOptional(value.resource, isString)
    && isEventResult(value.result)
    && isOptional(value.details, isEventDetails)
    && isRawReference(value.raw_ref);
}

function isEventResult(value: unknown): value is NormalizedEvent["result"] {
  return isRecord(value)
    && isOneOf(value.kind, ["success", "error"])
    && isOptional(value.value, isString)
    && isOptional(value.code, isString);
}

function isEventDetails(value: unknown): value is NonNullable<NormalizedEvent["details"]> {
  return isRecord(value) && Object.values(value).every((item) => (
    typeof item === "string"
    || typeof item === "number"
    || typeof item === "boolean"
    || isStringArray(item)
  ));
}

function isRawReference(value: unknown): value is NormalizedEvent["raw_ref"] {
  return isRecord(value)
    && typeof value.file === "string"
    && isInteger(value.line)
    && value.line >= 1;
}

function isProcessNode(value: unknown): value is ProcessNode {
  return isRecord(value)
    && isProcessId(value.process_id)
    && isOptional(value.parent_process_id, isProcessId)
    && isOptional(value.executable, isString)
    && isOptional(value.exit_code, isInteger)
    && isOptional(value.signal, isString);
}

function isIgnoredDifference(value: unknown): value is Comparison["ignored_differences"][number] {
  return isRecord(value)
    && typeof value.reason === "string"
    && isOptional(value.good_event_id, isString)
    && isOptional(value.bad_event_id, isString);
}

function isSides<T>(value: unknown, predicate: (item: unknown) => item is T): value is { good: T[]; bad: T[] } {
  return isRecord(value)
    && isArrayOf(value.good, predicate)
    && isArrayOf(value.bad, predicate);
}

function isCapabilityId(value: unknown): value is CapabilityId {
  return isSetMember(value, CAPABILITY_IDS);
}

function isProcessId(value: unknown): value is string {
  return typeof value === "string" && /^p[0-9]+$/.test(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return isArrayOf(value, isString);
}

function isArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(predicate);
}

function isOptional<T>(value: unknown, predicate: (item: unknown) => item is T): value is T | undefined {
  return value === undefined || predicate(value);
}

function isSetMember(value: unknown, choices: Set<string>): value is string {
  return typeof value === "string" && choices.has(value);
}

function isOneOf<const T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
