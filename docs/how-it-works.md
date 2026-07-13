# How TraceWhy works

## Capture

The CLI runs one command under `strace -ff`, follows its descendants, and records selected process, file, identity, executable, and path-resolution system calls. It enables `--kill-on-exit` when the installed `strace` supports it and otherwise isolates the trace in a `setsid` process group for safe interruption and limit cleanup. Per-process trace files make parent/child evidence reconstructable. stdout, stderr, exit status, timing, working directory, Linux metadata, and a minimized redacted environment snapshot accompany the trace. Output streams are fully drained but only a bounded prefix is retained; aggregate trace size is monitored while the command runs.

Raw files are temporary. Credential-shaped values and known secret values are replaced before parsing; the normalized event stream keeps only operation, normalized resource, result, process identity, and a reference to the temporary source location.

## Parsing and process model

The Rust engine stream-reads trace files, joins unfinished/resumed syscall pairs, parses quoted paths and symbolic errors, maps volatile PIDs to stable `p1`, `p2`, and so on, and derives parent relationships from process-creation results. Successful file descriptors and working-directory changes resolve relative `*at` resources when evidence permits.

Unrecognized lines increment a completeness counter instead of silently disappearing. File count, total trace bytes, line length, event count, and serialized event size are bounded before data can exhaust memory or disk.

## Normalization

Home prefixes become `~`; the recording root becomes `$PROJECT`; random temporary components, PIDs, and file-descriptor identities are aliased. The raw evidence reference remains attached. Known `/proc`, locale, loader-cache, and runtime-cache differences may be kept in the ignored-noise list rather than influencing diagnosis.

## Alignment and rules

TraceWhy aligns normalized process order and resource operations. It then finds:

1. the same operation/resource succeeding in good and failing in bad;
2. aligned `execve` operations resolving to different paths;
3. libraries with the same identity resolving or loading differently;
4. aligned child processes exiting differently;
5. relevant working-directory or allowlisted environment changes.

This is semantic comparison, not a raw line diff.

## Ranking

Direct good/bad contrast starts with the strongest weight. Error codes such as `ENOENT`, `EACCES`, `EPERM`, and loader failures, plus a stderr reference, increase the score. Incomplete capture subtracts 25 and prevents unsupported certainty. High confidence requires a score of at least 75 and linked trace evidence; 50–74 is medium; lower findings are supporting differences. Every applied reason is emitted in JSON and displayed in the report.

Given the same normalized inputs and TraceWhy version, findings and their order are deterministic. Comparison IDs are derived from recording IDs rather than random state.
