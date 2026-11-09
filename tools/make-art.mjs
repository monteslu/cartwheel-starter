// The game's art, made by our own code (nothing is downloaded): PBR texture sets, the models that dress the level,
// the scatter on it, the trees, the crates, the cloud dome and the landscape around the trail (a heightmap, its
// splat map and its layers). Run it after changing the level's blocks in main.cwscene, then ./build.sh:
//
//   node tools/make-art.mjs            writes models/*.glb and textures/*
//
// The level's shape lives in main.cwscene, once: the collision boxes of its StaticBody3D blocks. This script reads
// them and dresses each by its group:
//   dress_flag    rock sides, a flagstone top (worn edges, moss in the joints)
//   dress_grass   rock sides, a grass top, grass tufts and pebbles scattered on it
//   dress_rock    rock all round
//   dress_plinth  cut stone (pedestals, the beacon's plinth)
//   dress_column  a fluted stone column on its capsule, with a base and a capital
// Texture coordinates are world positions (a metre is the same size of stone everywhere), so a block of any size
// is textured without stretching. Every piece is generated sitting on the surface it belongs to: nothing floats.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tex, writeSet, fbm, cells, hash2, smooth, clamp, lerp, save } from './lib/texlib.mjs';
import { Glb } from './lib/gltf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEX = join(ROOT, 'textures'), MOD = join(ROOT, 'models');
mkdirSync(TEX, { recursive: true });
mkdirSync(MOD, { recursive: true });
const rnd = (() => { let s = 12345; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); })();

// ── textures ───────────────────────────────────────────────────────────
/** fill a Tex from a per-pixel function setting o.r o.g o.b (sRGB albedo), o.h (height), o.ro (roughness), o.ao */
function bake(size, fn) {
  const t = new Tex(size);
  const o = {};
  t.each((u, v, i) => {
    o.r = o.g = o.b = 0.5; o.h = 0; o.ro = 0.85; o.ao = 1; o.a = 1;
    fn(u, v, o);
    t.a[0][i] = o.r; t.a[1][i] = o.g; t.a[2][i] = o.b; t.height[i] = o.h; t.rough[i] = o.ro; t.ao[i] = o.ao;
    if (t.alpha) t.alpha[i] = o.a;
  });
  return t;
}
const tint = (o, c, k = 1) => { o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; };
const mix = (o, c, k) => { o.r = lerp(o.r, c[0], k); o.g = lerp(o.g, c[1], k); o.b = lerp(o.b, c[2], k); };

