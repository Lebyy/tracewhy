import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const executable = process.platform === "win32" ? "tracewhy.exe" : "tracewhy";
const cli = join(root, "dist", executable);
const fixture = join(root, "packages", "fixtures", "missing-file");
const good = join(fixture, "good");
const bad = join(fixture, "bad");
const temporary = await mkdtemp(join(tmpdir(), "tracewhy-portable-"));

try {
  const comparison = await run(["compare", good, bad, "--data-dir", temporary, "--json"], 1);
  if (!comparison.stdout.includes('"type": "missing_file"')) {
    throw new Error("Portable comparison did not produce the expected diagnosis.");
  }

  const bundle = join(temporary, "good.tracewhy");
  await run(["pack", good, "--output", bundle, "--data-dir", temporary], 0);
  const bundledComparison = await run(["compare", bundle, bad, "--data-dir", temporary], 1);
  if (!bundledComparison.stdout.includes("File or directory is missing: config.json")) {
    throw new Error("Portable bundle comparison did not preserve its evidence.");
  }

  const htmlPath = join(temporary, "report.html");
  await run(["export", good, bad, "--format", "html", "--output", htmlPath, "--data-dir", temporary], 0);
  const html = await readFile(htmlPath, "utf8");
  if (!html.includes("TraceWhy") || !html.includes("File or directory is missing")) {
    throw new Error("Portable HTML export is incomplete.");
  }

  await verifyLocalReport(good, bad, temporary);
  console.log(`Verified TraceWhy analysis workflows on ${process.platform}/${process.arch}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function run(args: string[], expectedExit: number): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn([cli, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== expectedExit) {
    throw new Error(`tracewhy ${args[0]} exited ${exitCode}; expected ${expectedExit}.\n${stderr}`);
  }
  return { stdout, stderr };
}

async function verifyLocalReport(goodPath: string, badPath: string, dataDir: string): Promise<void> {
  const port = await availablePort();
  const child = Bun.spawn(
    [cli, "view", goodPath, badPath, "--data-dir", dataDir, "--port", String(port), "--no-open"],
    { cwd: root, stdin: "ignore", stdout: "inherit", stderr: "inherit" },
  );
  let ready = false;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { redirect: "error" });
        if (response.ok) {
          const body = await response.text();
          const policy = response.headers.get("content-security-policy");
          ready = body.includes("TraceWhy") && Boolean(policy);
          break;
        }
      } catch {
        await Bun.sleep(100);
      }
    }
  } finally {
    await stopProcessTree(child);
  }
  if (!ready) {
    throw new Error("Portable local report did not become ready.");
  }
}

async function stopProcessTree(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (process.platform === "win32") {
    const taskkill = Bun.spawn(["taskkill", "/pid", String(child.pid), "/t", "/f"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await taskkill.exited;
  } else {
    child.kill("SIGTERM");
  }
  await child.exited;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local report port.");
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => error ? reject(error) : resolveClosed());
  });
  return address.port;
}
