#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
build="${root}/.build"
mkdir -p "${build}"
cc -std=c11 -O2 -Wall -Wextra -Werror "${root}/child-worker.c" -o "${build}/child-worker"
cc -std=c11 -O2 -Wall -Wextra -Werror "${root}/supervisor.c" -o "${build}/supervisor"
trap 'rm -rf "${build}"' EXIT
TRACEWHY_DEMO_CHILD_EXIT=0 tracewhy record good --data-dir "${data}" --overwrite -- "${build}/supervisor" "${build}/child-worker"
set +e
TRACEWHY_DEMO_CHILD_EXIT=7 tracewhy record bad --data-dir "${data}" --overwrite -- "${build}/supervisor" "${build}/child-worker"
status=$?
set -e
[[ "${status}" -eq 7 ]] || { echo "Expected bad recording exit 7, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
