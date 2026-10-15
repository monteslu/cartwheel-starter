# Working on this game

A cartwheel game: C, built against a prebuilt engine SDK, running natively
(Linux, Windows, macOS, Android) and as a `.wasc` cart. The title screen,
player join, pause menu, settings, saves, menu input, volume, graphics
presets and split screen are done for you by the engine's shell
(`cartwheel/shell.h`). Customise them through `cw_shell_init` in
`src/main.c`, and put your effort into gameplay and graphics.

## Layout

| Path | What |
|---|---|
| `src/main.c` | the game: start it here |
| `main.cwscene`, `gem.cwscene` | the world, as scene files (built-in node types) |
| `project.cwproj` | name, input map (`input.*`), render size, export presets |
| `roots.txt` | what gets packed into the game (scenes reach the rest) |
| `programs/` | the three.c program table: the material states the game draws (`./programs.sh` rewrites it) |
| `tests/gates.json`, `tests/run.mjs` | the tests `./test.sh` runs |
| `scripts/deps.lock` | the engine version and its SDKs (sha256-pinned) |
| `deps/`, `build/`, `out/` | fetched SDKs, build trees, test output and screenshots (not committed) |

## Commands

| Command | Does |
|---|---|
| `./build.sh` | builds the game for this machine (`build/native/gemdash`) and the cart (`build/cart/carts/gemdash.wasc`); fetches the SDK the first time |
| `./run.sh` | runs the game in a window |
| `./test.sh` | runs the tests headless: the replay gate on GL and WebGPU, the menu gate, the screenshot test |
| `./shot.sh [frames]` | writes `out/shot.png` after that many frames (default 300) of the autopilot playing |
| `./programs.sh` | regenerates the program table after you add a material or light setup |
| `./release.sh v0.1.0` | tags and pushes: CI builds, tests and publishes every platform |

Needs git, cmake, ninja, curl, node and a C compiler; the scripts say what is
missing.

## The game's structure (`src/main.c`)

- **setup**: `cw_main` returns the app description (`cw_scene_app` runs
  `main.cwscene`); `init` loads the input map, calls `cw_shell_init`, makes
  sounds and publishes the debug fields the tests read (`cw_debug_*`).
- **start**: the shell's Play calls `start(players)`: reset the world for
  that many players.
- **fixed_update**: one simulation tick, 60 per second. It begins with
  `if (!cw_shell_update()) return;` (a menu is up). Then gameplay.
- **render**: the HUD with `cw_r2d_*` in each player's
  `cw_shell_player_rect`, then `cw_shell_draw()`.
- **actions input**: gameplay reads actions (`cw_action_*`, `cw_input_axis`)
  for players 0..n-1; the actions are the `input.*` lines in `project.cwproj`
  (pad, keyboard, touch). The shell assigns each joined player its pad.
- **physics**: `CharacterBody3D` players moved with
  `cw_character3d_move_and_slide`, `Area3D` gems with a `body_entered`
  signal, `StaticBody3D` level pieces (`cartwheel/physics_nodes.h`).
- **HUD**: text and rects in render; with three players
  `cw_shell_shared_rect` is the free quadrant.
- **audio**: play music on `cw_shell_music_bus()` and effects on
  `cw_shell_sfx_bus()`; the shell's `sound` and `screen_changed` hooks play
  the menu sounds and music.
- **saves**: `cw_shell_game_save()` is your save struct; write it and call
  `cw_shell_save_commit()`.

`gemdash_auto` (CMakeLists.txt) is the same game with `GEMDASH_AUTOPILOT`:
bots play a two-player match with no input. The tests and screenshots run it.
Keep an autopilot that exercises your gameplay.

## Checking your work

1. `./build.sh`: no warnings.
2. `./test.sh`: every gate ok. When your change alters the game on purpose,
   the replay gate's expected values in `tests/gates.json` change: update
   them from `out/test/match-gl.json`, and check GL and WebGPU still agree.
3. `./shot.sh` and look at `out/shot.png` (and `out/test/*.png`). A test
   that passes on a black or broken frame is not done.

## Rules that bite

- **Determinism.** The simulation runs only in `fixed_update`, from the input
  snapshot and `cw_rng`. Never read the wall clock in the simulation. One
  `cw_rng_*` call per statement (C leaves the order of calls in one
  expression unspecified, so two calls in one expression can differ between
  compilers). No `-ffast-math`. The tests hold GL, WebGPU and every platform
  to the same state.
- **Keep frame CPU low.** Work per frame should scale with what is on screen;
  no per-frame allocation in hot loops; use instancing for many copies.
- **three.js r186.** The renderer is three.c, the three.js r186 API in C:
  materials, lights and cameras behave as in three.js r186. A new material
  or light setup needs `./programs.sh`; the tests name missing states.
- **No hardcoded paths.** Assets go through `roots.txt` and asset paths;
  never absolute paths or anything outside the repository.

## Engine reference

The engine headers are the API reference, for the version pinned in
`scripts/deps.lock` (v0.6.6):
<https://github.com/monteslu/cartwheel-engine/tree/v0.6.6/include/cartwheel>,
guides in <https://github.com/monteslu/cartwheel-engine/tree/v0.6.6/docs/guides>
(`game-shell.md`, `input.md`, `physics.md`, `rendering-3d.md`), and shipping
in <https://github.com/monteslu/cartwheel-engine/blob/v0.6.6/docs/shipping.md>.
The same headers are in `deps/cartwheel-sdk/<platform>/include/cartwheel/`
after the first build.
