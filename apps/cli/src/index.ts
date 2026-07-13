#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { compare, packRecording } from "./compare";
import { parseOptions, flagBoolean, flagString } from "./options";
import { dataDirectory, repoRoot, writeFileAtomic } from "./paths";
import { record } from "./record";
import { formatTerminal, selfContainedHtml } from "./report";
import { VERSION } from "./version";

async function main(args = Bun.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    return command ? 0 : 2;
  }
  if (command === "--version" || command === "version") {
    console.log(`tracewhy ${VERSION}`);
    return 0;
  }
  if (command === "record") {
    const options = parseOptions(args.slice(1), true);
    validateCommandOptions(options, 1, ["--data-dir", "--overwrite", "--max-output-bytes", "--max-trace-bytes"]);
    const name = options.positionals[0];
    if (!name) throw new Error("Usage: tracewhy record NAME [--overwrite] -- COMMAND [ARGS...]");
    return record({
      name,
      command: options.command,
      dataDir: dataDirectory(flagString(options, "--data-dir")),
      overwrite: flagBoolean(options, "--overwrite"),
      maxOutputBytes: numericFlag(options, "--max-output-bytes", 4 * 1024 * 1024),
      maxTraceBytes: numericFlag(options, "--max-trace-bytes", 128 * 1024 * 1024),
    });
  }
  if (command === "compare") {
    const options = parseOptions(args.slice(1));
    validateCommandOptions(options, 2, ["--data-dir", "--json"]);
    const [good, bad] = options.positionals;
    if (!good || !bad) throw new Error("Usage: tracewhy compare GOOD BAD [--json]");
    const loaded = await compare(good, bad, dataDirectory(flagString(options, "--data-dir")));
    if (flagBoolean(options, "--json")) console.log(JSON.stringify(loaded.comparison, null, 2));
    else console.log(formatTerminal(loaded.comparison));
    const hasHighConfidenceCause = loaded.comparison.findings.some(
      (finding) => finding.confidence === "high" && finding.classification === "likely_cause",
    );
    return hasHighConfidenceCause ? 1 : 0;
  }
  if (command === "pack") {
    const options = parseOptions(args.slice(1));
    validateCommandOptions(options, 1, ["--data-dir", "--output"]);
    const reference = options.positionals[0];
    const output = flagString(options, "--output");
    if (!reference || !output) throw new Error("Usage: tracewhy pack RECORDING --output FILE.tracewhy");
    await packRecording(reference, output, dataDirectory(flagString(options, "--data-dir")));
    console.log(`Packed “${reference}” to ${resolve(output)}`);
    return 0;
  }
  if (command === "export") {
    const options = parseOptions(args.slice(1));
    validateCommandOptions(options, 2, ["--data-dir", "--output", "--format"]);
    const [good, bad] = options.positionals;
    const output = flagString(options, "--output");
    const format = flagString(options, "--format") ?? "html";
    if (!good || !bad || !output || !["html", "json"].includes(format)) {
      throw new Error("Usage: tracewhy export GOOD BAD --format html|json --output FILE");
    }
    const loaded = await compare(good, bad, dataDirectory(flagString(options, "--data-dir")));
    const contents = format === "html"
      ? selfContainedHtml(loaded.comparison)
      : `${JSON.stringify(loaded.comparison, null, 2)}\n`;
    await writeFileAtomic(resolve(output), contents);
    console.log(`Exported ${format.toUpperCase()} report to ${resolve(output)}`);
    return 0;
  }
  if (command === "view") {
    const options = parseOptions(args.slice(1));
    validateCommandOptions(options, 2, ["--data-dir", "--port", "--no-open"]);
    const [good, bad] = options.positionals;
    if (!good || !bad) throw new Error("Usage: tracewhy view GOOD BAD [--port 4317] [--no-open]");
    const loaded = await compare(good, bad, dataDirectory(flagString(options, "--data-dir")));
    const port = numericFlag(options, "--port", 65_535) ?? 4317;
    await startReportServer(loaded.outputPath, port, flagBoolean(options, "--no-open"));
    return 0;
  }
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

