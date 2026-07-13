import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths";

const MAX_CORE_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface CoreResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function coreInvocation(args: string[]): { command: string[]; cwd: string } {
  const root = repoRoot();
  const configured = process.env.TRACEWHY_CORE_BIN;
  const executable = process.platform === "win32" ? "tracewhy-trace-core.exe" : "tracewhy-trace-core";
  const candidates = [
    configured,
    join(root, executable),
    join(root, "target", "release", executable),
    join(root, "target", "debug", executable),
  ].filter((value): value is string => Boolean(value));
  const binary = candidates.find(existsSync);
  if (binary) return { command: [binary, ...args], cwd: root };
  if (existsSync(join(root, "Cargo.toml")) && Bun.which("cargo")) {
    return { command: ["cargo", "run", "--locked", "--quiet", "-p", "trace-core", "--", ...args], cwd: root };
  }
  throw new Error("The TraceWhy trace engine is missing. Reinstall TraceWhy or set TRACEWHY_CORE_BIN to tracewhy-trace-core.");
}

export async function runCore(args: string[]): Promise<CoreResult> {
  const invocation = coreInvocation(args);
  const child = Bun.spawn(invocation.command, { cwd: invocation.cwd, stdout: "pipe", stderr: "pipe" });
  let terminated = false;
  const terminate = () => {
    if (terminated) return;
    terminated = true;
    child.kill("SIGKILL");
  };
  const [stdout, stderr, exitCode] = await Promise.all([
    // Drain both pipes concurrently; either stream can otherwise block the child before it exits.
    readBounded(child.stdout, terminate),
    readBounded(child.stderr, terminate),
    child.exited,
  ]);
  if (stdout.truncated || stderr.truncated) {
    return {
      stdout: stdout.text,
      stderr: [
        stderr.text.trimEnd(),
        "The trace engine exceeded its 4 MiB diagnostic output limit.",
      ].filter(Boolean).join("\n"),
      exitCode: 2,
    };
  }
  return { stdout: stdout.text, stderr: stderr.text, exitCode };
}

async function readBounded(stream: ReadableStream<Uint8Array>, terminate: () => void): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (retained < MAX_CORE_OUTPUT_BYTES) {
      const chunk = value.slice(0, MAX_CORE_OUTPUT_BYTES - retained);
      chunks.push(chunk);
      retained += chunk.byteLength;
    }
    if (!truncated && bytes > MAX_CORE_OUTPUT_BYTES) {
      truncated = true;
      terminate();
    }
  }
  const output = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(output), truncated };
}
