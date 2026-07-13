import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ComparisonSuite } from "../src/types";

interface Schema {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  type?: "object" | "array" | "string" | "integer" | "boolean";
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
}

const schemaDirectory = resolve(import.meta.dir, "..");
const suiteCaseNames = [
  "missing-config",
  "permission-denied",
  "wrong-executable",
  "wrong-working-directory",
  "child-failure",
  "shared-library",
];
const fixtures = [
  ...["missing-file", "showcase"].map((name) => resolve(import.meta.dir, `../../fixtures/${name}`)),
  ...suiteCaseNames.map((name) => resolve(import.meta.dir, `../../fixtures/showcase-suite/cases/${name}`)),
];
const fixture = fixtures[0]!;
const temporary = await mkdtemp(join(tmpdir(), "tracewhy-schema-test-"));

afterAll(() => rm(temporary, { recursive: true, force: true }));

describe("published JSON schemas", () => {
  test("fixture manifests and events validate", async () => {
    const manifestSchema = await loadSchema("recording.schema.json");
    const eventSchema = await loadSchema("event.schema.json");
    for (const fixturePath of fixtures) {
      for (const side of ["good", "bad"]) {
        const manifest = JSON.parse(await readFile(join(fixturePath, side, "manifest.json"), "utf8"));
        await expectValid(manifest, manifestSchema, `$fixture.${side}.manifest`);
        const lines = (await readFile(join(fixturePath, side, "events.jsonl"), "utf8"))
          .split("\n")
          .filter(Boolean);
        for (const [index, line] of lines.entries()) {
          await expectValid(JSON.parse(line), eventSchema, `$fixture.${side}.events[${index}]`);
        }
      }
    }
  });

  test("CLI JSON output validates against comparison schema", async () => {
    const cli = resolve(import.meta.dir, "../../../apps/cli/src/index.ts");
    const output = join(temporary, "comparison-export.json");
    const child = Bun.spawn(
      [
        "bun", cli, "export", join(fixture, "good"), join(fixture, "bad"),
        "--format", "json", "--output", output, "--data-dir", temporary,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
    const json = await readFile(output, "utf8");
    expect(json.endsWith("}\n"), `comparison export was truncated at ${json.length} bytes`).toBe(true);
    await expectValid(JSON.parse(json), await loadSchema("comparison.schema.json"), "$comparison");
  });

  test("full showcase suite validates and covers every capability", async () => {
    const suiteRoot = resolve(import.meta.dir, "../../fixtures/showcase-suite");
    const suite = JSON.parse(
      await readFile(join(suiteRoot, "suite.json"), "utf8"),
    ) as ComparisonSuite;
    await expectValid(suite, await loadSchema("suite.schema.json"), "$suite");
    expect(suite.cases).toHaveLength(6);
    const covered = new Set(suite.cases.flatMap((item: { capabilities: string[] }) => item.capabilities));
    expect([...covered].sort()).toEqual([
      "child_exit",
      "executable_selection",
      "file_access",
      "path_resolution",
      "permissions",
      "process_tree",
      "shared_libraries",
      "working_directory",
    ]);
    for (const item of suite.cases) {
      const stored = JSON.parse(await readFile(join(suiteRoot, "cases", item.case_id, "comparison.json"), "utf8"));
      expect(item.comparison).toEqual(stored);
    }
  });
});

async function loadSchema(name: string): Promise<Schema> {
  return JSON.parse(await readFile(join(schemaDirectory, name), "utf8"));
}

async function expectValid(value: unknown, schema: Schema, path: string, root = schema): Promise<void> {
  if (schema.$ref) {
    if (schema.$ref.startsWith("#/")) {
      const target = resolveLocalReference(root, schema.$ref);
      return expectValid(value, target, path, root);
    }
    return expectValid(value, await loadSchema(schema.$ref), path);
  }
  if ("const" in schema) {
    expect(value, `${path} must equal ${JSON.stringify(schema.const)}`).toEqual(schema.const);
  }
  if (schema.enum) {
    expect(schema.enum, `${path} must be in the declared enum`).toContain(value);
  }
  if (schema.type === "object") {
    expect(isRecord(value), `${path} must be an object`).toBe(true);
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      expect(Object.hasOwn(object, key), `${path}.${key} is required`).toBe(true);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(object, key)) {
        await expectValid(object[key], child, `${path}.${key}`, root);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        expect(
          Object.hasOwn(schema.properties ?? {}, key),
          `${path}.${key} is not allowed`,
        ).toBe(true);
      }
    } else if (typeof schema.additionalProperties === "object") {
      for (const [key, child] of Object.entries(object)) {
        if (!Object.hasOwn(schema.properties ?? {}, key)) {
          await expectValid(child, schema.additionalProperties, `${path}.${key}`, root);
        }
      }
    }
  }
  if (schema.type === "array") {
    expect(Array.isArray(value), `${path} must be an array`).toBe(true);
    if (!schema.items) throw new Error(`${path} array schema has no item definition.`);
    for (const [index, child] of (value as unknown[]).entries()) {
      await expectValid(child, schema.items, `${path}[${index}]`, root);
    }
  }
  if (schema.type === "string") expect(typeof value, `${path} must be a string`).toBe("string");
  if (schema.type === "integer") expect(Number.isInteger(value), `${path} must be an integer`).toBe(true);
  if (schema.type === "boolean") expect(typeof value, `${path} must be a boolean`).toBe("boolean");
}

function resolveLocalReference(root: Schema, reference: string): Schema {
  let current: unknown = root;
  for (const segment of reference.slice(2).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      throw new Error(`Schema reference does not exist: ${reference}`);
    }
    current = current[key];
  }
  if (!isRecord(current)) throw new Error(`Schema reference is not an object: ${reference}`);
  return current as Schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
