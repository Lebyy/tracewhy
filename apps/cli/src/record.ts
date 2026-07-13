import type { RecordingManifest } from "@tracewhy/schema";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { once } from "node:events";
import { mkdir, opendir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runCore } from "./core";
import { collectSecretValues, normalizeHome, redactEnvironment, redactText, redactValue } from "./redact";
import { ensureDataLayout, safeRecordingName } from "./paths";
import { VERSION } from "./version";

const DEFAULT_OUTPUT_LIMIT = 2 * 1024 * 1024;
const DEFAULT_TRACE_LIMIT = 128 * 1024 * 1024;
const OUTPUT_INSPECTION_TAIL = 64 * 1024;
const MAX_CAPTURED_ARGUMENTS = 128;
const MAX_COMMAND_LENGTH = 4096;
const MAX_ARGUMENT_LENGTH = 2048;
const MAX_SYSTEM_OUTPUT_BYTES = 16 * 1024;
const MAX_TRACE_FILES = 8_192;
// Keep this allowlist in sync with the operations understood by the Rust parser.
const TRACE_FAMILIES = [
  "execve", "execveat", "clone", "clone3", "fork", "vfork", "wait4", "waitid", "exit", "exit_group",
  "open", "openat", "openat2", "access", "faccessat", "faccessat2", "stat", "lstat", "newfstatat",
  "readlink", "readlinkat", "chdir", "fchdir", "getcwd", "getuid", "geteuid", "getgid", "getegid",
].join(",");

interface RecordOptions {
  name: string;
  command: string[];
  dataDir: string;
  overwrite: boolean;
  maxOutputBytes?: number;
  maxTraceBytes?: number;
}

export interface CapturedOutput {
  bytes: number;
  text: string;
  inspectionTail: string;
  truncated: boolean;
}

