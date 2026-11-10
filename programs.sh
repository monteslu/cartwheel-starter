#!/usr/bin/env bash
# Add the program states the game draws but its three.c table lacks
# (programs/game.*) and build them in: what `./test.sh programs` fails on, and
# the red "no program" banner a cart shows. Builds, plays the programs check's
# own runs through romdev on GL and WebGPU at once (tests/programs.mjs: every
# preset, High and Very Low switched in play, a player's first frames and the
# menus), adds what they lacked to programs/game.txt, regenerates the C and
# builds again. Commit programs/.
#   ./programs.sh          those runs (minutes)
#   ./programs.sh --full   the engine's whole survey as well (every preset switch both ways, each tests/gates.json
#                          run; much longer: for a release, or when the quick one leaves the check failing)
. "$(dirname "$0")/scripts/lib.sh"
"$ROOT/build.sh"
native=$(sdk "$(host_target)")
mkdir -p "$ROOT/out"
log="$ROOT/out/programs-missing.log"
: > "$log"
pids=()
for gpu in gl webgpu; do
  node "$ROOT/tests/programs.mjs" --gpu "$gpu" --no-control --collect "$log" > "$ROOT/out/programs-$gpu.log" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p" || true; done # a run that lacked states exits 1: that is what this fixes
grep -h "^FAIL\|Error" "$ROOT/out/programs-gl.log" "$ROOT/out/programs-webgpu.log" | grep -v "draw state(s) have no program\|the table lacks" && { echo "a run failed (out/programs-gl.log, out/programs-webgpu.log)" >&2; exit 1; }
if [ "${1:-}" = --full ]; then
  frames=$(node -e 'process.stdout.write(String(require(process.argv[1]).autopilot?.frames || 1200))' "$ROOT/tests/game.json")
  CW_PROJECT_ROOT="$ROOT" node "$native/tools/programs.mjs" --carts "$APP" "${APP}_auto" --gates --build "$ROOT/build/native" --frames "$frames"
fi
if [ ! -s "$log" ]; then echo "the table has every state those runs draw: nothing to add"; exit 0; fi
sort -u "$log" -o "$log"
echo "adding $(wc -l < "$log") state(s) to programs/game.txt"
CW_PROJECT_ROOT="$ROOT" node "$native/tools/programs.mjs" --table "$ROOT/programs/game.txt" --missing "$log" --build "$ROOT/build/native"
"$ROOT/build.sh"
echo "programs/ regenerated and built in: run ./test.sh programs, then commit programs/"
