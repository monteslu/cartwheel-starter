#!/usr/bin/env bash
# Run the game (./build.sh first). Arguments go to the game; CW_GPU=gl or
# CW_GPU=webgpu picks the graphics API (default: WebGPU, else GL).
. "$(dirname "$0")/scripts/lib.sh"
exe="$ROOT/build/native/gemdash"
[ -x "$exe" ] || { echo "no $exe: run ./build.sh first" >&2; exit 1; }
exec "$exe" "$@"
