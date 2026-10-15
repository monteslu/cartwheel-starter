# Shared by build.sh, run.sh, test.sh, shot.sh, programs.sh and release.sh:
# the tool check, the pinned engine SDKs (fetched on first use) and the build
# trees. Sourced, not run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS="$ROOT/deps"
SDKS="$DEPS/cartwheel-sdk"

# need <tool> <what for / how to get it>
missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1: $2"); }
check_tools() {
  need git "https://git-scm.com"
  need cmake "3.20 or newer: https://cmake.org (Ubuntu: sudo apt install cmake)"
  need ninja "https://ninja-build.org (Ubuntu: sudo apt install ninja-build; macOS: brew install ninja)"
  need curl "for fetching the engine SDK"
  need tar "for unpacking the engine SDK"
  need node "Node.js 20 or newer: https://nodejs.org (packs the .wasc, runs the tests)"
  command -v cc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 ||
    missing+=("a C compiler: Ubuntu: sudo apt install build-essential; macOS: xcode-select --install")
  if [ ${#missing[@]} -gt 0 ]; then
    echo "missing tools:" >&2
    printf '  %s\n' "${missing[@]}" >&2
    exit 1
  fi
}

# this machine's SDK target
host_target() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo linux-x64 ;;
    Linux-aarch64) echo linux-arm64 ;;
    Darwin-arm64) echo macos-arm64 ;;
    *) echo "no cartwheel SDK runs on $(uname -s) $(uname -m) (Linux x64 or arm64, or an Apple silicon Mac)" >&2; exit 1 ;;
  esac
}

sha_check() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet -; else shasum -a 256 -c --quiet -; fi; }

# fetch_sdk <target>: the SDK pinned in scripts/deps.lock into deps/cartwheel-sdk/<target>
fetch_sdk() {
  local t=$1 line url ver sha dst="$SDKS/$1"
  line="$(grep -E "^cartwheel-sdk:$t[[:space:]]" "$ROOT/scripts/deps.lock")" || { echo "scripts/deps.lock pins no SDK for $t" >&2; exit 1; }
  read -r _ url ver sha <<< "$line"
  [ -f "$dst/.version" ] && [ "$(cat "$dst/.version")" = "$ver $sha" ] && return 0
  echo "fetching the cartwheel $ver SDK for $t"
  mkdir -p "$DEPS/.dl"
  local tgz="$DEPS/.dl/$(basename "$url")"
  [ -f "$tgz" ] || { curl -fsSL "$url" -o "$tgz.part" && mv -f "$tgz.part" "$tgz"; } || { echo "download failed: $url" >&2; exit 1; }
  echo "$sha  $tgz" | sha_check || { echo "$tgz: sha256 mismatch" >&2; rm -f "$tgz"; exit 1; }
  rm -rf "$dst" && mkdir -p "$dst"
  tar -xzf "$tgz" -C "$dst" --strip-components=1
  echo "$ver $sha" > "$dst/.version"
}

# sdk <target>: its directory, fetched (and its toolchain) on first use.
# CARTWHEEL_SDK=<dir holding <target>/ directories> uses other SDKs (an
# engine checkout's out/sdk, say).
sdk() {
  local t=$1
  if [ -n "${CARTWHEEL_SDK:-}" ]; then echo "$CARTWHEEL_SDK/$t"; return; fi
  fetch_sdk "$t" >&2
  case "$t" in
    cart|cart-wgpu) "$SDKS/$t/scripts/fetch-deps.sh" --only wasi-sdk,binaryen >/dev/null ;; # the exact wasi-sdk its bitcode needs
  esac
  echo "$SDKS/$t"
}

# configure <tree> <sdk dir> [cmake args...]: build/<tree> (cheap when nothing changed)
configure() {
  local tree=$1 s=$2; shift 2
  cmake -S "$ROOT" -B "$ROOT/build/$tree" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -Dcartwheel_DIR="$s/lib/cmake/cartwheel" "$@" >/dev/null
}
