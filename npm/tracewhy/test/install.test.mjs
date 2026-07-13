import test from "node:test";
import assert from "node:assert/strict";
import { archiveFor, checksumFor, validateArchiveListing, validateArchiveTypes } from "../scripts/install-lib.mjs";

test("maps supported Linux architectures to release archives", () => {
  assert.equal(archiveFor("linux", "x64"), "tracewhy-linux-x64.tar.gz");
  assert.equal(archiveFor("linux", "arm64"), "tracewhy-linux-arm64.tar.gz");
  assert.throws(() => archiveFor("darwin", "arm64"), /Linux only/u);
  assert.throws(() => archiveFor("linux", "riscv64"), /Unsupported Linux architecture/u);
});

test("extracts one exact checksum entry", () => {
  const digest = "a".repeat(64);
  assert.equal(checksumFor(`${digest}  tracewhy-linux-x64.tar.gz\n`, "tracewhy-linux-x64.tar.gz"), digest);
  assert.throws(() => checksumFor("", "tracewhy-linux-x64.tar.gz"), /exactly one/u);
  assert.throws(
    () => checksumFor(`${digest}  tracewhy-linux-x64.tar.gz\n${digest}  tracewhy-linux-x64.tar.gz\n`, "tracewhy-linux-x64.tar.gz"),
    /exactly one/u,
  );
});

test("rejects unsafe and duplicate archive paths", () => {
  validateArchiveListing("tracewhy/\ntracewhy/tracewhy\ntracewhy/web/server.js\n");
  assert.throws(() => validateArchiveListing("../tracewhy\n"), /Unsafe/u);
  assert.throws(() => validateArchiveListing("tracewhy/../escape\n"), /Unsafe/u);
  assert.throws(() => validateArchiveListing("tracewhy/a\ntracewhy/a\n"), /Duplicate/u);
});

test("allows only regular files and directories", () => {
  validateArchiveTypes("drwxr-xr-x root/root 0 date tracewhy/\n-rwxr-xr-x root/root 1 date tracewhy/tracewhy\n");
  assert.throws(() => validateArchiveTypes("lrwxrwxrwx root/root 0 date tracewhy/link -> /tmp/file\n"), /Unsupported/u);
});