/** flagstones: irregular cut stones, joints with grit and moss, edges worn round and chipped. A tile is 2 m. */
const flag = (u, v, o) => {
  const [f1, f2, id] = cells(u, v, 6, 11, 0.75);
  const edge = f2 - f1; // 0 on a joint
  const g = fbm(u, v, 8, 5, 3), fine = fbm(u, v, 48, 3, 4);
  const worn = smooth(0.02, 0.2, edge + (fbm(u, v, 24, 3, 5) - 0.5) * 0.08); // rounded, uneven edges
  const joint = 1 - smooth(0.01, 0.028, edge);
  const warm = hash2(id * 777, 3, 4), base = [0.66 + 0.14 * (id - 0.5) + 0.04 * warm, 0.6 + 0.1 * (id - 0.5), 0.5 + 0.08 * (hash2(id * 999, 1, 2) - 0.5) - 0.05 * warm];
  tint(o, base, 0.78 + 0.35 * g + 0.12 * (fine - 0.5) + 0.1 * (hash2(Math.floor(u * 512), Math.floor(v * 512), 6) - 0.5));
  mix(o, [0.3, 0.27, 0.22], (1 - worn) * 0.45); // grime on the worn rims
  const moss = joint * smooth(0.45, 0.65, fbm(u, v, 6, 4, 9));
  mix(o, [0.26, 0.22, 0.17], joint * (1 - moss)); // sandy grout, not black: thin lines at the player's distance
  mix(o, [0.16, 0.24, 0.08], moss);
  o.h = worn * 0.8 + fine * 0.15 + g * 0.1 - joint * 0.3;
  o.ro = clamp(0.62 + (1 - worn) * 0.2 + joint * 0.15 + fine * 0.08, 0, 1); // tops smoothed by feet
  o.ao = 1 - joint * 0.3;
};
/** cliff rock: strata that follow the level's height, cracks, lichen. A tile is 4 m wide, 4 m high. */
const cliff = (u, v, o) => {
  const warp = (fbm(u, v, 3, 4, 21) - 0.5) * 0.25;
  const band = fbm(0.37, v + warp, 7, 4, 22); // sediment layers: a colour per band, across the face
  const layer = (v + warp) * 9, ledge = layer - Math.floor(layer); // each layer weathers back to a small ledge
  const [c1, c2] = cells(u * 0.6 + warp, v * 1.6, 5, 24, 1); // tall joint blocks
  const crack = (1 - smooth(0, 0.03, c2 - c1)) * smooth(0.35, 0.55, fbm(u, v, 4, 3, 28));
  const g = fbm(u, v, 12, 5, 25), fine = fbm(u, v, 80, 2, 26);
  const tan = [0.54, 0.45, 0.36], rust = [0.5, 0.37, 0.28], grey = [0.47, 0.44, 0.41];
  const a = smooth(0.35, 0.5, band), b = smooth(0.6, 0.72, band);
  const c = [0, 1, 2].map((i) => lerp(lerp(tan[i], rust[i], a), grey[i], b));
  tint(o, c, 0.7 + 0.4 * g + 0.15 * (fine - 0.5) - 0.15 * smooth(0.75, 1, ledge));
  mix(o, [0.2, 0.15, 0.12], smooth(0.85, 1, ledge) * 0.5); // shadowed undercut of each ledge
  const lichen = smooth(0.66, 0.74, fbm(u, v, 9, 4, 27));
  mix(o, [0.36, 0.38, 0.28], lichen * 0.45);
  mix(o, [0.07, 0.06, 0.05], crack * 0.85);
  o.h = (1 - ledge) * 0.45 + g * 0.35 + fine * 0.1 - crack * 0.9;
  o.ro = clamp(0.84 + fine * 0.1, 0, 1);
  o.ao = (1 - crack * 0.6) * (1 - smooth(0.85, 1, ledge) * 0.35);
};
/** short grass over soil: a tile is 2 m */
const grass = (u, v, o) => {
  const blades = fbm(u * 1.6, v * 0.4, 96, 2, 31), g = fbm(u, v, 6, 5, 32), dry = smooth(0.55, 0.75, fbm(u, v, 4, 4, 33));
  const soil = smooth(0.62, 0.7, fbm(u, v, 7, 4, 34));
  tint(o, [0.2, 0.33, 0.09], 0.7 + 0.6 * blades + 0.2 * (g - 0.5));
  mix(o, [0.42, 0.4, 0.16], dry * 0.6);
  mix(o, [0.27, 0.2, 0.13], soil * 0.7);
  o.h = blades * 0.6 + g * 0.3 - soil * 0.3;
  o.ro = 0.9;
  o.ao = 0.75 + 0.25 * blades;
};
/** scree and dirt for the lower slopes */
const dirt = (u, v, o) => {
  const [f1, , id] = cells(u, v, 40, 41, 1), peb = smooth(0.4, 0.15, f1);
  const g = fbm(u, v, 8, 5, 42);
  tint(o, [0.36, 0.29, 0.21], 0.8 + 0.4 * g);
  mix(o, [0.5 + 0.15 * id, 0.46 + 0.12 * id, 0.4 + 0.1 * id], peb * 0.8);
  o.h = g * 0.4 + peb * 0.6;
  o.ro = 0.9 - peb * 0.1;
  o.ao = 0.8 + 0.2 * peb;
};
/** cut limestone for pedestals and columns: a tile is 1 m */
const cut = (u, v, o) => {
  const g = fbm(u, v, 6, 5, 51), vein = 1 - smooth(0, 0.03, Math.abs(fbm(u, v, 3, 4, 52) - 0.5));
  tint(o, [0.74, 0.7, 0.62], 0.85 + 0.25 * g);
  mix(o, [0.55, 0.5, 0.44], vein * 0.4);
  o.h = g * 0.2; o.ro = 0.55 + g * 0.2; o.ao = 1;
};
/** bark: vertical fibres */
const bark = (u, v, o) => {
  const f = fbm(u * 6, v * 0.5, 12, 4, 61), [c1, c2] = cells(u * 3, v * 0.6, 4, 62, 1), ridge = smooth(0, 0.1, c2 - c1);
  tint(o, [0.27, 0.19, 0.13], 0.6 + 0.6 * f);
  o.h = f * 0.5 + ridge * 0.5; o.ro = 0.92; o.ao = 0.6 + 0.4 * ridge;
};
/** leaves: dense clusters with gaps of shadow */
const leaves = (u, v, o) => {
  const [f1, , id] = cells(u, v, 48, 71, 1), [g1, , id2] = cells(u + 0.013, v + 0.021, 31, 73, 1);
  const leaf = Math.max(smooth(0.5, 0.15, f1) * (0.6 + 0.4 * id), smooth(0.5, 0.2, g1) * (0.5 + 0.5 * id2)); // two layers of overlapping leaves
  const clump = fbm(u, v, 4, 4, 72), sun = fbm(u, v, 2, 3, 74);
  tint(o, [0.2 + 0.1 * id, 0.36 + 0.12 * id2, 0.1 + 0.04 * id], (0.45 + 0.6 * leaf) * (0.7 + 0.5 * clump));
  mix(o, [0.42, 0.48, 0.16], smooth(0.6, 0.85, sun) * leaf * 0.35); // sunlit, yellower tips
  o.h = leaf * 0.7 + clump * 0.3; o.ro = 0.72; o.ao = 0.45 + 0.55 * leaf;
};
/** wood planks for the crates */
const planks = (u, v, o) => {
  const row = Math.floor(v * 4), grain = fbm(u * 0.3, v * 8 + row * 0.37, 16, 4, 81 + row);
  const gap = 1 - smooth(0, 0.02, Math.min(v * 4 - row, row + 1 - v * 4));
  tint(o, [0.5, 0.33, 0.18], 0.65 + 0.45 * grain + 0.1 * (hash2(row, 3, 82) - 0.5));
  mix(o, [0.1, 0.07, 0.04], gap * 0.9);
  o.h = grain * 0.3 - gap; o.ro = 0.8; o.ao = 1 - gap * 0.6;
};
/** a grass blade card: blades rising from the bottom edge, alpha cut */
function bladeCard(size) {
  const t = new Tex(size);
  t.alpha = new Float32Array(size * size);
  t.each((u, v, i) => {
    const y = 1 - v; let a = 0, shade = 0;
    for (let k = 0; k < 14; k++) {
      const x0 = hash2(k, 1, 91), h = 0.45 + 0.55 * hash2(k, 2, 91), lean = (hash2(k, 3, 91) - 0.5) * 0.35;
      const w = 0.035 * (1 - y / h);
      const cx = x0 + lean * y * y;
      if (y < h && Math.abs(u - cx) < w) { a = 1; shade = Math.max(shade, y / h); }
    }
    t.alpha[i] = a;
    t.a[0][i] = 0.18 + 0.25 * shade; t.a[1][i] = 0.3 + 0.3 * shade; t.a[2][i] = 0.08 + 0.06 * shade;
    t.rough[i] = 0.85; t.ao[i] = 0.5 + 0.5 * shade; t.height[i] = 0;
  });
  return t;
}
/** a card of leaves: overlapping pointed ovals at random angles, alpha cut between them (light shows through the crown) */
function leafCard(size) {
  const t = new Tex(size);
  t.alpha = new Float32Array(size * size);
  const leaves = Array.from({ length: 34 }, (_, k) => ({ x: 0.12 + 0.76 * hash2(k, 1, 301), y: 0.12 + 0.76 * hash2(k, 2, 301), a: hash2(k, 3, 301) * Math.PI, s: 0.07 + 0.06 * hash2(k, 4, 301), c: hash2(k, 5, 301) }));
  t.each((u, v, i) => {
    let best = null, depth = 0;
    for (const L of leaves) { // later leaves lie on top
      const dx = u - L.x, dy = v - L.y, ca = Math.cos(L.a), sa = Math.sin(L.a);
      const lu = (dx * ca + dy * sa) / L.s, lv = (-dx * sa + dy * ca) / (L.s * 0.45);
      const w = 1 - Math.abs(lu); // pointed at both ends
      if (Math.abs(lu) < 1 && Math.abs(lv) < w) { best = L; depth = w - Math.abs(lv); }
    }
    t.alpha[i] = best ? 1 : 0;
    const c = best ? best.c : 0, vein = best ? smooth(0.08, 0, depth) : 0;
    t.a[0][i] = 0.17 + 0.12 * c - 0.04 * vein; t.a[1][i] = 0.33 + 0.12 * c - 0.05 * vein; t.a[2][i] = 0.08 + 0.03 * c;
    t.height[i] = depth; t.rough[i] = 0.65; t.ao[i] = 0.7 + 0.3 * c;
  });
  return t;
}
/** clouds across the dome: u around (tiles), v from the horizon (0) up; alpha is cover */
function cloudTex(w, h) {
  const t = new Tex(w, h);
  t.alpha = new Float32Array(w * h);
  t.each((u, v, i) => {
    const up = 1 - v; // 0 at the bottom row (horizon)
    const d = fbm(u, v * 0.5, 6, 6, 101), wisp = fbm(u * 2, v, 12, 4, 102);
    let c = smooth(0.48, 0.72, d * 0.8 + wisp * 0.3) * smooth(0.02, 0.15, up) * (1 - smooth(0.7, 1, up) * 0.6);
    const lit = smooth(0.3, 0.9, fbm(u, v * 0.5, 6, 6, 103) - d * 0.3 + 0.4); // brighter tops, greyer bellies
    t.alpha[i] = c * 0.9;
    t.a[0][i] = 0.78 + 0.22 * lit; t.a[1][i] = 0.66 + 0.24 * lit; t.a[2][i] = 0.6 + 0.24 * lit;
    t.rough[i] = 1; t.ao[i] = 1; t.height[i] = 0;
  });
  return t;
}
/** a terrain layer as Terrain3D packs it: albedo RGB + height in A, normal RGB + roughness in A */
function terrainLayer(name, t, strength) {
  const n = t.w * t.h, al = new Uint8Array(n * 4), nr = new Uint8Array(n * 4), nm = t.normals(strength);
  const b = (x) => Math.round(clamp(x) * 255);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, t.height[i]); hi = Math.max(hi, t.height[i]); }
  for (let i = 0; i < n; i++) {
    al[i * 4] = b(t.a[0][i]); al[i * 4 + 1] = b(t.a[1][i]); al[i * 4 + 2] = b(t.a[2][i]); al[i * 4 + 3] = b((t.height[i] - lo) / (hi - lo || 1));
    nr[i * 4] = nm[i * 3]; nr[i * 4 + 1] = nm[i * 3 + 1]; nr[i * 4 + 2] = nm[i * 3 + 2]; nr[i * 4 + 3] = b(t.rough[i]);
  }
  save(join(TEX, `terrain_${name}_albedo.png`), t.w, t.h, 4, al);
  save(join(TEX, `terrain_${name}_normal.png`), t.w, t.h, 4, nr);
}

