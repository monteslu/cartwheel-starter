// The character texture sets (tools/characters/make-characters.mjs embeds them in each character's glb): cloth,
// denim, leather, skin, hair, hair cards and painted metal, as PBR sets (albedo, normal, occlusion-roughness-metal) in
// textures/char/. All of it is made here, by our own code; nothing is downloaded. Adapted from the brawler of
// more-cartwheel-examples (games/brawler/tools/make-textures.mjs), its character sets only. Run:
//   node tools/characters/make-textures.mjs [name ...]
// Material functions fill an `o` record per pixel: r g b (sRGB albedo), h (height), ro (roughness), me (metal), ao.
import { pompDir, pompTA, pompEdge } from './pompadour.mjs';
import { Tex, writeSet, fbm, cells, hash2, smooth, clamp, lerp, hex, save } from './texlib.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'textures', 'char');
const MAIN = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
const only = MAIN ? process.argv.slice(2) : ['none'];
const want = (n) => MAIN && (only.length === 0 || only.includes(n));

export function bake(size, px, w2) {
  const t = new Tex(size, w2 ?? size);
  const o = { r: 0, g: 0, b: 0, h: 0, ro: 0.8, me: 0, ao: 1, er: 0, eg: 0, eb: 0, em: false };
  let emi = null;
  t.each((u, v, i) => {
    o.r = o.g = o.b = 0; o.h = 0; o.ro = 0.8; o.me = 0; o.ao = 1; o.er = o.eg = o.eb = 0; o.em = false;
    px(u, v, o, i);
    t.a[0][i] = o.r; t.a[1][i] = o.g; t.a[2][i] = o.b; t.height[i] = o.h; t.rough[i] = o.ro; t.metal[i] = o.me; t.ao[i] = o.ao;
    if (o.em || o.er > 0 || o.eg > 0 || o.eb > 0) { emi ||= t.emissive(); emi[0][i] = o.er; emi[1][i] = o.eg; emi[2][i] = o.eb; }
  });
  return t;
}
const mixc = (o, c, k) => { o.r = lerp(o.r, c[0], k); o.g = lerp(o.g, c[1], k); o.b = lerp(o.b, c[2], k); };
const setc = (o, c, k = 1) => { o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; };
const mulc = (o, k) => { o.r *= k; o.g *= k; o.b *= k; };

