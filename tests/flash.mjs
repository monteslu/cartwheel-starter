// No strobe: every effect that changes the light on screen feeds a flash meter (src/flash_meter.c), and this check
// reads the meters after a ranged romdev run of the autopilot cart on GL and WebGPU: the lanterns found, a fall and
// its respawn dip, the beacon lit. Each effect must have shown (its peak) and flashed at most 3 times in any second
// (WCAG 2.3.1 and the Harding test's bound).
//
// The CONTROL must fail: the `flash_strobe` debug request switches every effect on and off every 4 ticks for two
// seconds, and every meter must then read more than 3 flashes a second.
//
// Until romdev can hand over every frame of a run (the engine's tools/flash-check.mjs then measures the picture
// itself), a game's flash meters are how it shows its effects swell and fade.
//
//   node tests/flash.mjs [--gpu gl|webgpu]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const GPUS = argv.includes('--gpu') ? [argv[argv.indexOf('--gpu') + 1]] : ['gl', 'webgpu'];
const CFG = JSON.parse(readFileSync(join(ROOT, 'tests/game.json'), 'utf8')).flash;
const { autoCart } = project(ROOT);
const MAX = 3;

let failed = 0;
for (const gpu of GPUS) {
  // the run: the autopilot plays, and partway through its player is dropped into the chasm (a respawn dip)
  const r = await Romdev.load({ cart: autoCart, gpu, label: 'flash' });
  try {
    for (const step of CFG.run) {
      await r.stepTo(step.frame);
      if (step.command) await r.command(step.command);
    }
    await r.stepTo(CFG.frames);
    const f = await r.fields();
    for (const fx of CFG.effects) {
      const n = f[`fl.${fx}_flashes`], peak = f[`fl.${fx}_peak`];
      if (n === undefined) { console.log(`FAIL flash (${gpu}): no meter fl.${fx}_flashes in the game`); failed++; continue; }
      if (!(peak >= 0.3)) { console.log(`FAIL flash ${fx} (${gpu}): the effect never showed in the run (peak ${peak}): the check proves nothing`); failed++; continue; }
      if (n > MAX) { console.log(`FAIL flash ${fx} (${gpu}): ${n} flashes in one second (at most ${MAX}): make it swell and fade`); failed++; }
      else console.log(`ok   flash ${fx} (${gpu}): at most ${n} flash${n === 1 ? '' : 'es'} a second, peak ${peak.toFixed(2)}`);
    }
    console.log(`     (${r.calls} romdev requests over ${r.frame} frames)`);
  } finally {
    await r.close();
  }
  // the control: every effect strobing at 7.5 Hz must read as a strobe
  const c = await Romdev.load({ cart: autoCart, gpu, label: 'flash-control' });
  try {
    await c.stepTo(60);
    for (const fx of CFG.effects) await c.command(`flash_strobe ${fx}`);
    await c.step(130);
    const f = await c.fields();
    for (const fx of CFG.effects) {
      const n = f[`fl.${fx}_flashes`];
      if (n > MAX) console.log(`ok   flash control ${fx} (${gpu}): strobing reads ${n} flashes a second, as it must`);
      else { console.log(`FAIL flash control ${fx} (${gpu}): strobing read ${n} flashes a second: the meter cannot see a strobe`); failed++; }
    }
  } finally {
    await c.close();
  }
}
process.exit(failed ? 1 : 0);
