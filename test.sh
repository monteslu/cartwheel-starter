#!/usr/bin/env bash
# Every check, each with a control that must fail (tests/run.mjs). The ones
# that run the game load the cart into romdev, on GL and on WebGPU (both legs
# at once): start romdev first (npx romdevtools). It builds first (./build.sh,
# quick when nothing changed), so the checks always run what the sources say,
# never a cart left from before an edit. The output also goes to out/test.log.
#   ./test.sh [check ...] [--gpu gl|webgpu]
. "$(dirname "$0")/scripts/lib.sh"
mkdir -p "$ROOT/out"
if [ "$*" != prompts ]; then # the prompt check reads sources only (CI runs it with no GPU)
  "$ROOT/build.sh" > "$ROOT/out/build.log" 2>&1 || { cat "$ROOT/out/build.log" >&2; echo "./build.sh failed: no checks ran" >&2; exit 1; }
fi
sdk "$(host_target)" >/dev/null # the engine's check tools come with the SDK
node "$ROOT/tests/run.mjs" "$@" 2>&1 | tee "$ROOT/out/test.log"
exit "${PIPESTATUS[0]}"
