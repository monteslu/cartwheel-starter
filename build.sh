#!/usr/bin/env bash
# Build the game for this machine (build/native/gemdash) and as a cart
# (build/cart/carts/gemdash.wasc). The first run fetches the engine SDK.
#   RELEASE=1 ./build.sh   the cart as releases ship it (slower link, smaller and faster cart)
. "$(dirname "$0")/scripts/lib.sh"
check_tools
host=$(host_target)
native=$(sdk "$host")
configure native "$native"
ninja -C "$ROOT/build/native"
if [ "$host" = linux-x64 ]; then # the cart toolchain (wasi-sdk) runs on Linux x64
  cart=$(sdk cart-wgpu)
  configure cart "$cart" -DCMAKE_TOOLCHAIN_FILE="$cart/cmake/cart.cmake" -DCW_CWPACK="$native/bin/cwpack" \
    -DCW_CART_DEV=$([ -n "${RELEASE:-}" ] && echo OFF || echo ON)
  ninja -C "$ROOT/build/cart"
  echo "built build/native/gemdash and build/cart/carts/gemdash.wasc"
else
  echo "built build/native/gemdash (carts build on Linux x64; CI builds them on every push)"
fi
