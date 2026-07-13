#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATH="${root}/dist:${PATH}" "${root}/demos/run-all.sh"
"${root}/scripts/verify-production-limits.sh"
