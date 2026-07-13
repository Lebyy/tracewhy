import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packagePaths = ["package.json", "apps/cli/package.json", "apps/web/package.json", "packages/schema/package.json"];
const versions = packagePaths.map((path) => {
  const contents = JSON.parse(readFileSync(resolve(root, path), "utf8")) as { version?: string };
  if (!contents.version) throw new Error(`${path} has no version.`);
  return [path, contents.version] as const;
});
const expected = versions[0]![1];
for (const [path, version] of versions) {
  if (version !== expected) throw new Error(`${path} uses ${version}; expected ${expected}.`);
}
const cargo = readFileSync(resolve(root, "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
if (cargoVersion !== expected) throw new Error(`Cargo workspace uses ${cargoVersion ?? "no version"}; expected ${expected}.`);
if (!readFileSync(resolve(root, "CHANGELOG.md"), "utf8").includes(`## [${expected}]`)) {
  throw new Error(`CHANGELOG.md has no ${expected} release entry.`);
}