// ── characters ──────────────────────────────────────────────────────────
/** soft cloth wrinkles: ridges stretched across the garment (u runs around a limb or body, v along it), two scales */
function wrinkles(u, v, seed) {
  const r1 = 1 - Math.abs(2 * fbm(u * 1, v * 1, 2, 3, seed + 40) - 1), r2 = 1 - Math.abs(2 * fbm(u, v * 2, 3, 3, seed + 41) - 1);
  const wa = fbm(u, v, 2, 2, seed + 42) - 0.5, wb = fbm(u, v, 3, 2, seed + 45) - 0.5;
  const w1 = fbm(u + 0.2 * wb, v + 0.35 * wa, 6, 2, seed + 43), w2 = fbm(u - 0.3 * wa, v + 0.3 * wb, 9, 2, seed + 44);
  return 0.7 * Math.pow(1 - Math.abs(2 * w1 - 1), 3) * (0.4 + 0.6 * r1) + 0.4 * Math.pow(1 - Math.abs(2 * w2 - 1), 4) * (0.3 + 0.7 * r2);
}
function fabric({ seed = 11, knit = false }) {
  return (u, v, o) => {
    const N = knit ? 64 : 112, x = u * N, y = v * N;
    const wx = Math.sin(x * Math.PI * 2), wy = Math.sin(y * Math.PI * 2);
    const over = ((Math.floor(x) + Math.floor(y)) & 1) ? wx : wy;
    const g = fbm(u, v, 12, 3, seed), fz = hash2(Math.floor(u * 512), Math.floor(v * 512), seed);
    const wr = wrinkles(u, v, seed);
    const rib = knit ? Math.sin((x + Math.sin(y * 3) * 0.2) * Math.PI * 2) : over;
    setc(o, [1, 1, 1], 0.86 + 0.035 * rib + 0.1 * (g - 0.5) + 0.03 * (fz - 0.5) + 0.06 * wr);
    o.h = 0.12 * rib + 1.0 * wr + 0.05 * (fz - 0.5);
    o.ro = 0.88 + 0.06 * (fz - 0.5) - 0.06 * wr; o.ao = 0.93 + 0.05 * rib - 0.0 + 0.07 * (wr - 0.3);
  };
}
function denim({ seed = 12 }) {
  return (u, v, o) => {
    const N = 110, d = (u + v) * N, t = Math.sin(d * Math.PI * 2);
    const g = fbm(u, v, 12, 4, seed), wear = smooth(0.55, 0.8, fbm(u, v, 3, 4, seed + 3));
    const fz = hash2(Math.floor(u * 512), Math.floor(v * 512), seed), wr = wrinkles(u, v, seed);
    setc(o, [1, 1, 1], 0.74 + 0.05 * t + 0.22 * g + 0.04 * (fz - 0.5) + wear * 0.16 + 0.12 * wr);
    o.h = t * 0.12 + 1.0 * wr + (fz - 0.5) * 0.05; o.ro = 0.88 - wear * 0.08; o.ao = 0.95 + 0.04 * t + 0.05 * (wr - 0.3);
  };
}
function leather({ seed = 13 }) {
  return (u, v, o) => {
    const [f1, f2] = cells(u, v, 72, seed, 1), g = fbm(u, v, 5, 4, seed + 2), scr = smooth(0.82, 0.95, fbm(u * 30, v * 2, 30, 2, seed + 4));
    const crease = 1 - smooth(0, 0.1, f2 - f1), wr = wrinkles(u, v, seed);
    setc(o, [1, 1, 1], 0.66 + 0.24 * g + 0.04 * (1 - crease) - crease * 0.08 + scr * 0.2 + 0.1 * wr);
    o.h = (1 - crease) * 0.15 - scr * 0.05 + 0.9 * wr; o.ro = clamp(0.42 + crease * 0.12 + (1 - g) * 0.15 - 0.12 * wr, 0.2, 1); o.ao = 1 - crease * 0.15;
  };
}
function skinTex({ seed = 14 }) {
  return (u, v, o) => {
    const [f1, f2] = cells(u, v, 90, seed, 1), g = fbm(u, v, 6, 4, seed + 2), fz = hash2(Math.floor(u * 512), Math.floor(v * 512), seed);
    const pore = smooth(0.16, 0.0, f1) * 0.7;
    const blotch = fbm(u, v, 9, 4, seed + 5);
    setc(o, [1, 1, 1], 0.9 + 0.12 * (blotch - 0.5) + 0.04 * (fz - 0.5) - pore * 0.1);
    o.r *= 1 + 0.04 * (blotch - 0.5); o.b *= 1 - 0.05 * (blotch - 0.5);
    o.h = -pore + 0.2 * g + 0.15 * (fz - 0.5); o.ro = clamp(0.58 + 0.15 * pore + 0.15 * (g - 0.5), 0.3, 0.9); o.ao = 1 - pore * 0.25;
  };
}
// the same skin with sparse dark hairs lying down the leg (u round it, v along it)
function hairyLegTex({ seed = 15 }) {
  const sk = skinTex({ seed });
  return (u, v, o) => {
    sk(u, v, o);
    const N = 26, gu = Math.floor(u * N), gv = Math.floor(v * N * 0.55);
    let k = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = (gu + i + N) % N, b = (gv + j + Math.floor(N * 0.55)) % Math.floor(N * 0.55);
      if (hash2(a, b, seed + 7) > 0.42) continue;
      const cx = (gu + i + hash2(a, b, seed + 8)) / N, cy = (gv + j + hash2(a, b, seed + 9)) / (N * 0.55), lean = (hash2(a, b, seed + 10) - 0.5) * 0.7, l = 0.018 + 0.012 * hash2(a, b, seed + 11);
      const dy = v - cy, dx = u - cx - lean * dy;
      if (dy > -l && dy < l && Math.abs(dx) < 0.0032) k = Math.max(k, smooth(0.0032, 0.0012, Math.abs(dx)) * smooth(l, l * 0.5, Math.abs(dy)));
    }
    o.r *= 1 - 0.72 * k; o.g *= 1 - 0.74 * k; o.b *= 1 - 0.76 * k;
  };
}
function hairTex({ seed = 15 }) {
  return (u, v, o) => {
    const s = fbm(u * 40, v * 1.2, 40, 4, seed), s2 = hash2(Math.floor(u * 256), 0, seed);
    setc(o, [1, 1, 1], 0.45 + 0.7 * s + 0.2 * (s2 - 0.5));
    o.h = s * 1.0; o.ro = 0.45 + 0.3 * s; o.ao = 0.7 + 0.3 * s;
  };
}
/** hair cards: strands along v (roots at v 0, tips at 1) with gaps, so the alpha-tested card breaks into strands; the
 * alpha thins toward the tips (the same idea as the fighter game's cards, written for this generator) */
