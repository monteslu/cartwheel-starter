#!/usr/bin/env bash
# A screenshot of the game after [frames] frames (default 300) of the
# autopilot playing: out/shot.png. Look at it.
. "$(dirname "$0")/scripts/lib.sh"
exe="$ROOT/build/native/gemdash_auto"
[ -x "$exe" ] || { echo "no $exe: run ./build.sh first" >&2; exit 1; }
mkdir -p "$ROOT/out"
CW_FRAMES="${1:-300}" CW_WARMUP_SPREAD=0 SDL_AUDIODRIVER=dummy CW_SCREENSHOT="$ROOT/out/shot.png" "$exe" 2>"$ROOT/out/shot.log" ||
  { tail -20 "$ROOT/out/shot.log" >&2; exit 1; }
echo "$ROOT/out/shot.png"
