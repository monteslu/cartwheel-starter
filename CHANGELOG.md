# Changelog

What each release added, changed and fixed. Releases are git tags
(`./release.sh v<version>`); CI builds every platform's package and attaches
them to the GitHub release.

## v0.4.0 (2026-11-10)

### Added
- **The newcomer check plays on the keyboard as well as the pad.** `tests/newcomer.mjs` runs each playthrough
  twice: on the keyboard, with the game's `input.*` key bindings (w a s d move, space jumps, return accepts and
  starts in the shell), and on a pad (the d-pad and its buttons), so both sets of bindings must take a newcomer
  through level 1. `--input keys|pad` picks one; the default is both. The keyboard run reads the same cues and makes
  the same decisions as the pad run, from the same seed. The control (cues ignored) runs on the first input picked
  and must still fail. Keys reach the cart through romdev's input sequence steps (romdev 0.155.0 or later; an older
  server drops them and the run says so, and so does a cart that never asked for a keyboard).

### Changed
- **One romdev request a decision.** The input sequence that runs a look's frames also returns the cue fields for
  the next look (`fields`) and ends the frame the goal is reached (`stopWhen`), so the bot no longer reads the fields
  in a second request after every range: 72 requests instead of 140 for the one-player run, 50 instead of 96 with
  an idle second seat, 139 instead of 273 for the control. `tests/lib/romdev.mjs`'s `run(segments, { fields,
  stopWhen })` is how a check does it; `keys` on a segment holds keyboard keys while it holds.
- **Engine v0.46.3**: `tools/run-cart.mjs` sends a gate script's keys to romdev as the cart's keyboard, so the
  engine's gate runner (`./test.sh gates`) no longer skips romdev for a script with keys; the romdev mode's control
  gets its own start requests alone.

## v0.3.0 (2026-11-09)

- Program table: the 5 states Auto's Low rung with Very Low effects draws (found by the new programs check, added by
  `./programs.sh`).
- Engine v0.44.0 (the shell's menus take touch; a player's first frames draw only what play draws). A programs check:
  the autopilot at every preset and the game as a player's machine runs it must draw every state, with a sphere in a
  material no table has as its control; `./test.sh` and `./shot.sh` build first; a check's GL and WebGPU legs run at
  once; the newcomer control plays twice as long as the slowest passing run.

## v0.2.2 (2026-11-09)

- A skinned hiker from the example games' character tool (`tools/characters/`); trees with leaf cards pulled back
  from the trail; thinner, sandy grout; mesas and canyon walls low and far enough that the camera sees their tops.

## v0.2.1 (2026-11-09)

- Engine v0.42.0 (three.c 0.187.7; the engine's AGENTS.md ships in the SDK with the flash-meter rule).

## v0.2.0 (2026-11-09)

- Stumbles a fresh clone hits: romdev started with nohup, `./test.sh` names a gates or text file whose apps are not
  this game's, the flash and quality rules say they are not checked yet.

## v0.1.1 (2026-10-17)

- Engine v0.12.2: lights and shadows, light bounce and reflections, limbs that reach and plant, cloth, big worlds,
  3D sound, water, fog and more (the SDK pin, and the guide links).

## v0.1.0 (2026-10-15)

- Engine v0.6.7: the first release.
