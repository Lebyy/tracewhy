import type { Comparison } from "@tracewhy/schema";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCore } from "./core";
import { ensureDataLayout, safeRecordingName } from "./paths";

const MAX_COMPARISON_BYTES = 128 * 1024 * 1024;

export interface LoadedComparison {
  comparison: Comparison;
  outputPath: string;
}

export async function compare(goodRef: string, badRef: string, dataDir: string): Promise<LoadedComparison> {
  await ensureDataLayout(dataDir);
  const temporary: string[] = [];
  try {
    const good = await resolveRecording(goodRef, dataDir, temporary);
    const bad = await resolveRecording(badRef, dataDir, temporary);
    const outputPath = join(dataDir, "comparisons", `${safeFile(basename(goodRef))}-vs-${safeFile(basename(badRef))}.json`);
    const result = await runCore(["compare", "--good", good, "--bad", bad, "--output", outputPath]);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "The trace engine could not compare these recordings.");
    const metadata = await stat(outputPath);
    if (!metadata.isFile() || metadata.size > MAX_COMPARISON_BYTES) {
      throw new Error("The comparison exceeds the 128 MiB safety limit.");
    }
    const comparison = JSON.parse(await readFile(outputPath, "utf8")) as Comparison;
    return { comparison, outputPath };
  } finally {
    await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })));
  }
}

export async function packRecording(reference: string, output: string, dataDir: string): Promise<void> {
  const source = resolveNamed(reference, dataDir);
  if (!existsSync(join(source, "manifest.json"))) throw new Error(`Recording not found: ${reference}`);
  await mkdir(dirname(resolve(output)), { recursive: true });
  const result = await runCore(["pack-bundle", "--source", source, "--output", resolve(output)]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Could not create the .tracewhy bundle.");
}

async function resolveRecording(reference: string, dataDir: string, temporary: string[]): Promise<string> {
  if (reference.endsWith(".tracewhy")) {
    const archive = resolve(reference);
    if (!existsSync(archive)) throw new Error(`Bundle not found: ${reference}`);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "tracewhy-bundle-"));
    temporary.push(temporaryRoot);
    const destination = join(temporaryRoot, "recording");
    const result = await runCore(["extract-bundle", "--archive", archive, "--destination", destination]);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Cannot unpack ${reference}.`);
    return destination;
  }
  const path = resolveNamed(reference, dataDir);
  if (!existsSync(join(path, "manifest.json"))) throw new Error(`Recording not found: ${reference}`);
  return path;
}

function resolveNamed(reference: string, dataDir: string): string {
  if (isAbsolute(reference) || reference.includes("/") || reference.includes("\\") || reference.startsWith(".")) {
    return resolve(reference);
  }
  return join(dataDir, "recordings", safeRecordingName(reference));
}

function safeFile(value: string): string {
  return value.replace(/\.tracewhy$/, "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "recording";
}
