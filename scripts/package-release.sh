#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: package-release.sh VERSION ARCH}"
arch="${2:?usage: package-release.sh VERSION ARCH}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage="${root}/dist/stage/tracewhy"
archive="tracewhy-linux-${arch}.tar.gz"
cli_binary="${TRACEWHY_CLI_BINARY:-${root}/dist/tracewhy}"
core_binary="${TRACEWHY_CORE_BINARY:-${root}/target/release/tracewhy-trace-core}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Release archives must be built on Linux so they contain Linux binaries." >&2
  exit 2
fi
if [[ ! "${version}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Release version must be a v-prefixed semantic version." >&2
  exit 2
fi
package_version="$(bun -p "require('${root}/package.json').version")"
if [[ "${version}" != "v${package_version}" ]]; then
  echo "Release tag ${version} does not match package version v${package_version}." >&2
  exit 2
fi
case "${arch}" in
  x64|arm64) ;;
  *) echo "Unsupported release architecture: ${arch}" >&2; exit 2 ;;
esac
for path in "${cli_binary}" "${core_binary}" "${root}/apps/web/.next/standalone/apps/web/server.js"; do
  [[ -f "${path}" ]] || { echo "Missing release input: ${path}" >&2; exit 2; }
done
[[ -d "${root}/apps/web/.next/standalone/apps/web/.next/static" ]] || { echo "Missing staged report assets." >&2; exit 2; }
bun_binary="$(command -v bun)"
[[ -n "${bun_binary}" && -x "${bun_binary}" ]] || { echo "Bun is required to package the report runtime." >&2; exit 2; }

rm -rf "${root}/dist/stage"
mkdir -p "${stage}/web"
cp "${cli_binary}" "${stage}/tracewhy"
cp "${core_binary}" "${stage}/tracewhy-trace-core"
cp "${bun_binary}" "${stage}/bun"
cp -RL "${root}/apps/web/.next/standalone/." "${stage}/web/"
cp -R "${root}/docs" "${stage}/docs"
mkdir -p "${stage}/schemas"
cp "${root}/packages/schema/"*.schema.json "${stage}/schemas/"
cp "${root}/README.md" "${root}/LICENSE" "${root}/CHANGELOG.md" "${root}/SECURITY.md" "${root}/SUPPORT.md" "${stage}/"
printf '%s\n' "${version}" > "${stage}/VERSION"
chmod 755 "${stage}/tracewhy" "${stage}/tracewhy-trace-core" "${stage}/bun"
find "${stage}" -type d -exec chmod 755 {} +
find "${stage}" -type f ! -name tracewhy ! -name tracewhy-trace-core ! -name bun -exec chmod 644 {} +
if find "${stage}" -type l -print -quit | grep -q .; then
  echo "Release staging contains a symbolic link." >&2
  exit 2
fi
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "${root}/dist/stage" -cf - tracewhy | gzip -n -9 > "${root}/dist/${archive}"
(
  cd "${root}/dist"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$archive" > SHA256SUMS; else shasum -a 256 "$archive" > SHA256SUMS; fi
)
echo "Packaged TraceWhy ${version} for linux-${arch}."
