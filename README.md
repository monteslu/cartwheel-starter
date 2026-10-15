# cartwheel-starter

A template for games made with
[cartwheel](https://github.com/monteslu/cartwheel-engine), a 2D and 3D game
engine in C. It builds a small game, Gem Dash, for Linux, Windows, macOS,
Android and as a [wasmcart](https://github.com/wasmcart/wasmcart) cart,
against the engine's prebuilt SDK: only the game compiles.

Use it with GitHub's **Use this template** button, or clone it.

```sh
./build.sh    # the game for this machine and the .wasc cart (fetches the SDK the first time)
./run.sh      # play
./test.sh     # the tests, headless
./shot.sh     # a screenshot: out/shot.png
./release.sh v0.1.0   # tag and push: CI publishes every platform
```

You need git, cmake, ninja, curl, Node.js and a C compiler, on Linux (x64 or
arm64) or an Apple silicon Mac. Carts build on Linux x64.

The title screen, players joining (one to four, split screen), pause menu,
settings (graphics: a preset, Auto, or render resolution, ambient
occlusion, shadows, anti-aliasing and effects detail one by one; volume;
controls), saves and menu sounds come from the
engine's game shell: a new game writes its gameplay and art. `AGENTS.md`
describes the layout, the game's structure and how to check work.

## Releases

`./release.sh v0.1.0` tags the current commit and pushes it. CI then builds,
tests and attaches to the GitHub release:

| File | Platform |
|---|---|
| `gemdash-<v>-linux-x64.tar.gz`, `.AppImage` | Linux x64 (glibc 2.34 or newer) |
| `gemdash-<v>-linux-arm64.tar.gz`, `.AppImage` | Linux arm64 |
| `gemdash-<v>-windows-x64.zip` | Windows 10 or later |
| `gemdash-<v>-macos-arm64.zip` | macOS 11 or later, Apple silicon: signed ad hoc, not notarized (right-click, Open the first time) |
| `gemdash-<v>-android-arm64-debug.apk` | Android 7 or later: signed with a debug key, for sideloading |
| `gemdash-<v>.wasc` | any wasmcart host: browser, Node, native players, RetroArch |

Each native build renders with WebGPU (Dawn) and falls back to OpenGL ES 3.0.
Signing for stores: the engine's
[shipping guide](https://github.com/monteslu/cartwheel-engine/blob/main/docs/shipping.md).

## Engine version

`scripts/deps.lock` pins an engine release and the sha256 of each SDK. A
published SDK never changes, so a pinned version builds the same forever. To
move to a newer engine, replace those lines with the newer release's (its
release page lists each SDK's `.sha256`).

## License

MIT (see LICENSE). The engine and its dependencies keep their own licenses.
