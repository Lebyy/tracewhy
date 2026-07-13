import { describe, expect, test } from "bun:test";
import { REDACTED, redactEnvironment, redactText, redactValue } from "../src/redact";

describe("secret redaction", () => {
  test("redacts sensitive keys case-insensitively", () => {
    const result = redactEnvironment({ PATH: "/bin", api_token: "seeded-secret" });
    expect(result.api_token).toBeUndefined();
    expect(result.PATH).toBe("/bin");
  });

  test("redacts seeded secrets and credential-shaped values", () => {
    const environment = { SERVICE_PASSWORD: "correct-horse-battery", PATH: "/bin" };
    expect(redactText("failed: correct-horse-battery", environment)).not.toContain("correct-horse-battery");
    expect(redactText("Authorization: Bearer abcdefghijklmnop", {})).toContain(REDACTED);
  });

  test("redacts overlapping seeded secrets without leaking suffixes", () => {
    expect(redactValue("abcdef abcd", ["abcd", "abcdef"])).toBe(`${REDACTED} ${REDACTED}`);
  });

  test("normalizes home paths in persisted environment", () => {
    expect(redactEnvironment({ PATH: "/home/alex/bin" }, "/home/alex").PATH).toBe("~/bin");
  });
});
