#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
build="${root}/.build"
mkdir -p "${build}" "${root}/bad"
cc -std=c11 -O2 -Wall -Wextra -Werror "${root}/config-reader.c" -o "${build}/config-reader"
trap 'rm -rf "${build}"' EXIT
(cd "${root}/good" && tracewhy record good --data-dir "${data}" --overwrite -- "${build}/config-reader")
set +e
(cd "${root}/bad" && tracewhy record bad --data-dir "${data}" --overwrite -- "${build}/config-reader")
status=$?
set -e
[[ "${status}" -eq 78 ]] || { echo "Expected bad recording exit 78, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
