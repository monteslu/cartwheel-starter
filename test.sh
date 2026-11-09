#!/usr/bin/env bash
# Every check, each with a control that must fail (tests/run.mjs). The ones
# that run the game load the cart into romdev, on GL and on WebGPU: start
# romdev first (npx romdevtools) and ./build.sh.
#   ./test.sh [check ...] [--gpu gl|webgpu]
. "$(dirname "$0")/scripts/lib.sh"
[ -f "$ROOT/build/cart-wgpu/carts/${APP}_auto.wasc" ] || [ "${1:-}" = prompts ] || { echo "no build/cart-wgpu/carts/${APP}_auto.wasc: run ./build.sh first" >&2; exit 1; }
sdk "$(host_target)" >/dev/null # the engine's check tools come with the SDK
exec node "$ROOT/tests/run.mjs" "$@"
