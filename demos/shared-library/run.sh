#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
make -C "${root}" all
LD_LIBRARY_PATH="${root}/good" tracewhy record good --data-dir "${data}" --overwrite -- "${root}/build/demo"
mv "${root}/good/libdemo.so" "${root}/bad/libdemo.so.hidden"
trap 'mv "${root}/bad/libdemo.so.hidden" "${root}/good/libdemo.so" 2>/dev/null || true' EXIT
set +e
LD_LIBRARY_PATH="${root}/bad" tracewhy record bad --data-dir "${data}" --overwrite -- "${root}/build/demo"
status=$?
set -e
[[ "${status}" -eq 127 ]] || { echo "Expected bad recording exit 127, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
