import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isComparisonSuite, parseReportPayload } from "../app/report-data";

const suitePath = resolve(import.meta.dir, "../../../packages/fixtures/showcase-suite/suite.json");

describe("report payload boundary", () => {
  test("accepts the published full-capability fixture", async () => {
    const payload: unknown = JSON.parse(await readFile(suitePath, "utf8"));
    const parsed = parseReportPayload(payload);
    expect(isComparisonSuite(parsed)).toBe(true);
    if (isComparisonSuite(parsed)) expect(parsed.cases).toHaveLength(6);
  });

  test("rejects malformed attachments before rendering", () => {
    expect(() => parseReportPayload({ schema_version: 1, findings: [] })).toThrow(
      "does not match TraceWhy schema v1",
    );
  });

  test("rejects malformed nested evidence", async () => {
    const payload = JSON.parse(await readFile(suitePath, "utf8")) as {
      cases: Array<{ comparison: { events: { bad: Array<{ result: unknown }> } } }>;
    };
    payload.cases[0].comparison.events.bad[0].result = null;
    expect(() => parseReportPayload(payload)).toThrow("does not match TraceWhy schema v1");
  });
});
