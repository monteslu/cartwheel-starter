#!/usr/bin/env bash
# Regenerate the game's three.c program table (programs/gemdash.*) after a
# new material or light setup: the tests fail and name the missing states
# until it is regenerated. Runs the autopilot build; ./build.sh first.
. "$(dirname "$0")/scripts/lib.sh"
native=$(sdk "$(host_target)")
node "$native/tools/programs.mjs" gemdash_auto --build "$ROOT/build/native" --frames "${1:-1200}"
ninja -C "$ROOT/build/native"