const S = 512;
const sets = { flag: [flag, 3], cliff: [cliff, 4], grass: [grass, 2], cut: [cut, 1.5], bark: [bark, 3], leaves: [leaves, 2], planks: [planks, 2] };
const baked = {};
for (const [name, [fn, strength]] of Object.entries(sets)) { baked[name] = bake(name === 'bark' || name === 'planks' ? 256 : S, fn); writeSet(TEX, name, baked[name], strength); }
writeSet(TEX, 'blades', bladeCard(128), 1);
writeSet(TEX, 'leafcard', leafCard(256), 1.5);
writeSet(TEX, 'clouds', cloudTex(1024, 256), 0);
terrainLayer('grass', baked.grass, 2);
terrainLayer('rock', baked.cliff, 4);
terrainLayer('dirt', bake(S, dirt), 3);

// ── reading the level ─────────────────────────────────────────────────
/** the nodes of a .cwscene: [{name, parent, type, groups, props}] (scene format 1) */
function readScene(file) {
  const nodes = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const h = /^\[node name="([^"]+)"(?: parent="([^"]*)")?(?: type="([^"]+)")?(?: instance=\d+)?(?: groups="([^"]*)")?/.exec(line);
    if (h) { cur = { name: h[1], parent: h[2] ?? null, type: h[3] || '', groups: (h[4] || '').split(',').map((s) => s.trim()).filter(Boolean), props: {} }; nodes.push(cur); continue; }
    const p = /^(\w+) = (.*)$/.exec(line);
    if (p && cur) cur.props[p[1]] = p[2];
  }
  return nodes;
}
const vec = (s, d = [0, 0, 0]) => (s ? s.replace(/^[a-z]+\d?\(/, "").match(/-?[\d.]+(e-?\d+)?/g).map(Number) : d); // "vec3(1, 2, 3)" -> [1, 2, 3]
/** a node's transform as a 3x4 (rotation XYZ Euler, then position) */
function xform(props) {
  const [px, py, pz] = vec(props.position), [rx, ry, rz] = vec(props.rotation);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // three.js 'XYZ': R = Rx * Ry * Rz
  const m = [cy * cz, -cy * sz, sy, cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy];
  return (p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + px, m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + py, m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + pz];
}
const level = readScene(join(ROOT, 'main.cwscene'));
const child = (n, name) => level.find((c) => c.parent === n.name && c.name === name);
const dressed = (g) => level.filter((n) => n.parent === '.' && n.groups.includes(g));

// ── geometry ──────────────────────────────────────────────────────────
class Mesh {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  vert(p, n, uv) { this.pos.push(...p); this.nrm.push(...n); this.uv.push(...uv); return this.pos.length / 3 - 1; }
  quad(a, b, c, d, n, uvf) { const i = [a, b, c, d].map((p) => this.vert(p, n, uvf(p))); this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]); }
  get empty() { return !this.idx.length; }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
