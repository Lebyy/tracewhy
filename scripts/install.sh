#!/usr/bin/env sh
set -eu
umask 077

repository="${TRACEWHY_REPOSITORY:-Lebyy/tracewhy}"
version="${TRACEWHY_VERSION:-latest}"
install_dir="${TRACEWHY_INSTALL_DIR:-$HOME/.local/bin}"
lib_dir="${TRACEWHY_LIB_DIR:-$HOME/.local/lib/tracewhy}"
release_base="${TRACEWHY_RELEASE_BASE:-}"

case "$(uname -s)" in
  Linux) ;;
  *) echo "TraceWhy v1 records commands only on Linux." >&2; exit 2 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch="x64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 2 ;;
esac

if command -v ldd >/dev/null 2>&1; then
  case "$(ldd --version 2>&1 || true)" in
    *musl*) echo "TraceWhy v1 release archives target glibc-based Linux distributions; musl-only systems are not supported." >&2; exit 2 ;;
  esac
fi

for command in curl tar awk head mktemp sed; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required to install TraceWhy." >&2; exit 2; }
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "sha256sum or shasum is required to verify TraceWhy." >&2
  exit 2
fi
if [ "$version" = "latest" ]; then
  [ -z "$release_base" ] || { echo "TRACEWHY_VERSION is required with TRACEWHY_RELEASE_BASE." >&2; exit 2; }
  version="$(
    curl -fsSL "https://api.github.com/repos/${repository}/releases/latest" \
      | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' \
      | head -n 1
  )"
fi
[ -n "$version" ] || { echo "Could not determine the latest TraceWhy version." >&2; exit 2; }

archive="tracewhy-linux-${arch}.tar.gz"
base="${release_base:-https://github.com/${repository}/releases/download/${version}}"
temporary="$(mktemp -d)"
web_new="${lib_dir}/.web-new-$$"
web_backup="${lib_dir}/.web-backup-$$"
runtime_new="${lib_dir}/.bun-new-$$"
cli_new="${install_dir}/.tracewhy-new-$$"
core_new="${install_dir}/.tracewhy-trace-core-new-$$"
web_swapped=0
cleanup() {
  rm -rf "$temporary" "$web_new"
  rm -f "$runtime_new" "$cli_new" "$core_new"
  if [ -d "$web_backup" ]; then
    if [ "$web_swapped" -eq 1 ]; then rm -rf "$web_backup"; elif [ ! -e "$lib_dir/web" ]; then mv "$web_backup" "$lib_dir/web"; fi
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

curl -fsSL "${base}/${archive}" -o "${temporary}/${archive}"
curl -fsSL "${base}/SHA256SUMS" -o "${temporary}/SHA256SUMS"
(
  cd "$temporary"
  expected="$(
    awk -v archive="$archive" '
      $2 == archive { count += 1; digest = $1 }
      END { if (count != 1) exit 1; print digest }
    ' SHA256SUMS
  )"
  [ "${#expected}" -eq 64 ] || { echo "TraceWhy checksum entry is invalid." >&2; exit 2; }
  case "$expected" in *[!0-9A-Fa-f]*) echo "TraceWhy checksum entry is invalid." >&2; exit 2 ;; esac
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
  else
    actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
    [ "$expected" = "$actual" ] || { echo "TraceWhy checksum verification failed." >&2; exit 2; }
  fi
  tar -tzf "$archive" | awk '
    BEGIN { valid = 1 }
    /^\// { valid = 0 }
    !/^tracewhy(\/|$)/ { valid = 0 }
    /(^|\/)\.\.(\/|$)/ { valid = 0 }
    { if (seen[$0]++ > 0) valid = 0 }
    END { if (NR == 0 || valid == 0) exit 1 }
  ' || { echo "TraceWhy archive contains an unsafe path." >&2; exit 2; }
  tar -tvzf "$archive" | awk '
    BEGIN { valid = 1 }
    substr($1, 1, 1) != "-" && substr($1, 1, 1) != "d" { valid = 0 }
    END { if (valid == 0) exit 1 }
  ' || { echo "TraceWhy archive contains an unsupported entry type." >&2; exit 2; }
  tar -xzf "$archive"
)

for required in tracewhy tracewhy-trace-core bun web/apps/web/server.js; do
  [ -e "${temporary}/tracewhy/${required}" ] || { echo "TraceWhy archive is missing ${required}." >&2; exit 2; }
done

mkdir -p "$install_dir" "$lib_dir"
chmod 700 "$lib_dir"
cp "${temporary}/tracewhy/tracewhy" "$cli_new"
cp "${temporary}/tracewhy/tracewhy-trace-core" "$core_new"
cp "${temporary}/tracewhy/bun" "$runtime_new"
cp -R "${temporary}/tracewhy/web" "$web_new"
chmod 755 "$cli_new" "$core_new" "$runtime_new"

[ ! -e "$lib_dir/web" ] || mv "$lib_dir/web" "$web_backup"
if ! mv "$web_new" "$lib_dir/web"; then
  [ ! -d "$web_backup" ] || mv "$web_backup" "$lib_dir/web"
  exit 2
fi
web_swapped=1
mv "$runtime_new" "$lib_dir/bun"
mv "$core_new" "$install_dir/tracewhy-trace-core"
mv "$cli_new" "$install_dir/tracewhy"
rm -rf "$web_backup"

echo "TraceWhy ${version} installed in ${install_dir}."
case ":$PATH:" in *":${install_dir}:"*) ;; *) echo "Add ${install_dir} to PATH." ;; esac
command -v strace >/dev/null 2>&1 || echo "strace is required for recording. Install it with apt, dnf, pacman, or apk."
