# Platform support

TraceWhy has two independent platform surfaces: **capture** and **analysis**. A platform is not advertised as a native capture target until its backend can follow descendant processes, retain the required filesystem and loader evidence, enforce size limits, redact before persistence, and pass the same reproducible incident suite as Linux.

## Support matrix

| Platform | Native recording | Portable analysis | Automated runner |
| --- | --- | --- | --- |
| glibc Linux x86-64 | Supported with `strace` | Supported | `ubuntu-24.04` |
| glibc Linux ARM64 | Supported with `strace` | Supported | `ubuntu-24.04-arm` |
| macOS ARM64 | Not available in v1 | Supported from source | `macos-15` |
| Windows x86-64 | Not available in v1 | Supported from source | `windows-2025` |

Portable analysis includes `compare`, `pack`, `export`, and `view`. A Linux recording directory or `.tracewhy` bundle can be transferred to macOS or Windows and analyzed without Linux, `strace`, or network access.

## Why capture remains Linux-only

`strace` is a Linux process-tracing interface. macOS and Windows do not expose compatible semantics, and translating the command name would produce incomplete or misleading evidence.

A credible macOS backend needs to evaluate Endpoint Security and DTrace behavior, privileges, signing/entitlements, descendant tracking, and library-resolution visibility. A credible Windows backend needs to evaluate ETW providers, Process Monitor-compatible signals, process ancestry, file-result mapping, and DLL search evidence. Both backends must normalize into the existing event schema without making platform-specific evidence look equivalent when it is not.

## Testing locally

On any supported analysis platform:

```bash
bun install --frozen-lockfile
bun run check:ts
cargo test --locked --workspace
bun run test:cli
bun run build
bun run verify:portable
```

`verify:portable` invokes the compiled native CLI and Rust engine, compares fixture recordings, imports a portable bundle, exports a self-contained report, starts the report server on loopback, fetches it, checks its content-security policy, and shuts it down.

Linux additionally validates native capture:

```bash
PATH="$PWD/dist:$PATH" ./demos/run-all.sh
./scripts/verify-production-limits.sh
```

The GitHub Actions matrix is the release authority. Local success on a platform not listed above is useful feedback but not a supported-platform claim.
