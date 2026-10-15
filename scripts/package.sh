#!/usr/bin/env bash
# Build and package the game for one platform, as CI does for a release:
#   scripts/package.sh <linux-x64|linux-arm64|windows-x64|android-arm64|macos-arm64|wasc> [version]
# Packages land in out/release/. Windows and Android build on Linux; macOS on
# a Mac; the cart on Linux x64. Android needs the Android SDK and NDK
# (ANDROID_HOME, ANDROID_NDK_HOME).
. "$(dirname "$0")/lib.sh"
check_tools
t="${1:?usage: scripts/package.sh <target> [version]}"
ver="${2:-$(grep -E '^version *=' "$ROOT/project.cwproj" | sed 's/.*= *//')}"
host=$(host_target)
native=$(sdk "$host")
mkdir -p "$ROOT/out/release"
if [ "$t" = wasc ]; then # the release cart: ThinLTO and wasm-opt
  cart=$(sdk cart-wgpu)
  configure cart-release "$cart" -DCMAKE_TOOLCHAIN_FILE="$cart/cmake/cart.cmake" -DCW_CWPACK="$native/bin/cwpack"
  ninja -C "$ROOT/build/cart-release" gemdash
  cp "$ROOT/build/cart-release/carts/gemdash.wasc" "$ROOT/out/release/gemdash-$ver.wasc"
  ls -l "$ROOT/out/release"
  exit 0
fi
s=$(sdk "$t")
# the target's toolchain, pinned by the SDK, fetched into the host SDK
case "$t" in
  linux-x64|linux-arm64) "$native/scripts/fetch-deps.sh" --only "export/llvm-mingw,export/sysroot-$t,export/appimage-runtime-${t#linux-}" ;;
  windows-x64|android-arm64) "$native/scripts/fetch-deps.sh" --only export/llvm-mingw ;;
esac
configure "$t" "$s" -DCMAKE_TOOLCHAIN_FILE="$s/cmake/export/$t.cmake" -DCW_EXPORT_DEPS="$native/deps/export" -DCW_CWPACK="$native/bin/cwpack"
ninja -C "$ROOT/build/$t"
node "$native/tools/cwexport.mjs" --project "$ROOT" --preset "$t" --build "$ROOT/build/$t" --version "$ver" --out "$ROOT/out/export" |
  grep -E '^@result|rror'
find "$ROOT/out/export/$t" -maxdepth 1 -type f \( -name '*.tar.gz' -o -name '*.AppImage' -o -name '*.zip' -o -name '*.apk' \) -exec cp {} "$ROOT/out/release/" \;
ls -l "$ROOT/out/release"
