import { expect, test } from "bun:test";
import type { Comparison } from "@tracewhy/schema";
import { selfContainedHtml } from "../src/report";

test("offline report treats trace values as text", () => {
  const comparison = {
    schema_version: 1,
    tracewhy_version: "1.0.0",
    comparison_id: "test",
    created_at: "2026-01-01T00:00:00Z",
    good: summary("good", true),
    bad: summary("bad", false),
    findings: [],
    events: {
      good: [event("good:1", "</script><script>alert(1)</script><img src=x onerror=alert(1)>")],
      bad: [],
    },
    processes: { good: [], bad: [] },
    ignored_differences: [],
    warnings: [],
  } satisfies Comparison;

  const html = selfContainedHtml(comparison);
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain("</script><script>alert(1)");
  expect(html).not.toContain("innerHTML");
  expect(html).toContain("textContent");
});

function summary(name: string, success: boolean): Comparison["good"] {
  return {
    name,
    command: "demo",
    args: [],
    cwd: "$PROJECT",
    exit: { code: success ? 0 : 1, success },
    system: { platform: "linux", kernel: "test", architecture: "arm64" },
    warnings: [],
  };
}

function event(eventId: string, resource: string): Comparison["events"]["good"][number] {
  return {
    schema_version: 1,
    event_id: eventId,
    process_id: "p1",
    sequence: 1,
    category: "file",
    operation: "openat",
    resource,
    result: { kind: "success", value: "3" },
    raw_ref: { file: "trace.1", line: 1 },
  };
}
