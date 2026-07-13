import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function archiveFor(platform, architecture) {
  if (platform !== "linux") throw new Error("The npm distribution supports Linux only.");
  if (architecture === "x64") return "tracewhy-linux-x64.tar.gz";
  if (architecture === "arm64") return "tracewhy-linux-arm64.tar.gz";
  throw new Error(`Unsupported Linux architecture: ${architecture}`);
}

export function checksumFor(manifest, archive) {
  const matches = manifest
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter(([digest, name]) => digest && name === archive);
  if (matches.length !== 1 || !SHA256_PATTERN.test(matches[0][0])) {
    throw new Error(`SHA256SUMS must contain exactly one valid entry for ${archive}.`);
  }
  return matches[0][0].toLowerCase();
}

export function validateArchiveListing(listing) {
  const entries = listing.split(/\r?\n/u).filter(Boolean);
  if (entries.length === 0) throw new Error("The release archive is empty.");
  const seen = new Set();
  for (const entry of entries) {
    if (entry.startsWith("/") || !/^tracewhy(?:\/|$)/u.test(entry) || /(?:^|\/)\.\.(?:\/|$)/u.test(entry)) {
      throw new Error(`Unsafe release archive path: ${entry}`);
    }
    if (seen.has(entry)) throw new Error(`Duplicate release archive path: ${entry}`);
    seen.add(entry);
  }
}

export function validateArchiveTypes(listing) {
  for (const line of listing.split(/\r?\n/u).filter(Boolean)) {
    const type = line[0];
    if (type !== "-" && type !== "d") throw new Error(`Unsupported release archive entry: ${line}`);
  }
}

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
