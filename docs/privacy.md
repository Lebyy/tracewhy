# Privacy and data handling

TraceWhy is entirely local and has no analytics, telemetry, hosted API, account, or upload feature.

## Captured

- command and arguments;
- working directory, duration, exit code or signal;
- Linux kernel, distribution, architecture, and libc metadata;
- allowlisted resolution-relevant environment values (`PATH`, loader/language paths, locale, and selected toolchain selectors);
- bounded stdout and stderr;
- selected `strace` operations, resource paths, process relationships, and return values.

## Never captured

- file contents;
- arbitrary process memory;
- network payloads;
- source-code uploads;
- keystrokes or unrelated processes.

## Redaction

Keys containing token, secret, password, credential, cookie, auth, private-key, API-key, and common cloud-secret conventions are used to identify values for redaction but are not persisted. Known secret values are removed from stdout, stderr, arguments, and temporary trace text. Bearer tokens, private-key blocks, common access-key prefixes, GitHub/GitLab-style tokens, Stripe-style keys, and JWT-shaped values are detected where practical.

Home-directory prefixes become `~` in persisted metadata; the project root becomes `$PROJECT` in normalized events. Redaction is intentionally conservative but cannot recognize every private identifier.

## Retention

Project-local recordings live under `.tracewhy/recordings`; comparisons live under `.tracewhy/comparisons`. Temporary raw trace files are removed after parsing or interruption cleanup. `--data-dir` controls the storage root. Delete that directory to remove retained evidence.

Recording and comparison directories use owner-only permissions. Manifests, event streams, logs, exports, and extracted bundles are created with owner-only file permissions. Release archives are intentionally shareable files and retain conventional read permissions after packaging.

stdout and stderr retain at most 2 MiB each by default and can be configured up to 4 MiB. Trace capture defaults to—and cannot exceed—128 MiB; `--max-trace-bytes` can lower that ceiling. Normalized event streams are limited to 32 MiB and 250,000 events; imported bundles are limited to 128 MiB compressed with stricter per-file limits.

## Sharing and exporting

JSON, HTML, and `.tracewhy` outputs use redacted persisted data. They can still expose command names, relative paths, library names, errors, and OS metadata. Inspect an artifact before sharing it. The visual server binds only to `127.0.0.1` by default, and the HTML report has no external asset or network dependency.