/** world-projected uv: the axis the face looks along picks the plane; `tile` metres per repeat */
const worldUv = (n, tile) => (p) => (Math.abs(n[1]) > 0.7 ? [p[0] / tile, p[2] / tile] : Math.abs(n[0]) > Math.abs(n[2]) ? [p[2] / tile, -p[1] / tile] : [p[0] / tile, -p[1] / tile]);

// each dressed block is a piece of its own in trail.glb (a node per block), so the grounding check judges each
const pieces = [];
const piece = (name) => { const p = { name, flag: new Mesh(), grass: new Mesh(), cliff: new Mesh(), cut: new Mesh() }; pieces.push(p); return p; };
const tops = []; // [{min, max, y, kind}] for the scatter
/** a box block: its sides in `side`, its top in `top` */
function box(n, top, side, topTile, sideTile) {
  const shape = child(n, 'Shape');
  const [sx, sy, sz] = vec(shape.props.size, [1, 1, 1]).map((x) => x / 2), [ox, oy, oz] = vec(shape.props.position);
  const T = xform(n.props);
  const c = [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [-sx, -sy, sz], [-sx, sy, -sz], [sx, sy, -sz], [sx, sy, sz], [-sx, sy, sz]].map(([x, y, z]) => T([x + ox, y + oy, z + oz]));
  const faces = [[4, 7, 6, 5, top], [3, 2, 6, 7, side], [1, 0, 4, 5, side], [0, 3, 7, 4, side], [2, 1, 5, 6, side]];
  for (const [a, b, cc, d, m] of faces) {
    const nn = norm(cross(sub(c[b], c[a]), sub(c[d], c[a])));
    m.quad(c[a], c[b], c[cc], c[d], nn, worldUv(nn, m === side ? sideTile : topTile));
  }
  return c;
}
for (const n of dressed('dress_flag')) { const M = piece(n.name), c = box(n, M.flag, M.cliff, 2.6, 4); tops.push({ c, kind: 'flag' }); }
for (const n of dressed('dress_grass')) { const M = piece(n.name), c = box(n, M.grass, M.cliff, 2, 4); tops.push({ c, kind: 'grass' }); }
for (const n of dressed('dress_rock')) { const M = piece(n.name); box(n, M.cliff, M.cliff, 4, 4); }
for (const n of dressed('dress_plinth')) { const M = piece(n.name); box(n, M.cut, M.cut, 1, 1); }

