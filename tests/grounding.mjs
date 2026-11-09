// Nothing floats: every thing in the level stands on the ground or on another thing (src/grounding.c, the
// `grounding` debug command), checked in the cart through romdev on GL and WebGPU at the frames tests/game.json
// names, with the autopilot playing.
//
// The CONTROL must fail: one standing thing is lifted 0.5 m (the debug request `set <path> position`) and the
// check must then report it floating. Exempt something that floats on purpose by putting it in the group
// "airborne" (a bird, a cloud), never by loosening the tolerance.
//
//   node tests/grounding.mjs [--gpu gl|webgpu]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const GPUS = argv.includes('--gpu') ? [argv[argv.indexOf('--gpu') + 1]] : ['gl', 'webgpu'];
const CFG = JSON.parse(readFileSync(join(ROOT, 'tests/game.json'), 'utf8')).grounding || {};
const { autoCart } = project(ROOT);
const tol = CFG.tolerance ?? 0.03;
const frames = CFG.frames || [120];

let failed = 0;
for (const gpu of GPUS) {
  const r = await Romdev.load({ cart: autoCart, gpu, label: 'grounding' });
  try {
    for (const f of frames) {
      await r.stepTo(f);
      const g = await r.command(`grounding ${tol}`);
      if (!(g.things > 3)) { console.log(`FAIL grounding (${gpu}, frame ${f}): only ${g.things} things found: is the level loaded?`); failed++; continue; }
      if (g.floating) {
        console.log(`FAIL grounding (${gpu}, frame ${f}): ${g.floating} of ${g.things} float:\n  ${g.list.map((x) => `${x.path}${x.instance >= 0 ? ` instance ${x.instance}` : ''}: ${x.gap >= 999 ? 'nothing under it' : `${x.gap} m above what is under it`}`).join('\n  ')}`);
        failed++;
      } else console.log(`ok   grounding (${gpu}, frame ${f}): all ${g.things} things stand`);
    }
    // the control: lift a standing thing that is not a player or a moving body, and the check must see it
    const g = await r.command(`grounding ${tol}`);
    const victim = g.standing.find((p) => !/player/i.test(p));
    if (!victim) throw new Error('grounding control: nothing standing to lift');
    const got = await r.command(`get ${victim} position`), pos = got.values ? got.values.position.value : got.value;
    const [x, y, z] = pos.replace(/^vec3\(/, "").match(/-?[\d.]+(e-?\d+)?/g).map(Number); // "vec3(x, y, z)"
    await r.command(`set ${victim} position "vec3(${x}, ${y + 0.5}, ${z})"`);
    await r.step(1);
    const c = await r.command(`grounding ${tol}`);
    if (c.list.some((t) => t.path === victim)) console.log(`ok   grounding control (${gpu}): ${victim} lifted 0.5 m is reported floating, as it must be`);
    else { console.log(`FAIL grounding control (${gpu}): ${victim} lifted 0.5 m was not reported: the check cannot see a floating thing`); failed++; }
    console.log(`     (${r.calls} romdev requests over ${r.frame} frames)`);
  } finally {
    await r.close();
  }
}
process.exit(failed ? 1 : 0);
