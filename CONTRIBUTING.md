# Contributing to TraceWhy

Thank you for helping make environment debugging more evidence-driven. Contributions are welcome when they preserve deterministic behavior, local operation, and trace-data safety.

## Before you start

Use an issue for a new diagnosis, schema change, capture backend, or user-visible workflow before investing in a large implementation. Small bug fixes, tests, documentation, and accessibility improvements can go directly to a focused pull request.

By submitting a contribution, you agree that it is licensed under the repository's Apache License 2.0 and that you have the right to submit it. Follow the [code of conduct](CODE_OF_CONDUCT.md) and never post unreviewed trace data.

## Setup

Install Bun 1.3.14 and Rust 1.97.0. Linux contributors also need `strace` for capture tests. Then run:

```bash
bun install --frozen-lockfile
bun run audit:js
bun run check
bun run test
bun run build
```

Keep component boundaries strict: TypeScript owns capture and user workflows; Rust owns parsing, normalization, comparison, diagnosis, and ranking; the report consumes only the versioned comparison contract.

Comments should preserve a non-obvious invariant, security boundary, or design reason. Do not restate control flow, retain commented-out code, suppress unused code, or weaken strict compiler and linter checks to make a change pass.

## Tests

Add Rust unit coverage for parser or rule changes, CLI integration coverage for workflow changes, and a sanitized fixture for every newly supported trace shape. Seed fake secrets in redaction tests. Fixtures must contain no real usernames, tokens, home paths, customer names, or proprietary commands.

Run on every platform before opening a pull request:

```bash
bun run check
bun run test
bun run build
bun run verify:portable
```

To run the same clean Linux gate and live tracing scenarios used for release validation:

```bash
docker build --file Dockerfile.quality --tag tracewhy-quality .
docker run --rm --cap-add SYS_PTRACE --security-opt seccomp=unconfined tracewhy-quality
```

The GitHub matrix repeats portable analysis on macOS ARM64 and Windows x86-64 and runs native capture on Linux x86-64 and ARM64. See [platform support](docs/platform-support.md).

## Adding a diagnosis

1. Add a sanitized good/bad fixture that isolates one environmental difference.
2. Parse and normalize only the evidence required to distinguish that difference.
3. Add a deterministic Rust rule with explicit confidence inputs and completeness penalties.
4. Link every claim to stable event identifiers from both runs when available.
5. Add unit, schema, CLI integration, and report-boundary coverage as applicable.
6. Document expected false positives, false negatives, and unsupported trace shapes.

Do not rank a difference more highly because it sounds plausible. Ranking must derive from captured evidence and documented rules.

## Schemas and compatibility

Schema files in `packages/schema` are the compatibility boundary. Additive fields must remain optional when older recordings can omit them. Breaking changes require a new schema version, migrations or a clear rejection path, fixture updates, and release notes. Never silently reinterpret existing evidence.

## Pull requests

Keep changes focused, explain user-visible behavior and false-positive risk, update schemas and generated types together, document format changes, and include before/after fixture evidence. Never weaken confidence for incomplete captures or add an external diagnosis service.

Pull requests must pass CI, CodeQL, dependency review, and maintainer review. Resolve review threads with code or evidence rather than merely marking them resolved. Squash fixup noise before merge when requested; maintainers may squash-merge.

## Commit style

Write imperative subjects that describe the outcome, such as `Detect relative-path working-directory failures`. Avoid generated attribution trailers and unrelated formatting churn. One commit may span multiple components when the change is one coherent vertical slice.
