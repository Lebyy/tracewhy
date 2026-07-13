#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
data="${root}/.tracewhy"
build="${root}/.build"
rm -rf "${build}"
mkdir -p "${build}"
cc -std=c11 -O2 -Wall -Wextra -Werror -D_GNU_SOURCE "${root}/config-preflight.c" -o "${build}/config-preflight"
cc -std=c11 -O2 -Wall -Wextra -Werror "${root}/media-worker.c" -o "${build}/media-worker"
(
  cd "${root}"
  tracewhy record good --data-dir "${data}" --overwrite -- ./.build/media-worker --config worker.toml
)
mv "${root}/worker.toml" "${root}/worker.toml.hidden"
cleanup() {
  mv "${root}/worker.toml.hidden" "${root}/worker.toml" 2>/dev/null || true
  rm -rf "${build}"
}
trap cleanup EXIT
set +e
(
  cd "${root}"
  tracewhy record bad --data-dir "${data}" --overwrite -- ./.build/media-worker --config worker.toml
)
status=$?
set -e
[[ "${status}" -eq 78 ]] || { echo "Expected bad recording exit 78, received ${status}." >&2; exit 2; }
"${root}/../compare-and-verify.sh" "${data}" "${root}/expected.json"