function hairCard(seed = 31) {
  const N = 512, t = bake(N, (u, v, o) => {
    const s = fbm(u * 1, v * 0.06, 90, 3, seed), s2 = hash2(Math.floor(u * 180), 0, seed);
    setc(o, [1, 1, 1], 0.55 + 0.45 * s + 0.25 * (s2 - 0.5));
    mulc(o, 0.75 + 0.25 * smooth(0, 0.25, v));
    o.h = s; o.ro = 0.72 + 0.15 * (1 - s); o.ao = 0.6 + 0.4 * smooth(0, 0.3, v);
  });
  t.alpha = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, col = Math.floor(u * 110), w = hash2(col, 1, seed), len = 0.55 + 0.45 * hash2(col, 2, seed);
    const f = u * 110 - col, strand = smooth(0.5, 0.15, Math.abs(f - 0.5)) * (0.5 + 0.5 * w);
    const clump = 0.6 + 0.4 * fbm(u, 0.5, 14, 2, seed + 3), tip = smooth(len, len - 0.25, v);
    t.alpha[y * N + x] = clamp((strand * 1.7 * clump + 0.35 + 0.3 * smooth(0.3, 0, v)) * tip * smooth(1, 0.94, v));
  }
  return t;
}
/** the strands of a pompadour (pompadour.mjs: u across, s ear to ear; v along the comb lines): fine dark and pale strands
 * in clumps, furrows in the normal map, a slick pomade roughness; alpha cuts the hairline, each strand ending on its own */
function pompShell(seed = 41) {
  const N = 1024, COLS = 260;
  const t = bake(N, (u, v, o) => {
    const col = Math.floor(u * COLS), st = hash2(col, 3, seed), wob = fbm(u * 3, v, 8, 3, seed + 1) - 0.5;
    const cl = Math.sin((u + wob * 0.03) * 6.2831853 * 18), fine = fbm(u + wob * 0.012, v * 0.04, 150, 3, seed + 2);
    setc(o, [1, 1, 1], 0.5 + 0.28 * fine + 0.22 * st + 0.12 * cl);
    o.h = 0.5 + 0.28 * cl + 0.22 * fine;
    o.ro = clamp(0.52 + 0.3 * (1 - fine) - 0.1 * (cl * 0.5 + 0.5)); o.ao = 0.72 + 0.28 * (cl * 0.5 + 0.5);
  });
  t.alpha = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, d = pompDir(u * 2 - 1, v), [tt, a] = pompTA(d), col = Math.floor(u * COLS), j = hash2(col, 7, seed);
    // each strand reaches past the line by its own length: the edge is hair, not a cut
    t.alpha[y * N + x] = smooth(-0.002, 0.012, tt - pompEdge(a) + 0.055 * j * j + 0.012 * fbm(u, v, 40, 2, seed + 4));
  }
  return t;
}
function metalTex({ seed = 16, rust = 0.1 }) {
  return (u, v, o) => {
    const g = fbm(u, v, 6, 5, seed), scr = smooth(0.7, 0.95, fbm(u * 50, v * 2, 50, 3, seed + 3)), rm = smooth(1 - rust, 1 - rust + 0.2, fbm(u, v, 4, 5, seed + 5));
    setc(o, [1, 1, 1], 0.7 + 0.3 * g + scr * 0.25);
    mixc(o, [0.7, 0.35, 0.15], rm * 0.7);
    o.h = g * 0.2 + scr * 0.1; o.ro = clamp(0.35 + (1 - scr) * 0.15 + rm * 0.5, 0.1, 1); o.me = 0.9 * (1 - rm);
  };
}

const jobs = {
  fab_cloth: () => [bake(256, fabric({ seed: 11 })), 1.6],
  fab_knit: () => [bake(256, fabric({ seed: 12, knit: true })), 1.6],
  fab_denim: () => [bake(256, denim({ seed: 13 })), 1.6],
  fab_leather: () => [bake(256, leather({ seed: 14 })), 1.4],
  fab_skin: () => [bake(256, skinTex({ seed: 15 })), 0.5],
  fab_hair: () => [bake(256, hairTex({ seed: 16 })), 1.6],
  hair_card: () => [hairCard(31), 1.2],
  paint_metal: () => [bake(512, metalTex({ seed: 16, rust: 0.2 })), 2.0],
};
for (const [name, f] of Object.entries(jobs)) {
  if (!want(name)) continue;
  const [t, s] = f();
  writeSet(OUT, name, t, s);
  console.log(name, t.w);
}
