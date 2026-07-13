#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for demo in missing-config permission-denied wrong-executable shared-library child-failure wrong-working-directory; do
  echo "Running ${demo}"
  "${root}/${demo}/run.sh"
done
