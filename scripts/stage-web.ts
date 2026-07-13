import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const webRoot = resolve(root, "apps/web");
const standaloneRoot = resolve(webRoot, ".next/standalone/apps/web");
const staticSource = resolve(webRoot, ".next/static");
const staticDestination = resolve(standaloneRoot, ".next/static");

if (!existsSync(resolve(standaloneRoot, "server.js")) || !existsSync(staticSource)) {
  throw new Error("The standalone report build is incomplete.");
}

rmSync(staticDestination, { recursive: true, force: true });
mkdirSync(resolve(standaloneRoot, ".next"), { recursive: true });
cpSync(staticSource, staticDestination, { recursive: true });
