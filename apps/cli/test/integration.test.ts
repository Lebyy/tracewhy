import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const fixture = resolve(import.meta.dir, "../../../packages/fixtures/missing-file");
const cli = resolve(import.meta.dir, "../src/index.ts");
const temporary = await mkdtemp(join(tmpdir(), "tracewhy-cli-test-"));

afterAll(() => rm(temporary, { recursive: true, force: true }));

describe("missing-file vertical slice", () => {
  test("compares fixture recordings and returns the diagnosis exit code", async () => {
    const { stdout, exitCode } = await runCli([
      "compare", join(fixture, "good"), join(fixture, "bad"), "--data-dir", temporary,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("File or directory is missing: config.json");
    expect(stdout).toContain("HIGH CONFIDENCE");
  });

  test("exports a self-contained offline report", async () => {
    const output = join(temporary, "report.html");
    const { exitCode } = await runCli([
      "export", join(fixture, "good"), join(fixture, "bad"),
      "--format", "html", "--output", output, "--data-dir", temporary,
    ]);
    expect(exitCode).toBe(0);
    const html = await readFile(output, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("File or directory is missing");
    expect(html).not.toContain("https://");
  });

  test("packs and compares a portable recording bundle", async () => {
    const bundle = join(temporary, "good.tracewhy");
    const packed = await runCli(["pack", join(fixture, "good"), "--output", bundle, "--data-dir", temporary]);
    expect(packed.exitCode).toBe(0);

    const { stdout, exitCode } = await runCli([
      "compare", bundle, join(fixture, "bad"), "--data-dir", temporary,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("File or directory is missing: config.json");
  });
});

async function runCli(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const child = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode === 2) throw new Error(stderr.trim() || "TraceWhy reported an internal error.");
  return { stdout, exitCode };
}
