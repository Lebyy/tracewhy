# TraceWhy

TraceWhy explains why a command works in one Linux environment and fails in another. It records a good run and a bad run, compares process and filesystem evidence, removes noise, ranks likely causes, and links every finding to trace evidence.

## Install

```bash
npm install --global tracewhy
```

The npm installer downloads the matching official `v1.0.1` Linux release, verifies its published SHA-256 digest, and installs it inside the package. TraceWhy then runs entirely offline without accounts, API keys, telemetry, cloud services, or AI.

Supported npm targets are glibc-based Linux x86-64 and ARM64. `strace` is required only for recording. macOS ARM64 and Windows x86-64 support analysis when built from source; native recording remains Linux-only in v1.

```bash
tracewhy record good -- your-command
tracewhy record bad -- your-command
tracewhy compare good bad
tracewhy view good bad
```

Documentation, source, checksums, SBOMs, and provenance are available in the [TraceWhy repository](https://github.com/Lebyy/tracewhy).
