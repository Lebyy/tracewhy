#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tracewhy="${TRACEWHY_BINARY:-${root}/dist/tracewhy}"
temporary="$(mktemp -d)"
trap 'rm -rf "${temporary}"' EXIT INT TERM

set +e
"${tracewhy}" record output-limit --data-dir "${temporary}/data" --max-output-bytes 64 -- \
  awk 'BEGIN { for (i = 0; i < 4096; i++) printf "x" }' > /dev/null
output_exit=$?
set -e
[[ "${output_exit}" -eq 0 ]]
output_recording="${temporary}/data/recordings/output-limit"
grep -q '"stdout_truncated": true' "${output_recording}/manifest.json"
[[ "$(wc -c < "${output_recording}/stdout.log")" -le 64 ]]

set +e
"${tracewhy}" record trace-limit --data-dir "${temporary}/data" --max-trace-bytes 1 -- /bin/true > /dev/null 2>&1
trace_exit=$?
set -e
[[ "${trace_exit}" -ne 2 ]]
trace_recording="${temporary}/data/recordings/trace-limit"
grep -q '"trace_complete": false' "${trace_recording}/manifest.json"
grep -q 'Trace capture exceeded 1 bytes' "${trace_recording}/manifest.json"

[[ "$(stat -c '%a' "${temporary}/data/recordings")" == "700" ]]
for file in manifest.json events.jsonl stdout.log stderr.log; do
  [[ "$(stat -c '%a' "${output_recording}/${file}")" == "600" ]]
done

echo "Verified output, trace, and private-permission production limits."
