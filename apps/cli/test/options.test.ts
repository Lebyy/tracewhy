import { expect, test } from "bun:test";
import { parseOptions } from "../src/options";

test("keeps target command arguments after the marker", () => {
  const parsed = parseOptions(["good", "--overwrite", "--", "bun", "test", "--watch"], true);
  expect(parsed.positionals).toEqual(["good"]);
  expect(parsed.flags.get("--overwrite")).toBe(true);
  expect(parsed.command).toEqual(["bun", "test", "--watch"]);
});

test("rejects unknown and duplicate options", () => {
  expect(() => parseOptions(["good", "--unknown"])).toThrow("Unknown option: --unknown");
  expect(() => parseOptions(["good", "--json", "--json"])).toThrow("Option may only be specified once: --json");
});
