// The program table: does the cart have a program for everything it draws? A material, light or effect drawn in a
// program state the game's table (programs/game.txt, ./programs.sh) lacks is NOT DRAWN, and the cart shows a red
// "N draw state(s) have no program" banner over the game. The table goes stale whenever a material, a light setup,
// the scenery or a preset path changes after ./programs.sh ran, so this check plays the game the ways a player meets it
// and fails on any state it lacks, naming them:
//   - the autopilot cart (<app>_auto) through its whole run (tests/game.json autopilot.frames) at every graphics
//     preset, Very Low to Ultra (each preset draws states of its own);
//   - the autopilot cart and the play cart as a player's machine runs them: loaded with no seed, so the warm-up
//     spreads over frames under the loading screen and Auto picks the graphics, and the play cart goes through its
//     menus into play. A deterministic load does its warm-up inside one frame and never shows
//     what a player's first frames draw.
// Each run is a few romdev requests: load, the preset, ONE ranged step (or input sequence) for the whole run, one read.
//
// The CONTROL must fail: the autopilot run at High with one sphere put in front of its camera (the debug channel's
// spawn and set) in a material no game's table has (clearcoat, sheen, iridescence and anisotropy at once). A control
// that passes means the check cannot see a missing state.
//
//   node tests/programs.mjs [--gpu gl|webgpu] [--no-control]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const GPUS = argv.includes('--gpu') ? [argv[argv.indexOf('--gpu') + 1]] : ['gl', 'webgpu'];
const GAME = JSON.parse(readFileSync(join(ROOT, 'tests/game.json'), 'utf8'));
const FRAMES = GAME.autopilot?.frames;
if (!(FRAMES > 0)) { console.error('tests/game.json: autopilot.frames (the frames the autopilot cart takes to finish its run) is missing'); process.exit(2); }
const { cart, autoCart } = project(ROOT);
const PRESETS = ['verylow', 'low', 'medium', 'high', 'ultra'];

/** the states a run drew without a program (cw.three.missing_states: text, or its bytes) */
function missing(f) {
  const v = f['cw.three.missing_states'];
  if (!v) return [];
  const bytes = Array.isArray(v) ? v : typeof v === 'string' && /^[0-9a-f]*$/i.test(v) ? v.match(/../g) || [] : null;
  const text = bytes ? String.fromCharCode(...bytes.map((b) => (typeof b === 'number' ? b : parseInt(b, 16))).filter((b) => b)) : String(v);
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** the first Camera3D in the tree (the `tree` request's JSON, its root first) as a path under the root ("/Level/Camera") */
function findCamera(node, path = null) {
  if (!node || typeof node !== 'object') return null;
  const here = path === null ? '' : `${path}/${node.name}`;
  if (node.type === 'Camera3D') return here;
  for (const c of Array.isArray(node.children) ? node.children : []) {
    const p = findCamera(c, here);
    if (p !== null) return p;
  }
  return null;
}

/** one run: [label, the states it lacked, requests] */
async function run(gpu, { label, cartPath, seed = 1, preset = null, menus = false, control = false }) {
  const r = await Romdev.load({ cart: cartPath, gpu, seed, label: 'programs' });
  try {
    if (preset) await r.command(`quality ${preset}`);
    if (control) {
      const t = await r.command('tree / 64');
      const cam = findCamera(t && t.tree ? t.tree : t);
      if (cam === null) throw new Error('control: no Camera3D in the tree to put the sphere in front of');
      await r.command(`spawn MeshInstance3D ${cam || '/'} ProgramsControl`);
      for (const [k, v] of [['primitive', 'SPHERE'], ['position', '"vec3(0, 0, -2)"'], ['clearcoat', '1'], ['sheen', '1'], ['iridescence', '1'], ['anisotropy', '0.5']])
        await r.command(`set ${cam}/ProgramsControl ${k} ${v}`);
    }
    if (menus) {
      // the shell's screens with presses, as a player goes through them (the loading screen first, as long as the
      // machine makes it): Play on the title, a seat on the join screen, Start
      const tap = (b) => r.run([{ pads: [{ buttons: [b] }], frames: 6 }, { pads: [{ buttons: [] }], frames: 24 }]);
      let screen = -1, joined = false;
      for (let tries = 0; tries < 30 && screen !== 3; tries++) {
        screen = (await r.fields())['shell.screen'];
        if (screen === 1) await tap('south');
        else if (screen === 2) { await tap(joined ? 'start' : 'south'); joined = true; }
        else if (screen !== 3) await r.run([{ pads: [{ buttons: [] }], frames: 30 }]);
      }
      if (screen !== 3) throw new Error('programs: the game did not reach play through its menus');
      await r.run([{ pads: [{ buttons: [] }], frames: 600 }]);
    } else await r.stepTo(FRAMES);
    return [label, missing(await r.fields()), r.calls];
  } finally {
    await r.close();
  }
}

let failed = 0, requests = 0;
for (const gpu of GPUS) {
  const runs = [
    ...PRESETS.map((p) => ({ label: `autopilot at ${p}`, cartPath: autoCart, preset: p })),
    { label: 'autopilot as a player runs it (no seed: the loading screen\'s warm-up, Auto graphics)', cartPath: autoCart, seed: null },
    { label: 'the game through its menus as a player runs it (no seed)', cartPath: cart, seed: null, menus: true },
  ];
  const lacked = new Set();
  for (const spec of runs) {
    const [label, states, calls] = await run(gpu, spec);
    requests += calls;
    if (states.length) {
      console.log(`FAIL programs (${gpu}) ${label}: ${states.length} draw state(s) have no program, so they are NOT DRAWN:\n    ${states.join('\n    ')}`);
      states.forEach((s) => lacked.add(s));
    } else console.log(`ok   programs (${gpu}) ${label}: every state drawn`);
  }
  if (lacked.size) {
    console.log(`FAIL programs (${gpu}): the table lacks ${lacked.size} state(s). Fix: ./programs.sh (it surveys these same runs and rebuilds), then ./test.sh programs`);
    failed++;
  }
  if (!argv.includes('--no-control')) {
    const [, states, calls] = await run(gpu, { label: 'control', cartPath: autoCart, preset: 'high', control: true });
    requests += calls;
    if (states.length) console.log(`ok   programs control (${gpu}): a sphere in a material no table has is reported missing, as it must (${states.length} state(s))`);
    else { console.log(`FAIL programs control (${gpu}): a sphere in a material no table has drew no missing state: the check cannot see one`); failed++; }
  }
}
console.log(`programs: ${requests} romdev requests`);
process.exit(failed ? 1 : 0);
