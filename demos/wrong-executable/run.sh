#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
PATH="${root}/bin-good:${PATH}" tracewhy record good --data-dir "${data}" --overwrite -- tracewhy-demo-tool
set +e
PATH="${root}/bin-bad:${PATH}" tracewhy record bad --data-dir "${data}" --overwrite -- tracewhy-demo-tool
status=$?
set -e
[[ "${status}" -eq 9 ]] || { echo "Expected bad recording exit 9, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
