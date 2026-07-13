import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function repoRoot(): string {
  const sourceRoot = resolve(import.meta.dir, "../../..");
  if (existsSync(join(sourceRoot, "Cargo.toml"))) return sourceRoot;
  const executableDirectory = dirname(process.execPath);
  const buildRoot = resolve(executableDirectory, "..");
  if (existsSync(join(buildRoot, "Cargo.toml"))) return buildRoot;
  return executableDirectory;
}

export function dataDirectory(explicit?: string): string {
  return resolve(explicit ?? join(process.cwd(), ".tracewhy"));
}

export async function ensureDataLayout(dataDir: string): Promise<void> {
  const directories = ["recordings", "comparisons", "tmp"].map((name) => join(dataDir, name));
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })));
  if (process.platform !== "win32") {
    await Promise.all(directories.map((directory) => chmod(directory, 0o700)));
  }
}

export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(temporary, data, { encoding: "utf8", flag: "wx", mode: 0o600 });
    // Windows rename does not replace an existing destination.
    if (process.platform === "win32") await rm(path, { force: true });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function safeRecordingName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error("Recording names may contain letters, numbers, dots, underscores, and hyphens (maximum 64 characters).");
  }
  return name;
}
