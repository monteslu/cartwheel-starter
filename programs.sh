#!/usr/bin/env bash
# Regenerate the game's three.c program table (programs/game.*) after a new
# material, light setup or graphics preset path: the game names the missing
# states on screen (a red banner) until it is regenerated. Surveys the carts
# through romdev on GL and WebGPU at every preset; ./build.sh first, then
# ./build.sh again to build the new table in.
. "$(dirname "$0")/scripts/lib.sh"
native=$(sdk "$(host_target)")
CW_PROJECT_ROOT="$ROOT" node "$native/tools/programs.mjs" --carts "$APP" "${APP}_auto" --build "$ROOT/build/native" --frames "${1:-1200}"
