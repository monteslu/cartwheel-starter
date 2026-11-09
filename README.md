# cartwheel-starter

A template for 3D games made with
[cartwheel](https://github.com/monteslu/cartwheel-engine), a game engine in C.
It builds a small finished game, **Lantern Trail**, for Linux, Windows, macOS,
Android and as a [wasmcart](https://github.com/wasmcart/wasmcart) cart, against
the engine's prebuilt SDK (only the game compiles), and it comes with the checks
that hold a game to a good standard: a newcomer can finish it, nothing floats,
the text is readable, the prompts fit every device, and GL and WebGPU agree.

Use it with GitHub's **Use this template** button, or clone it. Coding agents:
read [AGENTS.md](AGENTS.md) next; it is the playbook.

## The game

One or two players (split screen) climb a cliff trail, find three lanterns in
order and light the beacon at the top. It is small on purpose, and built the
way a modern cartwheel game should be: a procedural sky and sun with cascaded
shadows, height fog, bounce light from a light probe grid and reflections from
a reflection probe, PBR materials, rigid-body crates, a character with
athletic proportions, forgiving jumps (coyote time and a jump buffer), an
arrow and button prompts that tell a newcomer where to go and what to press,
a HUD at a readable size, and the engine's shell: title, join, pause,
settings (graphics presets Very Low to Ultra and Auto, volume, text size,
controls) and saves.

## Quick start

```sh
nohup npx romdevtools > romdev.log 2>&1 &   # the romdev server every run and check goes through (Node 24+; leave it running)
./build.sh          # the game for this machine and the .wasc cart (fetches the engine SDK the first time)
./shot.sh           # screenshots of the game from the player's camera, through romdev: out/shots/
./test.sh           # every check, through romdev, on GL and WebGPU
./run.sh            # play it in a window
```

You need git, cmake, ninja, curl, Node.js 24 or newer and a C compiler, on
Linux (x64 or arm64) or an Apple silicon Mac. Carts build on Linux x64. There
is one cart: the same `.wasc` draws with WebGPU on hosts that have it and with
GL on the rest.

## Make your game

1. Find the closest archetype in the "Game archetypes" table of the engine's
   [AGENTS.md](https://github.com/monteslu/cartwheel-engine/blob/main/AGENTS.md):
   games by type in
   [cartwheel-examples](https://github.com/monteslu/cartwheel-examples),
   [more-cartwheel-examples](https://github.com/monteslu/more-cartwheel-examples) and
   [even-more-cartwheel-examples](https://github.com/monteslu/even-more-cartwheel-examples).
   Study or copy that game's systems before writing new ones.
2. Replace Lantern Trail step by step, keeping `./test.sh` green after each
   step: [AGENTS.md](AGENTS.md), "Replace the sample game".

## The checks (`./test.sh`)

Every check runs the cart through [romdev](https://www.npmjs.com/package/romdevtools)
on GL and on WebGPU, and every check runs a control that must fail, so a check
that cannot fail is caught. A new game keeps them working by filling in
`tests/game.json` (what level 1's goal is, which debug fields hold the
on-screen cues).

| Check | Passes when | Its control (must fail) |
|---|---|---|
| prompts | no text names a button ("A: jump"); prompts name actions | a line that names a button |
| newcomer | a bot that knows only the on-screen cues, reacts late and aims badly finishes level 1, alone and with an idle second seat | the same bot ignoring the cues |
| grounding | nothing in the level floats | one thing lifted half a metre |
| gates | the trail and the menus reach the same state on GL and WebGPU, with a real picture and no missing program state | each run one frame short |
| text | text at least the engine's size floor on every screen | the same screens at half text size |
| budget | no check floods the shared romdev server | a check that loops one frame a request |

Pending until romdev can capture every frame of a run and time a cart's GPU:
the flash check (WCAG 2.3.1 and Harding, with its 8 Hz strobe control) and the
quality range (each preset cheaper than the one above, with the every-preset-is-High
control). AGENTS.md says how to keep both rules meanwhile.

## Releases

`./release.sh v0.1.0` tags the current commit and pushes it. CI then builds,
packages and attaches to the GitHub release (`<app>` is `app` in
`project.cwproj`):

| File | Platform |
|---|---|
| `<app>-<v>-linux-x64.tar.gz`, `.AppImage` | Linux x64 (glibc 2.34 or newer) |
| `<app>-<v>-linux-arm64.tar.gz`, `.AppImage` | Linux arm64 |
| `<app>-<v>-windows-x64.zip` | Windows 10 or later |
| `<app>-<v>-macos-arm64.zip` | macOS 11 or later, Apple silicon: signed ad hoc, not notarized (right-click, Open the first time) |
| `<app>-<v>-android-arm64-debug.apk` | Android 7 or later: signed with a debug key, for sideloading |
| `<app>-<v>.wasc` | any wasmcart host: browser, Node, native players, RetroArch (WebGPU or GL, whichever the host has) |

Each native build renders with WebGPU (Dawn) and falls back to OpenGL ES 3.0.
Signing for stores: the engine's
[shipping guide](https://github.com/monteslu/cartwheel-engine/blob/main/docs/shipping.md).

## Engine version

`scripts/deps.lock` pins an engine release and the sha256 of each SDK. A
published SDK never changes, so a pinned version builds the same forever. To
move to a newer engine, replace those lines with the newer release's (its
release page lists each SDK's `.sha256`) and the `cartwheel-file:tests/gate.mjs`
line with that release's file and its sha256 (the engine's gate runner, which
the SDKs do not carry), then run `./programs.sh` and `./test.sh`.

## License

MIT (see LICENSE). The engine and its dependencies keep their own licenses.