/** a lathe (a surface of revolution) round a vertical axis at p: profile [[r, y], ...] bottom up, k sides */
function lathe(m, p, profile, k, flutes = 0) {
  for (let j = 0; j + 1 < profile.length; j++)
    for (let i = 0; i < k; i++) {
      const at = (r, y, a) => { const f = flutes ? 1 - 0.06 * Math.abs(Math.cos(a * flutes)) : 1; return [p[0] + Math.cos(a) * r * f, p[1] + y, p[2] + Math.sin(a) * r * f]; };
      const a0 = (i / k) * Math.PI * 2, a1 = ((i + 1) / k) * Math.PI * 2, am = (a0 + a1) / 2;
      const [r0, y0] = profile[j], [r1, y1] = profile[j + 1];
      const A = at(r0, y0, a0), B = at(r0, y0, a1), C = at(r1, y1, a1), D = at(r1, y1, a0);
      const nn = norm([Math.cos(am) * (y1 - y0), r0 - r1, Math.sin(am) * (y1 - y0)]);
      const uv = (q) => [(Math.atan2(q[2] - p[2], q[0] - p[0]) / (Math.PI * 2) + 0.5) * 2, -(q[1] - p[1])];
      m.quad(D, C, B, A, nn, uv);
    }
}
for (const n of dressed('dress_column')) {
  const [x, y, z] = vec(n.props.position), h = vec(child(n, 'Shape').props.height || '2.8')[0];
  const base = [x, y - h / 2, z];
  lathe(piece(n.name).cut, base, [[0.42, 0], [0.42, 0.18], [0.32, 0.22], [0.27, 0.32], [0.24, h - 0.32], [0.3, h - 0.24], [0.45, h - 0.16], [0.45, h]], 20, 10);
}

