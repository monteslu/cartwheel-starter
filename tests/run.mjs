// The game's tests (tests/gates.json), run by ./test.sh. Each gate runs the
// app headless for its frame count on GL and on WebGPU; a state gate checks
// the expected debug fields (identical on both APIs), a screenshot gate
// checks the frame has at least min_colors colours. Prints one line per run;
// exit status 1 when anything failed.
//
//   node tests/run.mjs [gate name ...] [--gpu gl|webgpu]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'test');
const argv = process.argv.slice(2);
const gi = argv.indexOf('--gpu');
const GPUS = gi >= 0 ? [argv[gi + 1]] : ['gl', 'webgpu'];
const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--gpu');
const gates = JSON.parse(readFileSync(join(ROOT, 'tests/gates.json'), 'utf8')).filter((g) => !names.length || names.includes(g.name));
const exe = (app) => join(ROOT, 'build/native', app + (process.platform === 'win32' ? '.exe' : ''));
mkdirSync(OUT, { recursive: true });

/** the PNG the engine writes (8-bit RGBA or RGB, not interlaced): its distinct colours */
function pngColors(file) {
  const b = readFileSync(file);
  let p = 8, w = 0, h = 0, ch = 4;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(stride * h), seen = new Set();
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= ch && y ? px[(y - 1) * stride + x - ch] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      px[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  for (let i = 0; i < px.length; i += ch) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  return seen.size;
}

let failed = 0;
for (const g of gates) {
  const states = {};
  for (const gpu of GPUS) {
    const tag = `${g.name} (${gpu})`, dump = join(OUT, `${g.name}-${gpu}.json`), shot = join(OUT, `${g.name}-${gpu}.png`);
    const env = { ...process.env, CW_GPU: gpu, CW_FRAMES: String(g.frames), CW_WARMUP_SPREAD: '0', SDL_AUDIODRIVER: 'dummy', CW_DEBUG_DUMP: dump };
    if (g.screenshot) env.CW_SCREENSHOT = shot;
    if (g.input) env.CW_INPUT = join(ROOT, g.input); // scripted pad / keyboard input
    const t0 = Date.now();
    const r = spawnSync(exe(g.app), [], { env, encoding: 'utf8', timeout: 600000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.status !== 0 || !existsSync(dump)) {
      console.log(`FAIL ${tag}: exited ${r.status ?? r.signal} after ${secs} s\n${(r.stderr || '').split('\n').slice(-15).join('\n')}`);
      failed++;
      continue;
    }
    const s = JSON.parse(readFileSync(dump, 'utf8'));
    const bad = [];
    if (s['cw.three.missing']) bad.push(`${s['cw.three.missing']} material state(s) missing from the program table: run ./programs.sh`);
    for (const [k, v] of Object.entries(g.expect || {}))
      if (JSON.stringify(s[k]) !== JSON.stringify(v)) bad.push(`${k} = ${JSON.stringify(s[k])}, expected ${JSON.stringify(v)}`);
    if (g.screenshot) {
      const n = existsSync(shot) ? pngColors(shot) : 0;
      if (n < g.screenshot.min_colors) bad.push(`the screenshot has ${n} colours (at least ${g.screenshot.min_colors} expected): ${shot}`);
    }
    states[gpu] = Object.fromEntries(Object.keys(g.expect || {}).map((k) => [k, s[k]]));
    if (bad.length) { console.log(`FAIL ${tag}:\n  ${bad.join('\n  ')}`); failed++; }
    else console.log(`ok   ${tag} ${g.frames} frames, ${secs} s${g.screenshot ? `, ${shot}` : ''}`);
  }
  if (states.gl && states.webgpu && JSON.stringify(states.gl) !== JSON.stringify(states.webgpu)) {
    console.log(`FAIL ${g.name}: GL and WebGPU reached different states`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
