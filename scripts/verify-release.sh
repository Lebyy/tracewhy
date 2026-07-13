#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: verify-release.sh ARCHIVE}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive="$(cd "$(dirname "${archive}")" && pwd)/$(basename "${archive}")"
temporary="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
  rm -rf "${temporary}"
}
trap cleanup EXIT INT TERM

version="$(tar -xOf "${archive}" tracewhy/VERSION)"
home="${temporary}/home"
bin_dir="${home}/.local/bin"
lib_dir="${home}/.local/lib/tracewhy"
mkdir -p "${home}"
HOME="${home}" \
TRACEWHY_VERSION="${version}" \
TRACEWHY_RELEASE_BASE="file://$(dirname "${archive}")" \
TRACEWHY_INSTALL_DIR="${bin_dir}" \
TRACEWHY_LIB_DIR="${lib_dir}" \
  sh "${root}/scripts/install.sh"

[[ "$("${bin_dir}/tracewhy" --version)" == "tracewhy ${version#v}" ]]
[[ "$("${bin_dir}/tracewhy-trace-core" --version)" == "${version#v}" ]]

good="${root}/packages/fixtures/missing-file/good"
bad="${root}/packages/fixtures/missing-file/bad"
data_dir="${temporary}/data"
set +e
"${bin_dir}/tracewhy" compare "${good}" "${bad}" --data-dir "${data_dir}" --json > "${temporary}/comparison.json"
comparison_exit=$?
set -e
[[ "${comparison_exit}" -eq 1 ]]
grep -q '"type": "missing_file"' "${temporary}/comparison.json"

port=$((42000 + ($$ % 10000)))
"${bin_dir}/tracewhy" view "${good}" "${bad}" --data-dir "${data_dir}" --port "${port}" --no-open > "${temporary}/server.log" 2>&1 &
server_pid=$!
ready=0
for _ in {1..100}; do
  if curl -fsS "http://127.0.0.1:${port}" > "${temporary}/report.html" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "${ready}" -ne 1 ]]; then
  cat "${temporary}/server.log" >&2
  exit 1
fi
grep -q 'TraceWhy' "${temporary}/report.html"
curl -fsSI "http://127.0.0.1:${port}" | grep -qi '^content-security-policy:'
kill "${server_pid}"
wait "${server_pid}" 2>/dev/null || true
server_pid=""

echo "Verified clean TraceWhy ${version} installation, comparison, and local report startup."
