#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
build="${root}/.build"
mkdir -p "${build}"
cc -std=c11 -O2 -Wall -Wextra -Werror "${root}/permission-reader.c" -o "${build}/permission-reader"
chmod 600 "${root}/locked.txt"
tracewhy record good --data-dir "${data}" --overwrite -- "${build}/permission-reader" "${root}/locked.txt"
chmod 000 "${root}/locked.txt"
cleanup() {
  chmod 600 "${root}/locked.txt"
  rm -rf "${build}"
}
trap cleanup EXIT
set +e
tracewhy record bad --data-dir "${data}" --overwrite -- "${build}/permission-reader" "${root}/locked.txt"
status=$?
set -e
[[ "${status}" -eq 77 ]] || { echo "Expected bad recording exit 77, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
