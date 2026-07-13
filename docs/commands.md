# Command reference

## `tracewhy record`

```text
tracewhy record NAME [--data-dir DIR] [--overwrite] [--max-output-bytes N] [--max-trace-bytes N] -- COMMAND [ARGS...]
```

Runs the command under Linux `strace`, follows descendants, captures bounded stdout/stderr, redacts the environment and output, parses trace files, and atomically stores the result. The target command's exit status is returned. Existing names are protected unless `--overwrite` is explicit. An interrupted temporary recording is removed. stdout and stderr default to 2 MiB each; aggregate raw trace input defaults to 128 MiB. Exceeding the trace limit stops the traced process tree and marks the capture incomplete.

## `tracewhy compare`

```text
tracewhy compare GOOD BAD [--data-dir DIR] [--json]
```

`GOOD` and `BAD` may be recording names, recording directories, or `.tracewhy` bundle paths. Terminal output is the default; `--json` prints the versioned comparison contract.

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | Comparison completed without a high-confidence likely cause. |
| 1 | Comparison completed with at least one high-confidence likely cause. |
| 2 | Invalid arguments, missing/incompatible data, or internal failure. |

## `tracewhy view`

```text
tracewhy view GOOD BAD [--data-dir DIR] [--port 4317] [--no-open]
```

Creates the comparison and starts the visual report on `127.0.0.1`. `--no-open` avoids launching the system browser. Stop the server with Ctrl+C.

## `tracewhy pack`

```text
tracewhy pack RECORDING --output FILE.tracewhy [--data-dir DIR]
```

Creates a deterministic portable compressed recording. Import accepts only the four v1 top-level regular files, rejects links and unsafe paths, and enforces per-entry and archive limits. Treat bundles as sensitive diagnostic artifacts even though normalized secrets are redacted.

## `tracewhy export`

```text
tracewhy export GOOD BAD --format html|json --output FILE [--data-dir DIR]
```

HTML output embeds redacted data, styling, and report behavior in one file and opens without a server or internet connection. JSON output uses `packages/schema/comparison.schema.json`.

## Shared storage option

`--data-dir DIR` replaces the project-local `.tracewhy` root for the current command. It does not change a global configuration file.