async function startReportServer(comparisonPath: string, port: number, noOpen: boolean): Promise<void> {
  const web = join(repoRoot(), "apps", "web");
  const installedWeb = resolve(process.execPath, "..", "..", "lib", "tracewhy", "web", "apps", "web");
  const standalone = [
    join(web, ".next", "standalone", "apps", "web"),
    installedWeb,
  ].find((directory) => existsSync(join(directory, "server.js")));
  if (!standalone) {
    throw new Error("The production report application is missing. Run `bun run build:web` or reinstall TraceWhy.");
  }
  const installedRuntime = resolve(process.execPath, "..", "..", "lib", "tracewhy", "bun");
  const runtime = [installedRuntime, Bun.which("bun")].find((path): path is string => Boolean(path && existsSync(path)));
  if (!runtime) throw new Error("The pinned report runtime is missing. Reinstall TraceWhy.");
  const url = `http://127.0.0.1:${port}`;
  console.log(`Opening the local report at ${url}\nPress Ctrl+C to stop the report server.`);
  const child = Bun.spawn([runtime, "server.js"], {
    cwd: standalone,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      TRACEWHY_COMPARISON: comparisonPath,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
    },
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    child.kill();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const opener = reportOpener();
  if (!noOpen && opener) {
    void openReportWhenReady(url, opener);
  }
  try {
    const exitCode = await child.exited;
    if (exitCode !== 0 && !interrupted) {
      throw new Error(`The local report server exited with code ${exitCode}.`);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function openReportWhenReady(url: string, opener: string[]): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "error" });
      if (response.ok) {
        Bun.spawn([...opener, url], { stdout: "ignore", stderr: "ignore" });
        return;
      }
    } catch {}
    await Bun.sleep(100);
  }
}

function reportOpener(): string[] | undefined {
  if (process.platform === "linux" && Bun.which("xdg-open")) return ["xdg-open"];
  if (process.platform === "darwin" && Bun.which("open")) return ["open"];
  if (process.platform === "win32") {
    const command = process.env.ComSpec ?? Bun.which("cmd.exe");
    if (command) return [command, "/d", "/s", "/c", "start", ""];
  }
  return undefined;
}

function numericFlag(options: ReturnType<typeof parseOptions>, name: string, maximum: number): number | undefined {
  const value = flagString(options, name);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer.`);
  if (number > maximum) throw new Error(`${name} must not exceed ${maximum}.`);
  return number;
}

function validateCommandOptions(
  options: ReturnType<typeof parseOptions>,
  positionalCount: number,
  allowedFlags: string[],
): void {
  if (options.positionals.length > positionalCount) {
    throw new Error(`Unexpected argument: ${options.positionals[positionalCount]}`);
  }
  const allowed = new Set(allowedFlags);
  for (const name of options.flags.keys()) {
    if (!allowed.has(name)) throw new Error(`Option is not valid for this command: ${name}`);
  }
}

function help(): string {
  return `TraceWhy ${VERSION} — Find why a command works in one environment and fails in another.

Usage:
  tracewhy record NAME [--overwrite] [--max-output-bytes N] [--max-trace-bytes N] -- COMMAND [ARGS...]
  tracewhy compare GOOD BAD [--json]
  tracewhy view GOOD BAD [--port 4317] [--no-open]
  tracewhy pack RECORDING --output FILE.tracewhy
  tracewhy export GOOD BAD --format html|json --output FILE

Global data option:
  --data-dir DIR        Store or read recordings outside .tracewhy

Comparison exit codes:
  0  comparison complete; no high-confidence likely cause
  1  comparison complete; high-confidence likely cause found
  2  invalid input, missing data, or internal failure`;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`TraceWhy: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

export { main };
