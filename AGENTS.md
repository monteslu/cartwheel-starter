# Making a game from this template

This repository is a cartwheel game: C, built against a prebuilt engine SDK,
shipped as one `.wasc` cart (GL and WebGPU) and as native builds for Linux,
Windows, macOS and Android. The sample game, Lantern Trail, is here to be
replaced. This file is the playbook: read it all before writing code.
(`CLAUDE.md` is this same file.)

## 0. Read first

1. The engine's
   [AGENTS.md](https://github.com/monteslu/cartwheel-engine/blob/main/AGENTS.md):
   how the engine wants to be used, its errors and what they mean, and its
   "Game archetypes" table. The same file ships in the SDK:
   `deps/cartwheel-sdk/<platform>/AGENTS.md` after the first `./build.sh`, for
   the engine version this game pins.
2. Find the closest archetype in that table: games by type in
   [cartwheel-examples](https://github.com/monteslu/cartwheel-examples),
   [more-cartwheel-examples](https://github.com/monteslu/more-cartwheel-examples) and
   [even-more-cartwheel-examples](https://github.com/monteslu/even-more-cartwheel-examples).
   Study or copy that game's systems (its camera, its movement, its enemies,
   its HUD) before writing new ones. Copying a working system beats inventing
   one.
3. `src/main.c`: the whole sample in one readable file. Its header comment is
   the map of a cartwheel game.

The engine's headers are its API reference, for the version pinned in
`scripts/deps.lock`: `deps/cartwheel-sdk/<platform>/include/cartwheel/` after
the first build, and the guides at
<https://github.com/monteslu/cartwheel-engine/tree/main/docs/guides>
(`game-shell.md`, `rendering-3d.md`, `physics.md`, `input.md`,
`debug-channel.md`, `testing.md`). Read the guide before you use a system.

## 1. Set up

```sh
nohup npx romdevtools > romdev.log 2>&1 &   # the romdev server: every run, screenshot and check goes through it (Node 24+)
./build.sh          # build/native/<app> and build/cart-wgpu/carts/<app>.wasc (+ <app>_auto)
```

romdev listens on `http://127.0.0.1:7331`. Leave it running (an agent's shell
may end its background jobs when a command ends: `nohup`, or a terminal of
its own, keeps it alive). If something else already serves romdev on that
port, use it; never start a second one. To drive it
yourself as an MCP client: `claude mcp add --transport http romdev
http://127.0.0.1:7331/mcp`; the scripts here talk to its HTTP route and need
no MCP client. `<app>` is `app` in `project.cwproj`.

## 2. The loop: build, run, look, check

| Step | Command | What it does |
|---|---|---|
| build | `./build.sh` | the native game and the cart; no warnings allowed |
| look | `./shot.sh [frames...]` | the autopilot cart in romdev at Very Low and High, on GL and WebGPU: `out/shots/*.png` and a sheet `out/shots/sheet.png` |
| check | `./test.sh [--gpu gl\|webgpu] [check ...]` | every check below, through romdev, each with its control |
| play | `./run.sh` | the game in a window (for a human; agents look through `./shot.sh`) |
| one check | `./test.sh newcomer` (or prompts, grounding, gates, text, budget) | while you work on one thing; the whole `./test.sh` before you call it done |
| tables | `./programs.sh`, then `./build.sh` | after a new material, light setup or effect: the game shows a red "no program" banner until you do |

Work in small steps. After each one: build, look, check. A change is done
when `./test.sh` is green on GL and WebGPU **and** you have looked at the
screenshots and they show what you meant.

### How to see the game

You cannot play it, so look at it, often:

- `./shot.sh` writes frames of the autopilot cart (the game playing itself
  from its own on-screen cues) from the player's camera, at Very Low and
  High, GL and WebGPU, and a contact sheet of them. Open the sheet and the
  frames and **look**: is the player readable against the ground? Does
  anything float, clip, flicker or sit in the dark? Is the HUD readable? Does
  Very Low still look like the same game?
- A screenshot downscaled for viewing hides fine faults: crop a region at
  native size when judging edges, shadows or text.
- Stills cannot prove a game plays well. The newcomer check plays it; read
  its trace (`out/newcomer/*.json`: time, the cue it saw, what it pressed, the
  progress fields) when it fails.
- With romdev as an MCP client you can also load the cart yourself
  (`loadMedia`, `frame`, `input`, `wasm({op:'debugState'})`,
  `wasm({op:'command', text:'help'})`). Send ranges: one `frame` step or
  `input` sequence of many frames, then read once. Never a request per frame.

## 3. The rules a game must meet

`./test.sh` checks most of these. The rest are yours to look for.

- **A newcomer can finish level 1.** Someone who has never seen the game must
  be able to finish the first level from what the screen shows: where to go
  (an arrow, a marker, a lit path) and what to press (a prompt at the moment
  it is needed). Make jumps and timing forgiving (coyote time, a jump
  buffer); a mistake sends the player back a little, not to the start. A
  multiplayer game must be finishable with a second seat joined and idle.
  Checked by `tests/newcomer.mjs`.
- **Nothing floats.** Every prop, pickup, platform and character stands on
  something. Build platforms as solid shapes down to the ground, put pickups
  on stands, keep feet on the floor while walking. Checked by
  `tests/grounding.mjs` (the `grounding` command of `src/grounding.c`).
  Something that floats on purpose goes in the group `airborne` (groups are
  comma separated with no spaces: `groups="models/clouds.glb,airborne"`).
- **No strobe.** Nothing flashes more than three times a second, and no large
  area flips light to dark in a frame: lights, pickups and transitions swell
  and fade over a tenth of a second or more (WCAG 2.3.1 and the Harding
  thresholds). Feed every such effect through a flash meter
  (`src/flash_meter.c`: the value it draws in, the value to draw out) and list
  it in `tests/game.json` `flash.effects`. Checked by `tests/flash.mjs`.
- **No screen shake.** The camera never shakes. A hit or a blast is felt in
  the pads (`cw_input_rumble`).
- **Readable text.** Body text at least 2.4% of the screen height (26 px at
  1080 lines), nothing under 1.7% (`cartwheel/render2d.h`, "text size"). Size
  text from `cw_r2d_canvas_size().y`; the sample uses 3.6%. Draw the HUD only
  while `cw_shell_hud_shown()`.
- **Prompts never name a button.** Never "A: jump", "press X", "RT", or a
  colour of a button. Name the action and let the engine draw the glyph for
  the device each player holds: `cw_prompt_text(font, "{jump} jump", player,
  ...)` (`cartwheel/prompt.h`). Bind every movement action to the d-pad and
  the stick, and everything else to a button (pads may lack sticks and
  analog triggers). Checked by the SDK's `check-prompts.mjs`.
- **A real quality range, never by lowering resolution.** The engine's
  presets (Very Low to Ultra, Auto) cut shadows, effects, post and density;
  each preset must cost less than the one above, and Very Low must still look
  like the game (not timed by `./test.sh` yet: see "Pending" below). The
  sample starts on Auto (`cw_quality_auto`), which steps down until the
  frame fits a handheld's GPU. Never lower the render resolution to save time: Resolution is
  the player's own setting and Auto never touches it. Thin your own scenery
  with `cw_quality_density()` and add your own levers with
  `cw_quality_lever_add`.
- **Athletic proportions.** Characters are adults with athletic builds: about
  7.5 heads tall, shoulders wider than hips, long legs (half the height). No
  big-head, stubby-limbed figures unless the design asks for them.
- **Matte cloth.** Cloth is rough (roughness 0.85 or more, metalness 0;
  `sheen` for soft fabric). Only leather, vinyl, rubber and metal shine. Skin
  is moderate (about 0.6).
- **Determinism.** The simulation runs only in `fixed_update`, from the input
  snapshot and `cw_rng`; never the wall clock, one `cw_rng_*` call per
  statement, no `-ffast-math`. GL and WebGPU must reach the same state.
- **Keep the frame cheap.** Work per frame scales with what is on screen; no
  allocation in hot loops; instance repeated things. The target is a handheld
  GPU at 60 frames a second.
- **No hardcoded paths.** Assets go through `roots.txt` and asset paths.

## 4. The checks (`./test.sh`)

Each check runs the cart through romdev on GL and WebGPU, and runs a control
that must fail. A check whose control passes is reported as a failure: it
could not tell good from bad.

| Check | File | Its control |
|---|---|---|
| prompts | the SDK's `tools/check-prompts.mjs` over `src/` and the scenes | `tests/fixtures/prompt-control.c`, which names a button |
| newcomer | `tests/newcomer.mjs` | the same bot ignoring the cues |
| grounding | `tests/grounding.mjs` | one standing thing lifted 0.5 m |
| gates | the engine's `tests/gate.mjs --hosts romdev` over `tests/gates.json`: the autopilot finishes the trail and the menus reach play, the same state on GL and WebGPU, a real picture, the text floor, no missing program state | each run one frame short |
| text | the engine's `tools/check-text.mjs` over `tests/text.json`'s screens (title, join, play, finished, pause, settings, graphics) | the same screens at half text size |
| flash | `tests/flash.mjs`: each effect's flash meter (`fl.<effect>_flashes`) at most 3 a second over a run that shows it | `flash_strobe`: every effect on and off every 4 ticks |
| budget | every check's romdev client (`tests/lib/romdev.mjs`) stops a check that sends more than 40 requests plus 10 a second of game time | a loop stepping one frame a request |

Pending, not in `./test.sh` yet, because romdev cannot do it for a cart (and
the picture-based flash check, `tools/flash-check.mjs`, which needs every frame
of a run; the flash meters stand in for it):

- **quality range** (each preset cheaper than the one above, with the
  every-preset-is-High control): the engine's `tools/quality-range.mjs`
  times the GPU, and a cart on romdev has no GPU timer yet. Until then, look
  at Very Low against High in `./shot.sh`'s sheet and keep Very Low the
  same game.

Every check sends romdev ranges: one input sequence or frame step for many
frames, then one read. Never a request per frame: romdev is shared, and the
budget above fails a check that loops.

What a new game fills in, in `tests/game.json`:

- `newcomer.goal`: the debug field and value that mean level 1 is finished
  (`{"field": "game.done", "equals": 1}`).
- `newcomer.move`: the debug field holding the on-screen direction cue, per
  player, as x right and y up on the screen (what the HUD arrow shows).
- `newcomer.press`: debug fields that are 1 while a button prompt shows, and
  the pad button that prompt's action is bound to.
- `newcomer.players`: more than 1 adds the idle-second-seat run.
- `grounding.frames`: frames of the autopilot cart when nothing should be in
  the air.
- `flash.effects`: the game's flash meters; `flash.run`: frames and debug
  requests of an autopilot run that shows every one of them.

Publish those fields from the game with `cw_debug_*` in `init`, from the same
values the HUD draws, so the checks read what the player sees.

## 5. Replace the sample game, step by step

Keep `./test.sh` green after every step.

1. **Name it.** In `project.cwproj`: `name`, `app` (a C identifier: the
   executable, the cart, the packages), `app_id`, `description`; the title in
   `cw_shell_init`; and the `app` names in `tests/gates.json` and
   `tests/text.json` (`<app>` and `<app>_auto`: `./test.sh` stops and names
   the file when one names a cart that does not exist). Then `./build.sh`.
2. **Pick the archetype** (section 0) and read that game's source.
3. **The level.** Edit `main.cwscene` (the world: sky, sun, fog, terrain,
   post, the level's bodies) and `scenes/` (the player, pickups, props). Keep
   every platform a solid shape down to the ground. Use the engine's node
   types; their properties are in the engine's `docs/nodes.json` and answer
   `props <node>` over the debug channel.
   Then `node tools/make-art.mjs` and `./build.sh` (section 6).
4. **The player.** `scenes/player.cwscene` is the body (a collision capsule,
   a Model node and an AnimationPlayer); `dress_player` puts the skinned
   character from `tools/characters/` on it and `animate_player` picks its
   clip (idle, walk, run, jump) and plays it at the body's speed, so the planted
   foot stays put. `move_player` moves it. Keep coyote time and the jump
   buffer. For your own characters, add a spec to `SPECS` in
   `tools/characters/make-characters.mjs` (proportions, face, hair, outfit,
   colours) and the clips you need to `KEEP_CLIPS` (the library has many more:
   attacks, hits, falls), then run it.
5. **The goal and the cues.** Replace the lanterns and the beacon with your
   level's goal. Whatever your game asks of the player, show it on screen
   (an arrow, a marker, a prompt) and publish it as a debug field. Update
   `tests/game.json`.
6. **The HUD.** `hud()` in `src/main.c`: text sized from the canvas height,
   prompts by action, drawn in each player's `cw_shell_player_rect`.
7. **The shell.** `cw_shell_init` in `init`: title, players (1 to 4), save
   data. The shell gives you the title, join, pause, settings and saves;
   do not write your own.
8. **The autopilot.** `<app>_auto` (`GAME_AUTOPILOT`) plays the game from its
   own cues, straight into play. Keep it playing your game: `./shot.sh` and
   the grounding, flash and quality checks run it.
9. **Materials and lights changed?** `./programs.sh`, then `./build.sh`.
10. **Look** (`./shot.sh`) and **check** (`./test.sh`). Then the next step.

## 6. Art: `tools/make-art.mjs`

Every texture and model is made by `tools/make-art.mjs` (plain Node, no
dependencies, nothing downloaded) into `textures/` and `models/`. Run it after
changing the level, then `./build.sh` (and `./programs.sh` when a new kind of
material appears).

- **The level's blocks are their collision boxes** in `main.cwscene`. The
  script reads every StaticBody3D in a `dress_*` group and builds its look into
  `models/trail.glb`: `dress_flag` (flagstone top, rock sides), `dress_grass`
  (grass top with tufts and pebbles), `dress_rock`, `dress_plinth` (cut stone),
  `dress_column` (a fluted column on its capsule). Texture coordinates are
  world positions, so any size of block is textured at the same scale. Move or
  resize a block, rerun the script, and its look follows.
- **A model is shown by a node in the group named by its path**:
  `[node name="Trail" type="Node3D" groups="models/trail.glb"]`. `dress_models`
  in `src/main.c` lists the models; every file the game loads by name must also
  be listed in `roots.txt` (the packer follows scene files, not strings).
- **Characters** come from `tools/characters/` (adapted from an example
  game's character tool): `node tools/characters/make-textures.mjs && node
  tools/characters/make-characters.mjs` writes `models/<name>.glb`, a skinned
  figure with a rounded head and painted face, hands, shoes, cloth with folds,
  matte cloth and skin shading, and its clips.
- **Textures** are functions of (u, v) filling albedo, height, roughness and
  occlusion (`flag`, `cliff`, `grass`, ...); `writeSet` turns the height into a
  normal map and writes `_c`, `_n` and `_orm` PNGs, embedded into the models.
- **The landscape** is a `Terrain3D` node: the script writes its 16-bit
  heightmap, its splat map (grass, rock, scree by slope) and its layers.
  `TerrainScatter3D` children grow grass, rocks and trees on it.
- **Scenery** (`cw_quality_lever_add` in `init`): the game's own graphics
  setting. From Medium up it shows `models/scatter_detail.glb`, twice the
  grass. Use a lever like it for anything the presets should thin.


## Layout

| Path | What |
|---|---|
| `src/main.c` | the game |
| `src/grounding.c` | the `grounding` debug command (game-agnostic: keep it) |
| `src/flash_meter.c` | flash meters for the game's effects and the `flash_strobe` control (game-agnostic: keep it) |
| `main.cwscene`, `scenes/` | the world and its pieces, as scene files |
| `tools/make-art.mjs`, `tools/lib/` | the art generator, its texture toolkit and glTF writer |
| `tools/characters/` | the character generator: skinned bodies, faces, clothes, clips |
| `models/`, `textures/` | the generated art (committed; rerun the generator to change it) |
| `project.cwproj` | name, app, input map (`input.*`), physics layers, render size, export presets |
| `roots.txt` | what gets packed (scenes reach the rest) |
| `programs/` | the three.c program table: the material states the game draws (`./programs.sh`) |
| `tests/` | the checks, `tests/game.json` (the game's facts they need), `tests/lib/romdev.mjs` (the romdev client) |
| `scripts/deps.lock` | the engine version and its SDKs (sha256-pinned) |
| `deps/`, `build/`, `out/` | fetched SDKs, build trees, check output and screenshots (not committed) |

## Releases

`./release.sh v0.1.0` tags and pushes; CI builds every platform and publishes
the GitHub release. Bump `version` in `project.cwproj` first.