// ── scatter on the tops: grass tufts and pebbles, each standing on its surface. A third of them go in
// scatter.glb (always drawn), the rest in scatter_detail.glb (the game's Scenery setting: Medium and up) ──
// a node per top in each file, so the grounding check judges each top's scatter on its own
const base = [], detail = [];
for (const { c, kind } of tops) {
  const b = { tufts: new Mesh(), pebbles: new Mesh() }, d = { tufts: new Mesh(), pebbles: new Mesh() };
  base.push(b); detail.push(d);
  const [x0, x1] = [Math.min(c[4][0], c[6][0]), Math.max(c[4][0], c[6][0])], [z0, z1] = [Math.min(c[4][2], c[6][2]), Math.max(c[4][2], c[6][2])], y = c[4][1];
  const area = (x1 - x0) * (z1 - z0);
  const nT = kind === 'grass' ? Math.round(area * 2.4) : Math.round(area * 0.08), nP = Math.round(area * (kind === 'grass' ? 0.15 : 0.08));
  for (let i = 0; i < nT; i++) {
    const px = lerp(x0 + 0.2, x1 - 0.2, rnd()), pz = lerp(z0 + 0.2, z1 - 0.2, rnd());
    if (kind === 'grass' && Math.abs(px) < 1.2 && rnd() < 0.7) continue; // a trodden path down the middle
    const s = 0.22 + rnd() * 0.25, w = s * 0.9, a0 = rnd() * Math.PI, tufts = (i % 3 ? d : b).tufts;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI) / 3, dx = Math.cos(a) * w, dz = Math.sin(a) * w;
      const nn = [Math.sin(a), 0.3, -Math.cos(a)];
      const P = [[px - dx, y, pz - dz], [px + dx, y, pz + dz], [px + dx, y + s, pz + dz], [px - dx, y + s, pz - dz]], U = [[0, 1], [1, 1], [1, 0], [0, 0]];
      const ids = P.map((p, q) => tufts.vert(p, norm(nn), U[q]));
      tufts.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  }
  for (let i = 0; i < nP; i++) { // a pebble: a squashed, jittered octahedron resting on the top
    const px = lerp(x0 + 0.3, x1 - 0.3, rnd()), pz = lerp(z0 + 0.3, z1 - 0.3, rnd()), r = 0.06 + rnd() * 0.12, hgt = r * (0.5 + rnd() * 0.3);
    const v = [[r, 0, 0], [0, 0, r], [-r, 0, 0], [0, 0, -r]].map(([a, , b]) => [px + a * (0.8 + rnd() * 0.4), y + hgt * 0.35, pz + b * (0.8 + rnd() * 0.4)]);
    const top = [px, y + hgt, pz], bot = [px, y, pz], pebbles = (i % 3 ? d : b).pebbles;
    for (let k = 0; k < 4; k++) {
      const a = v[k], b = v[(k + 1) % 4];
      for (const [p, q, r2] of [[top, b, a], [bot, a, b]]) {
        const nn = norm(cross(sub(q, p), sub(r2, p)));
        const ids = [p, q, r2].map((pt) => pebbles.vert(pt, nn, [pt[0] / 1.5, pt[2] / 1.5]));
        pebbles.idx.push(...ids);
      }
    }
  }
}

// ── writing the models ─────────────────────────────────────────────────
const geo = (m) => ({ pos: m.pos, nrm: m.nrm, uv: m.uv, idx: m.idx });
function model(file, parts) {
  const g = new Glb();
  const prims = parts.filter(([m]) => !m.empty).map(([m, set, o = {}]) => [geo(m), g.pbr(set, TEX, set, { metal: 0, ...o })]);
  g.sceneNodes.push(g.node({ name: file.replace('.glb', ''), mesh: g.mesh(file, prims) }));
  g.write(join(MOD, file));
  console.log(`models/${file}: ${prims.length} parts, ${parts.reduce((n, [m]) => n + m.idx.length / 3, 0)} triangles`);
}
{ // trail.glb: a node per dressed block, named as the block, its materials shared
  const g = new Glb(), mats = {};
  const mat = (set) => (mats[set] ??= g.pbr(set, TEX, set, { metal: 0 }));
  let tris = 0;
  for (const p of pieces) {
    const prims = ['flag', 'grass', 'cliff', 'cut'].filter((k) => !p[k].empty).map((k) => { tris += p[k].idx.length / 3; return [geo(p[k]), mat(k)]; });
    g.sceneNodes.push(g.node({ name: p.name, mesh: g.mesh(p.name, prims) }));
  }
  g.write(join(MOD, 'trail.glb'));
  console.log(`models/trail.glb: ${pieces.length} pieces, ${tris} triangles`);
}
for (const [file, sets] of [['scatter.glb', base], ['scatter_detail.glb', detail]]) {
  const g = new Glb(), blades = g.pbr('blades', TEX, 'blades', { metal: 0, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true }), rock = g.pbr('cliff', TEX, 'cliff', { metal: 0 });
  let tris = 0;
  sets.forEach((set, i) => {
    const prims = [[set.tufts, blades], [set.pebbles, rock]].filter(([m]) => !m.empty).map(([m, mt]) => { tris += m.idx.length / 3; return [geo(m), mt]; });
    if (prims.length) g.sceneNodes.push(g.node({ name: `top${i}`, mesh: g.mesh(`top${i}`, prims) }));
  });
  g.write(join(MOD, file));
  console.log(`models/${file}: ${sets.length} tops, ${tris} triangles`);
}

