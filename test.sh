#!/usr/bin/env bash
# The game's tests (tests/gates.json), headless, after the button-prompt check
# (tools/check-prompts.mjs from the SDK): the autopilot build plays a
# match on GL and on WebGPU and must reach the expected state, the same on
# both; the screenshot test checks a frame was drawn. ./build.sh first.
. "$(dirname "$0")/scripts/lib.sh"
[ -x "$ROOT/build/native/gemdash_auto" ] || { echo "no build/native/gemdash_auto: run ./build.sh first" >&2; exit 1; }
# button prompts name actions, never a maker's buttons ("A: jump"): the SDK's check over the game's sources
node "$(sdk "$(host_target)")/tools/check-prompts.mjs" "$ROOT/src" "$ROOT"/*.cwscene
exec node "$ROOT/tests/run.mjs" "$@"
