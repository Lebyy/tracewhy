# Release process

TraceWhy publishes Linux x86-64 and ARM64 archives from `v*` Git tags through `.github/workflows/release.yml`. The tag must exactly match the synchronized version in the Bun workspaces, Rust workspace, CLI, and changelog. Protect release tags in the GitHub repository and require the release workflow to pass before treating an artifact as supported.

Each architecture runs strict checks, dependency audits, tests, the production build, all six live `strace` demos, portable binary compilation, deterministic packaging, and a clean installation smoke test. The smoke test verifies CLI and Rust engine versions, a real comparison, local report startup, loopback access, and security headers.

The tagged commit must already have green portable-analysis jobs on macOS ARM64 and Windows x86-64. Those jobs validate analysis from source; v1 release archives remain Linux-only because native recording remains Linux-only. Do not label the macOS or Windows analysis build as a native recorder.

Release output contains:

- `tracewhy-linux-x64.tar.gz` with a baseline x86-64 CLI, static Rust engine, pinned report runtime, and standalone report;
- `tracewhy-linux-arm64.tar.gz` with the corresponding ARM64 components;
- `SHA256SUMS` with exactly one digest per archive;
- an SPDX JSON software bill of materials for each architecture;
- GitHub build-provenance attestations bound to the archives and SBOMs.

GitHub Actions dependencies are pinned to immutable commits. Bun, Rust, JavaScript packages, and Rust crates are locked to reviewed versions. The publish job runs only after both architecture jobs complete.

To validate a locally built archive on Linux:

```bash
./scripts/package-release.sh v1.0.0 x64
./scripts/verify-release.sh dist/tracewhy-linux-x64.tar.gz
```

`TRACEWHY_CORE_BINARY` can point packaging at a musl target build. The release workflow uses this to ship a static Rust engine. Never upload an archive produced with a dirty or unreviewed lockfile.
