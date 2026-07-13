# Showcase comparison

This fixture is an immutable snapshot produced by `demos/missing-config/run.sh` on native Linux with TraceWhy's real recorder, `strace`, parser, normalizer, and comparison engine. A media worker launches a configuration-preflight child. The good child opens `worker.toml` and exits successfully; the bad child receives `ENOENT`, exits 78, and the parent propagates that status.

```bash
tracewhy view packages/fixtures/showcase/good packages/fixtures/showcase/bad
```

The recording manifests retain the actual capture environment and exact output byte counts. The normalized event stream contains one direct cause and its downstream process consequence; it is not expanded with hand-authored failures for visual coverage.
