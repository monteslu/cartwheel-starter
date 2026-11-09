#!/usr/bin/env bash
# Screenshots of the game from the player's camera, through romdev: the
# autopilot cart at Very Low and High, on GL and WebGPU, at the frames given
# (default 150 420 700), and a contact sheet of them: out/shots/sheet.png.
# Look at them. ./build.sh first; the romdev server running (npx romdevtools).
. "$(dirname "$0")/scripts/lib.sh"
exec node "$ROOT/tests/shots.mjs" "$@"