export async function record(options: RecordOptions): Promise<number> {
  if (process.platform !== "linux") {
    throw new Error(
      "Recording requires Linux because TraceWhy v1 uses strace. You can still compare copied .tracewhy recordings on this machine.",
    );
  }
  const strace = Bun.which("strace");
  if (!strace) {
    throw new Error(
      "strace is required. Install it with `sudo apt install strace`, `sudo dnf install strace`, or your distribution's package manager.",
    );
  }
  const supportsExitKill = (await commandOutput([strace, "--help"])).includes("--kill-on-exit");
  // Older strace releases need a separate session so one signal reaches the entire traced tree.
  const setsid = supportsExitKill ? undefined : Bun.which("setsid");
  if (!supportsExitKill && !setsid) {
    throw new Error("This strace version lacks --kill-on-exit and setsid is unavailable, so TraceWhy cannot guarantee safe process cleanup.");
  }
  const name = safeRecordingName(options.name);
  if (!options.command.length) throw new Error("A command is required after `--`.");
  await ensureDataLayout(options.dataDir);
  const destination = join(options.dataDir, "recordings", name);
  if (existsSync(destination) && !options.overwrite) {
    throw new Error(`Recording “${name}” already exists. Pass --overwrite to replace it.`);
  }
  const temporary = join(options.dataDir, "tmp", `${name}-${crypto.randomUUID()}`);
  const rawDir = join(temporary, "raw");
  await mkdir(rawDir, { recursive: true, mode: 0o700 });
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  let interrupted = false;
  let terminate: (() => void) | undefined;
  const interrupt = () => {
    interrupted = true;
    terminate?.();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    const started = new Date();
    const began = performance.now();
    const outputLimit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT;
    const traceLimit = options.maxTraceBytes ?? DEFAULT_TRACE_LIMIT;
    const tracePrefix = join(rawDir, "trace");
    const traceCommand = [
      strace, "-ff", ...(supportsExitKill ? ["--kill-on-exit"] : []), "-ttt", "-T", "-s", "4096", "-yy", "-o", tracePrefix,
      "-e", `trace=${TRACE_FAMILIES}`, "--", ...options.command,
    ];
    const child = Bun.spawn(setsid ? [setsid, ...traceCommand] : traceCommand, {
      cwd: process.cwd(), env: process.env, stdout: "pipe", stderr: "pipe",
    });
    const terminateTree = (signal: NodeJS.Signals) => {
      if (!setsid) {
        child.kill(signal);
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    terminate = () => terminateTree("SIGTERM");
    if (interrupted) terminate();
    let tracing = true;
    const traceMonitor = monitorTraceSize(rawDir, traceLimit, () => tracing, () => terminateTree("SIGKILL"));
    const [stdout, stderr, exitCode] = await Promise.all([
      captureOutput(child.stdout, outputLimit, process.env),
      captureOutput(child.stderr, outputLimit, process.env),
      child.exited,
    ]);
    tracing = false;
    const traceLimits = await traceMonitor;
    if (interrupted) return 130;
    const durationMs = Math.round(performance.now() - began);
    process.stdout.write(stdout.text);
    process.stderr.write(stderr.text);

    // Redact before Rust sees the trace; normalized events are the only trace data retained.
    await redactRawTraceFiles(rawDir, process.env);
    const traceFiles = await traceFileSummary(rawDir);
    const traceDiagnostics = findTraceDiagnostics(`${stderr.text}\n${stderr.inspectionTail}`);
    const processesMayHaveEscaped = traceDiagnostics.some((line) => /ptrace|detached|operation not permitted/i.test(line))
      || (!supportsExitKill && (traceLimits.bytes || traceLimits.files));
    const captureWarnings = [
      ...(stdout.truncated ? ["stdout was truncated at the configured capture limit."] : []),
      ...(stderr.truncated ? ["stderr was truncated at the configured capture limit."] : []),
      ...(traceLimits.bytes ? [`Trace capture exceeded ${traceLimit} bytes and was stopped.`] : []),
      ...(traceLimits.files ? [`Trace capture exceeded ${MAX_TRACE_FILES} files and was stopped.`] : []),
      ...(traceFiles.count === 0 ? ["strace produced no trace files."] : []),
      ...traceDiagnostics.slice(0, 3).map((line) => `strace reported: ${line.slice(0, 1024)}`),
    ];
    const home = process.env.HOME;
    const cwd = process.cwd();
    const redactedCommand = redactText(options.command[0]!, process.env);
    const redactedArgs = options.command.slice(1).map((argument) => redactText(argument, process.env));
    const metadataTruncated = redactedCommand.length > MAX_COMMAND_LENGTH
      || redactedArgs.length > MAX_CAPTURED_ARGUMENTS
      || redactedArgs.some((argument) => argument.length > MAX_ARGUMENT_LENGTH);
    if (metadataTruncated) captureWarnings.push("Persisted command metadata was truncated to its safety limit.");
    const manifest: RecordingManifest = {
      schema_version: 1,
      tracewhy_version: VERSION,
      recording_id: crypto.randomUUID(),
      name,
      started_at: started.toISOString(),
      duration_ms: durationMs,
      command: redactedCommand.slice(0, MAX_COMMAND_LENGTH),
      args: redactedArgs.slice(0, MAX_CAPTURED_ARGUMENTS).map((argument) => argument.slice(0, MAX_ARGUMENT_LENGTH)),
      cwd: normalizeHome(cwd, home),
      exit: { code: exitCode, success: exitCode === 0 },
      system: await systemInfo(),
      environment: redactEnvironment(process.env, home),
      output: {
        stdout_bytes: stdout.bytes,
        stderr_bytes: stderr.bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
      },
      warnings: captureWarnings,
      completeness: {
        trace_complete: !traceLimits.bytes && !traceLimits.files && traceFiles.count > 0 && traceDiagnostics.length === 0,
        parser_unparsed_lines: 0,
        processes_may_have_escaped: processesMayHaveEscaped,
      },
    };
    await writeFile(join(temporary, "stdout.log"), stdout.text, { mode: 0o600 });
    await writeFile(join(temporary, "stderr.log"), stderr.text, { mode: 0o600 });

    const parsed = await runCore([
      "parse", "--recording", name, "--trace-dir", rawDir, "--output", join(temporary, "events.jsonl"),
      ...(home ? ["--home", home] : []), "--project-root", cwd,
    ]);
    if (parsed.exitCode !== 0) throw new Error(parsed.stderr.trim() || "The trace engine could not parse the recording.");
    const parseSummary = JSON.parse(parsed.stdout) as { unparsed_lines: number };
    manifest.completeness.parser_unparsed_lines = parseSummary.unparsed_lines;
    if (parseSummary.unparsed_lines > 0) {
      manifest.completeness.trace_complete = false;
      manifest.warnings.push(`${parseSummary.unparsed_lines} trace lines could not be parsed.`);
    }
    await writeFile(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await rm(rawDir, { recursive: true, force: true });
    if (options.overwrite) await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
    console.log(`\nRecorded “${name}” (${exitCode === 0 ? "successful" : `exit ${exitCode}`}, ${durationMs} ms)`);
    return exitCode;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (existsSync(temporary)) await cleanup();
  }
}

async function redactRawTraceFiles(directory: string, environment: Record<string, string | undefined>): Promise<void> {
  const seeded = collectSecretValues(environment);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const redactedPath = `${path}.redacted`;
    const input = createReadStream(path, { encoding: "utf8" });
    const output = createWriteStream(redactedPath, { encoding: "utf8", flags: "wx", mode: 0o600 });
    try {
      const lines = createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!output.write(`${redactValue(line, seeded)}\n`)) await once(output, "drain");
      }
      output.end();
      await once(output, "finish");
      await rename(redactedPath, path);
    } catch (error) {
      input.destroy();
      output.destroy();
      await rm(redactedPath, { force: true });
      throw error;
    }
  }
}

