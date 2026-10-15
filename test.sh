#!/usr/bin/env bash
# The game's tests (tests/gates.json), headless: the autopilot build plays a
# match on GL and on WebGPU and must reach the expected state, the same on
# both; the screenshot test checks a frame was drawn. ./build.sh first.
. "$(dirname "$0")/scripts/lib.sh"
[ -x "$ROOT/build/native/gemdash_auto" ] || { echo "no build/native/gemdash_auto: run ./build.sh first" >&2; exit 1; }
exec node "$ROOT/tests/run.mjs" "$@"
