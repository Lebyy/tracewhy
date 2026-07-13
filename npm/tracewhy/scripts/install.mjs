import { spawnSync } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { TransformStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { archiveFor, checksumFor, sha256, validateArchiveListing, validateArchiveTypes } from "./install-lib.mjs";

const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

async function main() {
  ensureGlibc();
  const archive = archiveFor(process.platform, process.arch);
  const tag = `v${metadata.version}`;
  const base = process.env.TRACEWHY_NPM_RELEASE_BASE ?? `https://github.com/Lebyy/tracewhy/releases/download/${tag}`;
  const temporary = await mkdtemp(join(tmpdir(), "tracewhy-npm-"));
  try {
    const manifest = await fetchText(`${base}/SHA256SUMS`, MAX_MANIFEST_BYTES);
    const expected = checksumFor(manifest, archive);
    const archivePath = join(temporary, archive);
    await download(`${base}/${archive}`, archivePath, MAX_ARCHIVE_BYTES);
    const actual = await sha256(archivePath);
    if (actual !== expected) throw new Error(`Checksum verification failed for ${archive}.`);

    const names = runTar(["-tzf", archivePath]);
    validateArchiveListing(names);
    validateArchiveTypes(runTar(["-tvzf", archivePath]));
    const extracted = join(temporary, "extracted");
    await mkdir(extracted);
    runTar(["-xzf", archivePath, "-C", extracted]);
    await installRelease(join(extracted, "tracewhy"), join(temporary, "native"));
    await rm(join(packageRoot, "native"), { force: true, recursive: true });
    await rename(join(temporary, "native"), join(packageRoot, "native"));
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
  console.log(`TraceWhy v${metadata.version} installed for linux-${process.arch}. Runtime use is fully offline.`);
}

function ensureGlibc() {
  if (process.platform !== "linux") return;
  const report = process.report?.getReport();
  if (!report?.header?.glibcVersionRuntime) {
    throw new Error("TraceWhy release binaries require a glibc-based Linux distribution.");
  }
}

async function fetchText(url, maximumBytes) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}.`);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new Error(`Download exceeded ${maximumBytes} bytes: ${url}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function download(url, destination, maximumBytes) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}.`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) {
    throw new Error(`Download exceeded ${maximumBytes} bytes: ${url}`);
  }
  let received = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximumBytes) throw new Error(`Download exceeded ${maximumBytes} bytes: ${url}`);
      controller.enqueue(chunk);
    },
  });
  await mkdir(dirname(destination), { recursive: true });
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(limiter)), output);
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw new Error(`tar is required to install TraceWhy: ${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `tar exited with status ${result.status}.`);
  return result.stdout;
}

async function installRelease(source, destination) {
  const required = ["tracewhy", "tracewhy-trace-core", "bun", join("web", "apps", "web", "server.js")];
  await Promise.all(required.map((path) => access(join(source, path), constants.R_OK)));
  const bin = join(destination, "bin");
  const library = join(destination, "lib", "tracewhy");
  await mkdir(bin, { recursive: true });
  await mkdir(library, { recursive: true });
  await rename(join(source, "tracewhy"), join(bin, "tracewhy"));
  await rename(join(source, "tracewhy-trace-core"), join(bin, "tracewhy-trace-core"));
  await rename(join(source, "bun"), join(library, "bun"));
  await rename(join(source, "web"), join(library, "web"));
  await Promise.all([
    chmod(join(bin, "tracewhy"), 0o755),
    chmod(join(bin, "tracewhy-trace-core"), 0o755),
    chmod(join(library, "bun"), 0o755),
  ]);
}

main().catch((error) => {
  console.error(`TraceWhy installation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
