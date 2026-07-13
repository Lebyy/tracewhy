#!/usr/bin/env bash
set -euo pipefail

data="${1:?data directory is required}"
expected="${2:?expected result is required}"
output="${data}/demo-comparison.json"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

set +e
tracewhy compare good bad --data-dir "${data}" --json > "${output}"
status=$?
set -e

if (( status > 1 )); then
  echo "TraceWhy comparison failed with exit ${status}." >&2
  exit "${status}"
fi

bun "${root}/verify.ts" "${output}" "${expected}" "${status}"
