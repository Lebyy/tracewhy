import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const projectReadme = readFileSync(resolve(root, "README.md"), "utf8");
const npmReadme = readFileSync(resolve(root, "npm/tracewhy/README.md"), "utf8");

if (projectReadme !== npmReadme) {
  throw new Error("npm/tracewhy/README.md must exactly match README.md.");
}

console.log("npm README matches the project README.");
