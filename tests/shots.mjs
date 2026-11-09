// Screenshots of the game from the player's camera, for looking at: the autopilot cart (the game playing itself
// from its on-screen cues) in romdev at Very Low and at High, on GL and WebGPU, at the frames asked for, and a
// contact sheet of them (rows: preset and API; columns: frames). One romdev request a step to the next frame and
// one a screenshot. Run by ./shot.sh.
//
//   node tests/shots.mjs [frame ...] [--presets verylow,high] [--gpu gl|webgpu]
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project, sdkTools } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { readImage, writePng } = await import(join(sdkTools(ROOT), 'lib/png.mjs'));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const frames = argv.filter((a, i) => /^\d+$/.test(a) && !argv[i - 1]?.startsWith('--')).map(Number);
const FRAMES = frames.length ? frames : [150, 420, 700];
const PRESETS = opt('presets', 'verylow,high').split(',');
const GPUS = opt('gpu') ? [opt('gpu')] : ['gl', 'webgpu'];
const OUT = join(ROOT, 'out/shots');
mkdirSync(OUT, { recursive: true });
const { autoCart } = project(ROOT);

const rows = [];
for (const gpu of GPUS) {
  for (const preset of PRESETS) {
    const r = await Romdev.load({ cart: autoCart, gpu, label: 'shots' });
    try {
      await r.command(`quality ${preset}`);
      const row = [];
      for (const f of FRAMES) {
        await r.stepTo(f);
        row.push(await r.shot(join(OUT, `${preset}-${gpu}-${f}.png`)));
      }
      const fields = await r.fields();
      if (fields['cw.three.missing']) console.log(`WARNING ${preset} ${gpu}: ${fields['cw.three.missing']} material state(s) have no program: run ./programs.sh`);
      rows.push(row);
      console.log(`${preset} ${gpu}: ${row.join(' ')}`);
    } finally {
      await r.close();
    }
  }
}

// the sheet: each frame at a quarter size, so the whole set fits one image
const imgs = rows.map((row) => row.map(readImage));
const s = 4, w = Math.floor(imgs[0][0].w / s), h = Math.floor(imgs[0][0].h / s);
const W = w * FRAMES.length, H = h * rows.length, out = new Uint8Array(W * H * 4);
imgs.forEach((row, ry) => row.forEach((img, cx) => {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0];
      for (let dy = 0; dy < s; dy++)
        for (let dx = 0; dx < s; dx++) {
          const i = 4 * ((y * s + dy) * img.w + x * s + dx);
          acc[0] += img.rgba[i]; acc[1] += img.rgba[i + 1]; acc[2] += img.rgba[i + 2];
        }
      const o = 4 * ((ry * h + y) * W + cx * w + x);
      out[o] = acc[0] / (s * s); out[o + 1] = acc[1] / (s * s); out[o + 2] = acc[2] / (s * s); out[o + 3] = 255;
    }
}));
writePng(join(OUT, 'sheet.png'), W, H, out);
console.log(`sheet: ${join(OUT, 'sheet.png')} (rows: ${GPUS.flatMap((g) => PRESETS.map((p) => `${p} ${g}`)).join(', ')}; columns: frames ${FRAMES.join(', ')}). Look at it.`);
