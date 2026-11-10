#!/usr/bin/env bash
# Regenerate the game's three.c program table (programs/game.*) and build it
# in. Needed after a new material, light setup, scenery or graphics preset
# path: `./test.sh programs` fails (and the game shows a red "no program"
# banner) until it is done. Builds, surveys the carts through romdev on GL and
# WebGPU (every preset, every preset switched in play, a player's first frames,
# and each run in tests/gates.json, for tests/game.json autopilot.frames
# frames), adds what they drew to programs/game.txt, regenerates the C and
# builds again.
#   ./programs.sh [frames]
. "$(dirname "$0")/scripts/lib.sh"
"$ROOT/build.sh"
native=$(sdk "$(host_target)")
frames="${1:-$(node -e 'const g=require(process.argv[1]); process.stdout.write(String(g.autopilot?.frames || 1200))' "$ROOT/tests/game.json")}"
CW_PROJECT_ROOT="$ROOT" node "$native/tools/programs.mjs" --carts "$APP" "${APP}_auto" --gates --build "$ROOT/build/native" --frames "$frames"
"$ROOT/build.sh"
echo "programs/ regenerated and built in: ./test.sh programs checks it; commit programs/"
