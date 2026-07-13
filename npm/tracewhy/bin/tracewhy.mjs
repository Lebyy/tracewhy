#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binary = resolve(dirname(fileURLToPath(import.meta.url)), "..", "native", "bin", "tracewhy");
if (!existsSync(binary)) {
  console.error("TraceWhy is not installed. Reinstall the package without disabling npm lifecycle scripts.");
  process.exit(2);
}

const child = spawnSync(binary, process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
});
if (child.error) {
  console.error(`Could not start TraceWhy: ${child.error.message}`);
  process.exit(2);
}
if (child.signal) process.kill(process.pid, child.signal);
process.exit(child.status ?? 2);
