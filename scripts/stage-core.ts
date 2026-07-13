import { chmod, copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const executable = process.platform === "win32" ? "tracewhy-trace-core.exe" : "tracewhy-trace-core";
const source = join(root, "target", "release", executable);
const destination = join(root, "dist", executable);

await mkdir(join(root, "dist"), { recursive: true });
await copyFile(source, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
