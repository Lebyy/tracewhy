# Troubleshooting

## `strace` is missing

Install it with your distribution's package manager:

```bash
sudo apt install strace       # Debian/Ubuntu
sudo dnf install strace       # Fedora/RHEL
sudo pacman -S strace         # Arch
sudo apk add strace           # Alpine
```

## `Operation not permitted` or incomplete capture

TraceWhy uses Linux `ptrace` through `strace`. Hardened hosts may restrict it. Check `/proc/sys/kernel/yama/ptrace_scope`, container seccomp/AppArmor policies, and CI runner permissions. Prefer granting `SYS_PTRACE` to the specific container rather than running it fully privileged. TraceWhy reports incomplete evidence and reduces confidence instead of hiding it.

Docker example:

```bash
docker run --cap-add=SYS_PTRACE --security-opt seccomp=unconfined ...
```

## Recording on macOS or Windows

Native recording requires Linux in v1. Record on a supported Linux x86-64 or ARM64 machine, then transfer the recording directory or a `.tracewhy` bundle. macOS ARM64 and Windows x86-64 source builds support `compare`, `pack`, `export`, and `view`; run `bun run verify:portable` to validate the compiled analysis workflow locally. See [platform support](platform-support.md).

## Alpine or another musl-only distribution

The v1 downloadable archives include Bun’s glibc runtime and do not support musl-only systems. Use a glibc-based Linux host or container. The installer detects musl and stops before changing the installation.

## Different root commands warning

Good and bad recordings should invoke the same logical command. Different wrappers or absolute root executables can make alignment less reliable. Re-record with matching entry points when possible.

## Large commands

stdout and stderr default to 2 MiB each and can be raised to 4 MiB with `--max-output-bytes`. Aggregate raw trace data is capped at 128 MiB; use `--max-trace-bytes` to impose a smaller ceiling for constrained environments. Trace files are read incrementally, while normalized events are retained for deterministic ordering and bounded at 250,000 events and 32 MiB. The report initially renders a bounded window and exposes more events on demand.

If a limit is exceeded, TraceWhy either stops capture and marks it incomplete or rejects the input before comparison. Do not raise limits merely to hide repetitive trace noise; narrow the recorded command first.

## Containers and CI

Confirm Bun and `strace` exist inside the environment that runs the command. Record inside the container when the failing process runs there; tracing only the host launcher will not expose inner filesystem interactions.

## Schema incompatibility

Recordings contain `schema_version`. Compare with a TraceWhy version supporting that schema or export/re-record using compatible versions. The engine returns exit code 2 rather than guessing.
