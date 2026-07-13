# TraceWhy full diagnostic casebook

This fixture is built from six native Linux `strace` captures produced by the public scripts in `demos/`. It is not hand-authored presentation data. Every case retains its good and bad recording, generated comparison, normalized events, command output, system metadata, process tree, and evidence references.

| Case | Capabilities demonstrated | Leading finding |
| --- | --- | --- |
| `missing-config` | File access | `missing_file` |
| `permission-denied` | Permissions, file access | `permission_problem` |
| `wrong-executable` | PATH resolution, executable selection | `different_executable` |
| `wrong-working-directory` | Working directory, relative file access | `working_directory_difference` |
| `child-failure` | Process trees, child exits | `child_process_failure` |
| `shared-library` | Shared libraries and loader resolution | `shared_library_difference` |

Rebuild `suite.json` after running every demo on Linux:

```bash
bun run build:showcase
```

The suite exists for the local visual report and project screenshots. Individual comparison files remain valid ordinary TraceWhy outputs.
