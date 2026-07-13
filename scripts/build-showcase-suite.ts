import type { CapabilityId, Comparison, ComparisonSuite, DiagnosticCase, FindingType } from "@tracewhy/schema";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface CaseDefinition {
  case_id: string;
  label: string;
  description: string;
  capabilities: CapabilityId[];
  expected_type: FindingType;
}

const definitions: CaseDefinition[] = [
  {
    case_id: "missing-config",
    label: "Missing configuration",
    description: "A worker opens the same configuration path successfully in the good run and receives ENOENT in the bad run.",
    capabilities: ["file_access"],
    expected_type: "missing_file",
  },
  {
    case_id: "permission-denied",
    label: "Permission denied",
    description: "The same file read changes from success to EACCES after its mode removes access.",
    capabilities: ["permissions", "file_access"],
    expected_type: "permission_problem",
  },
  {
    case_id: "wrong-executable",
    label: "Wrong executable on PATH",
    description: "Different PATH values resolve the same command name to different executable files and behavior.",
    capabilities: ["path_resolution", "executable_selection"],
    expected_type: "different_executable",
  },
  {
    case_id: "wrong-working-directory",
    label: "Wrong working directory",
    description: "A relative configuration read resolves from two directories and fails only in the bad run.",
    capabilities: ["working_directory", "file_access"],
    expected_type: "working_directory_difference",
  },
  {
    case_id: "child-failure",
    label: "Child process failure",
    description: "The aligned child process changes exit status and TraceWhy attaches the failure to that process.",
    capabilities: ["process_tree", "child_exit"],
    expected_type: "child_process_failure",
  },
  {
    case_id: "shared-library",
    label: "Shared library unavailable",
    description: "The dynamic loader finds libdemo.so in the good environment and cannot load it in the bad environment.",
    capabilities: ["shared_libraries"],
    expected_type: "shared_library_difference",
  },
];

const requiredCapabilities: CapabilityId[] = [
  "process_tree",
  "file_access",
  "permissions",
  "executable_selection",
  "path_resolution",
  "working_directory",
  "child_exit",
  "shared_libraries",
];

const root = resolve(import.meta.dir, "..");
const source = resolve(Bun.argv[2] ?? join(root, "demos"));
const output = resolve(Bun.argv[3] ?? join(root, "packages", "fixtures", "showcase-suite", "suite.json"));
const cases: DiagnosticCase[] = [];

for (const definition of definitions) {
  const comparisonPath = join(source, definition.case_id, ".tracewhy", "demo-comparison.json");
  const comparison = JSON.parse(await readFile(comparisonPath, "utf8")) as Comparison;
  const leading = comparison.findings[0];
  if (leading?.type !== definition.expected_type || leading.confidence !== "high") {
    throw new Error(`${definition.case_id} did not produce the expected high-confidence ${definition.expected_type} finding.`);
  }
  cases.push({
    case_id: definition.case_id,
    label: definition.label,
    description: definition.description,
    capabilities: definition.capabilities,
    comparison,
  });
}

const covered = new Set(cases.flatMap((item) => item.capabilities));
const missing = requiredCapabilities.filter((capability) => !covered.has(capability));
if (missing.length > 0) throw new Error(`Showcase suite is missing capability coverage: ${missing.join(", ")}`);

const suite: ComparisonSuite = {
  schema_version: 1,
  kind: "comparison_suite",
  title: "TraceWhy full diagnostic casebook",
  description: "Six native Linux comparisons demonstrate every TraceWhy v1 diagnostic capability with linked trace evidence.",
  generated_at: cases.map((item) => item.comparison.created_at).sort().at(-1) ?? "",
  cases,
};

await mkdir(dirname(output), { recursive: true });
// The report server may read this file while it is rebuilt, so publish with one atomic rename.
const temporary = `${output}.tmp-${crypto.randomUUID()}`;
try {
  await writeFile(temporary, `${JSON.stringify(suite, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, output);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
console.log(`Built ${cases.length}-case showcase suite at ${output}`);