export async function captureOutput(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  environment: Record<string, string | undefined>,
): Promise<CapturedOutput> {
  const reader = stream.getReader();
  const retained: Uint8Array[] = [];
  let retainedBytes = 0;
  let tail: Uint8Array = new Uint8Array();
  let bytes = 0;
  // Continue draining after the retention limit so a full pipe cannot deadlock the traced command.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (retainedBytes < maxBytes) {
      const kept = value.slice(0, maxBytes - retainedBytes);
      retained.push(kept);
      retainedBytes += kept.byteLength;
    }
    tail = appendTail(tail, value, OUTPUT_INSPECTION_TAIL);
  }
  const text = redactText(new TextDecoder().decode(concatenate(retained, retainedBytes)), environment);
  const inspectionTail = redactText(new TextDecoder().decode(tail), environment);
  return { bytes, text, inspectionTail, truncated: bytes > maxBytes };
}

function concatenate(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function appendTail(current: Uint8Array, chunk: Uint8Array, limit: number): Uint8Array {
  if (chunk.byteLength >= limit) return chunk.slice(chunk.byteLength - limit);
  const keptFromCurrent = Math.min(current.byteLength, limit - chunk.byteLength);
  const result = new Uint8Array(keptFromCurrent + chunk.byteLength);
  result.set(current.slice(current.byteLength - keptFromCurrent));
  result.set(chunk, keptFromCurrent);
  return result;
}

async function monitorTraceSize(
  directory: string,
  maxBytes: number,
  isRunning: () => boolean,
  terminate: () => void,
): Promise<{ bytes: boolean; files: boolean }> {
  while (isRunning()) {
    const summary = await traceFileSummary(directory);
    if (summary.bytes > maxBytes || summary.count > MAX_TRACE_FILES) {
      terminate();
      return { bytes: summary.bytes > maxBytes, files: summary.count > MAX_TRACE_FILES };
    }
    await Bun.sleep(25);
  }
  const summary = await traceFileSummary(directory);
  return { bytes: summary.bytes > maxBytes, files: summary.count > MAX_TRACE_FILES };
}

async function traceFileSummary(directory: string): Promise<{ bytes: number; count: number }> {
  let bytes = 0;
  let count = 0;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("trace")) continue;
    bytes += (await stat(join(directory, entry.name))).size;
    count += 1;
  }
  return { bytes, count };
}

function findTraceDiagnostics(value: string): string[] {
  return [...new Set(value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^strace:/i.test(line))
    .filter((line) => /ptrace|detached|operation not permitted|cannot|can't|failed|invalid|unsupported/i.test(line))
  )];
}

async function systemInfo(): Promise<RecordingManifest["system"]> {
  const uname = ["/usr/bin/uname", "/bin/uname"].find(existsSync);
  const ldd = ["/usr/bin/ldd", "/bin/ldd"].find(existsSync);
  const kernel = uname ? await commandOutput([uname, "-sr"]) : "unknown";
  const architecture = uname ? await commandOutput([uname, "-m"]) : "unknown";
  const distribution = await readLinuxRelease();
  const libc = ldd ? await commandOutput([ldd, "--version"]) : "unknown";
  return { platform: "linux", kernel, architecture, distribution, libc: libc.split("\n")[0] };
}

async function commandOutput(command: string[]): Promise<string> {
  try {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    const chunks: Uint8Array[] = [];
    let retained = 0;
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (retained < MAX_SYSTEM_OUTPUT_BYTES) {
        const chunk = value.slice(0, MAX_SYSTEM_OUTPUT_BYTES - retained);
        chunks.push(chunk);
        retained += chunk.byteLength;
      }
      if (bytes > MAX_SYSTEM_OUTPUT_BYTES) child.kill("SIGKILL");
    }
    await child.exited;
    const output = new TextDecoder().decode(concatenate(chunks, retained));
    return output.trim() || "unknown";
  } catch { return "unknown"; }
}

async function readLinuxRelease(): Promise<string> {
  try {
    if ((await stat("/etc/os-release")).size > 64 * 1024) return "unknown";
    const text = await readFile("/etc/os-release", "utf8");
    const pretty = text.split("\n").find((line) => line.startsWith("PRETTY_NAME="));
    return pretty?.slice("PRETTY_NAME=".length).replace(/^"|"$/g, "") ?? "unknown";
  } catch { return "unknown"; }
}
