import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const webRoot = resolve(root, "apps/web");
const standaloneBuildRoot = resolve(webRoot, ".next/standalone");
const standaloneRoot = resolve(webRoot, ".next/standalone/apps/web");
const staticSource = resolve(webRoot, ".next/static");
const staticDestination = resolve(standaloneRoot, ".next/static");
const nodeModules = resolve(standaloneBuildRoot, "node_modules");

if (!existsSync(resolve(standaloneRoot, "server.js")) || !existsSync(staticSource)) {
  throw new Error("The standalone report build is incomplete.");
}

rmSync(staticDestination, { recursive: true, force: true });
mkdirSync(resolve(standaloneRoot, ".next"), { recursive: true });
cpSync(staticSource, staticDestination, { recursive: true });

assertNoLinks(nodeModules);

function assertNoLinks(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Standalone report dependency is still linked: ${entry.name}`);
    if (entry.isDirectory()) assertNoLinks(resolve(directory, entry.name));
  }
}
