import type { Comparison } from "@tracewhy/schema";

interface ExpectedResult {
  top_finding: string;
  confidence: "high" | "medium" | "low";
}

const [comparisonPath, expectedPath, statusText] = Bun.argv.slice(2);
if (!comparisonPath || !expectedPath || statusText === undefined) {
  throw new Error("Usage: bun verify.ts COMPARISON EXPECTED EXIT_STATUS");
}

const comparison = await Bun.file(comparisonPath).json() as Comparison;
const expected = await Bun.file(expectedPath).json() as ExpectedResult;
const leading = comparison.findings[0];
if (!leading) throw new Error("TraceWhy produced no findings.");
if (leading.type !== expected.top_finding) {
  throw new Error(`Expected ${expected.top_finding}, received ${leading.type}.`);
}
if (leading.confidence !== expected.confidence) {
  throw new Error(`Expected ${expected.confidence} confidence, received ${leading.confidence}.`);
}

const expectedStatus = comparison.findings.some((finding) => finding.classification === "likely_cause" && finding.confidence === "high") ? 1 : 0;
const actualStatus = Number(statusText);
if (actualStatus !== expectedStatus) {
  throw new Error(`Expected comparison exit ${expectedStatus}, received ${actualStatus}.`);
}

console.log(`PASS ${expected.top_finding} (${expected.confidence})`);
