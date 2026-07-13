# TraceWhy reproducible demonstrations

Each directory contains one intentionally different good/bad Linux environment and an `expected.json` file naming the diagnosis that must rank first. Build the CLI, put `tracewhy` on `PATH`, and run any demo's `run.sh`. Every demo keeps recordings in its own ignored `.tracewhy` directory.

Run all demos on Linux with:

```bash
./demos/run-all.sh
```

The scripts require Bun, `strace`, and a C compiler.

| Demo | Capability evidence |
| --- | --- |
| `missing-config` | File access and a missing resource |
| `permission-denied` | File permissions and `EACCES` |
| `wrong-executable` | PATH resolution and executable selection |
| `wrong-working-directory` | Working directory and relative path resolution |
| `child-failure` | Process trees and child exit propagation |
| `shared-library` | Dynamic loader and shared-library resolution |

After all six captures succeed, build the selectable local-report casebook with:

```bash
bun run build:showcase
```