/** a tree standing at the origin: a tapered trunk with two boughs and a crown of lumpy leaf clusters */
{
  const trunk = new Mesh(), crown = new Mesh();
  lathe(trunk, [0, 0, 0], [[0.26, 0], [0.2, 0.3], [0.15, 1.6], [0.11, 2.7]], 9);
  const blob = (c, r) => { // a lumpy sphere: an icosphere-ish lat/long ball pushed by noise
    const seg = 10, rings = 7;
    const P = (i, j) => {
      const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2, k = 0.85 + 0.3 * hash2(i % seg, j, Math.round(c[0] * 10 + c[2] * 7));
      return [c[0] + r * k * Math.sin(th) * Math.cos(ph), c[1] + r * 0.85 * k * Math.cos(th), c[2] + r * k * Math.sin(th) * Math.sin(ph)];
    };
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
        const nn = norm(sub([(a[0] + cc[0]) / 2, (a[1] + cc[1]) / 2, (a[2] + cc[2]) / 2], c));
        crown.quad(a, d, cc, b, nn, (p) => [Math.atan2(p[2] - c[2], p[0] - c[0]) / 2, (p[1] - c[1]) / 2]);
      }
  };
  // the crown: a small dark core (no sky through the middle) and leaf cards over it, the light coming through their gaps
  const cards = new Mesh();
  const clusters = [[[0, 3.0, 0], 1.05], [[0.6, 2.6, 0.25], 0.75], [[-0.55, 2.7, -0.35], 0.8], [[0.1, 3.7, -0.15], 0.7], [[-0.25, 2.5, 0.6], 0.65]];
  clusters.forEach(([c, r], ci) => {
    blob(c, r * 0.62);
    for (let k = 0; k < 30; k++) {
      const ph = hash2(ci, k, 311) * Math.PI * 2, ct = 2 * hash2(ci, k, 312) - 1, st = Math.sqrt(1 - ct * ct), rr = r * (0.75 + 0.35 * hash2(ci, k, 313));
      const n = [st * Math.cos(ph), ct * 0.85, st * Math.sin(ph)], p = [c[0] + n[0] * rr, c[1] + n[1] * rr, c[2] + n[2] * rr];
      const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t1 = norm(cross(up, n)), t2 = norm(cross(n, t1)), sz = 0.45 + 0.2 * hash2(ci, k, 314);
      const spin = hash2(ci, k, 315) * Math.PI, a1 = t1.map((x, q) => (x * Math.cos(spin) + t2[q] * Math.sin(spin)) * sz), a2 = t1.map((x, q) => (-x * Math.sin(spin) + t2[q] * Math.cos(spin)) * sz);
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s1, s2]) => [p[0] + a1[0] * s1 + a2[0] * s2, p[1] + a1[1] * s1 + a2[1] * s2, p[2] + a1[2] * s1 + a2[2] * s2]);
      const U = [[0, 1], [1, 1], [1, 0], [0, 0]], ids = P.map((q, m) => cards.vert(q, norm(n), U[m]));
      cards.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
    }
  });
  model('tree.glb', [[trunk, 'bark'], [crown, 'leaves'], [cards, 'leafcard', { alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true }]]);
}
/** a crate: 0.8 m planked box with a metal band, centred on the origin */
{
  const wood = new Mesh(), s = 0.4;
  const c = [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s], [-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]];
  for (const [a, b, cc, d] of [[4, 7, 6, 5], [3, 2, 6, 7], [1, 0, 4, 5], [0, 3, 7, 4], [2, 1, 5, 6], [0, 1, 2, 3]]) {
    const nn = norm(cross(sub(c[b], c[a]), sub(c[d], c[a])));
    const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]; let q = 0;
    wood.quad(c[a], c[b], c[cc], c[d], nn, () => uvs[q++]);
  }
  model('crate.glb', [[wood, 'planks']]);
}
/** the cloud dome: a hemisphere 600 m across round the trail, its clouds drawn unlit over the sky */
{
  const dome = new Mesh(), R = 600, seg = 48, rings = 12, cy = -40;
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const P = (ii, jj) => { const el = (jj / rings) * (Math.PI / 2), az = (ii / seg) * Math.PI * 2; return [Math.cos(el) * Math.cos(az) * R, cy + Math.sin(el) * R * 0.45, Math.cos(el) * Math.sin(az) * R - 22]; };
      const U = (ii, jj) => [(ii / seg) * 3, 1 - jj / rings];
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const ids = [[a, U(i, j)], [b, U(i + 1, j)], [c, U(i + 1, j + 1)], [d, U(i, j + 1)]].map(([p, uv]) => dome.vert(p, norm([-p[0], -(p[1] - cy), -(p[2] + 22)]), uv));
      dome.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
    }
  model('clouds.glb', [[dome, 'clouds', { alphaMode: 'BLEND', doubleSided: true, ext: { KHR_materials_unlit: {} } }]]);
}

