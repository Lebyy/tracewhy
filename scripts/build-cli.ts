import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const executable = process.platform === "win32" ? "tracewhy.exe" : "tracewhy";
const output = join(root, "dist", executable);

await mkdir(join(root, "dist"), { recursive: true });
const build = Bun.spawn(
  ["bun", "build", join(root, "apps", "cli", "src", "index.ts"), "--compile", "--outfile", output],
  { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exit(await build.exited);