/** a 16-bit grey PNG (the heightmap Terrain3D imports): big-endian samples, no filter */
function png16(w, hgt, v) {
  const raw = Buffer.alloc((w * 2 + 1) * hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) raw.writeUInt16BE(v[y * w + x], y * (w * 2 + 1) + 1 + x * 2);
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'latin1'); d.copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(hgt, 4); ih[8] = 16; ih[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── the landscape: a canyon round the trail, rising to cliffs and rock towers at a distance ──
{
  const N = 257, spacing = 2, cx = 0, cz = -21, lo = -12, hi = 110;
  const h = new Uint16Array(N * N), splat = new Uint8Array(N * N * 4), H = new Float32Array(N * N);
  // the trail's footprint (x -7..7, z -48..6): the canyon floor near it, the walls beyond
  const distTrail = (x, z) => Math.hypot(Math.max(Math.abs(x) - 7, 0), Math.max(z - 6, -48 - z, 0));
  // mesas and towers: tall ones east and north (lit by the low western sun), a few far west (silhouettes against it)
  // [x, z, radius, height]: far enough that the chase camera sees their tops (about 9 degrees above its horizon)
  const towers = [[150, -90, 22, 30], [90, -200, 26, 38], [-60, -225, 22, 36], [200, 10, 18, 26], [-170, -60, 20, 26], [40, -170, 16, 28], [-150, -170, 18, 30], [70, -60, 9, 12], [-55, -80, 8, 10]];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = cx + (i - (N - 1) / 2) * spacing, z = cz + (j - (N - 1) / 2) * spacing, u = i / (N - 1), v = j / (N - 1);
      const d = distTrail(x, z);
      const ridge = 1 - Math.abs(fbm(u, v, 4, 5, 201) * 2 - 1); // ridged noise: crests
      const east = smooth(-20, 30, x); // the west stays open towards the sunset: low hills there, cliffs east and north
      const walls = smooth(32, 120, d) * lerp(4 + 8 * ridge, 10 + 18 * ridge * ridge, east);
      let y = -8 + walls + (fbm(u, v, 24, 3, 202) - 0.5) * 1.6 * smooth(4, 12, d);
      for (const [tx, tz, r, th] of towers) { // rock towers: steep sided, flat topped mesas
        const k = smooth(r, r * 0.65, Math.hypot(x - tx, z - tz) * (0.9 + 0.2 * fbm(u, v, 16, 2, 203)));
        y = Math.max(y, -8 + th * k);
      }
      H[j * N + i] = y;
      h[j * N + i] = Math.round(clamp((y - lo) / (hi - lo)) * 65535);
    }
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) { // the splat from slope and height: grass on the flats, scree below the walls, rock on them
      const at = (a, b) => H[Math.min(N - 1, Math.max(0, b)) * N + Math.min(N - 1, Math.max(0, a))];
      const slope = Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (4 * spacing);
      const rock = smooth(0.45, 0.8, slope), dirtK = smooth(0.18, 0.4, slope) * (1 - rock), grassK = Math.max(0, 1 - rock - dirtK);
      const o = (j * N + i) * 4;
      splat[o] = Math.round(grassK * 255); splat[o + 1] = Math.round(rock * 255); splat[o + 2] = Math.round(dirtK * 255); splat[o + 3] = 0;
    }
  writeFileSync(join(TEX, 'terrain_height.png'), png16(N, N, h));
  save(join(TEX, 'terrain_splat.png'), N, N, 4, splat);
  console.log(`textures/terrain_height.png: ${N} x ${N} samples, ${spacing} m apart, ${lo}..${hi} m`);
}
