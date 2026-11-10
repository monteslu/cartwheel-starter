// The newcomer gate: can someone who has never seen the game finish level 1 from what the screen tells them?
//
// A bot plays the real cart (the menus too) through romdev, on GL and WebGPU, as a newcomer would:
//   - it knows only the on-screen cues the game draws, read from the debug fields tests/game.json names (an arrow,
//     a prompt): never positions, maps or the level's layout;
//   - it looks at the screen about five times a second (human.lookEveryMs) and acts on what it saw a reaction time
//     later (human.reactionMs); between looks it holds what it chose, and the frames run as one romdev request;
//   - it aims badly: a random error on every direction it reads (human.aimErrorDeg), then the nearest of the 8
//     d-pad directions, as a thumb on a d-pad does;
//   - it reaches play through the shell's menus with presses, as a player does;
//   - in a game for more than one player it also plays with a second seat joined that never touches its pad (a
//     friend who joined and put the pad down): the level must still be finishable.
// It passes when the goal field (game.json newcomer.goal) is reached within maxSeconds of play, on every run.
// The control plays twice as long as the slowest passing run took (at least 20 s, at most maxSeconds): a player who
// cannot read the cues and has not finished by then shows the cues matter, and the check spends no minutes more on it.
//
// The CONTROL must fail: the same bot ignoring the cues (it holds forward and presses every button cue on a timer,
// as a player who cannot read the screen would). A control that finishes means the level finishes itself, or the
// goal field cannot tell a finished run from an unfinished one, and the gate fails.
//
// romdev load: two requests a look (a ranged input sequence, then the fields): eight a second of play, ~250 for a 30 s level.
//
//   node tests/newcomer.mjs [--gpu gl|webgpu] [--seed N] [--runs N] [--no-control]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const GPUS = opt('gpu') ? [opt('gpu')] : ['gl', 'webgpu'];
const CFG = JSON.parse(readFileSync(join(ROOT, 'tests/game.json'), 'utf8')).newcomer;
const { cart } = project(ROOT);
const OUT = join(ROOT, 'out/newcomer');
mkdirSync(OUT, { recursive: true });

// the human model: tests/game.json newcomer.human overrides any of these
const HUMAN = { lookEveryMs: 250, reactionMs: [150, 250], aimErrorDeg: 14, pressMs: 130, retryMs: 800, ...(CFG.human || {}) };
const frames = (ms) => Math.round((ms * 60) / 1000);
const LOOK = frames(HUMAN.lookEveryMs), PRESS = frames(HUMAN.pressMs), RETRY = frames(HUMAN.retryMs);

/** a small seeded random source (mulberry32), so a failing run replays with its seed */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const seat0 = (v) => (Array.isArray(v) ? v[0] : v);
const vec0 = (v) => (Array.isArray(v) ? [v[0] || 0, v[1] || 0] : [0, 0]);
const matches = (f, g) => ('equals' in g ? f[g.field] === g.equals : f[g.field] >= g.atLeast);
const DPAD = [['up'], ['up', 'right'], ['right'], ['down', 'right'], ['down'], ['down', 'left'], ['left'], ['up', 'left']];

/** reach play through the shell like a player: accept on the title, each seat joins with south, start plays */
async function enterPlay(r, seats) {
  const idle = () => Array.from({ length: seats }, () => ({ buttons: [] }));
  const tap = async (pad, button) => { const p = idle(); p[pad] = { buttons: [button] }; await r.run([{ pads: p, frames: 6 }, { pads: idle(), frames: 24 }]); };
  let joined = 0;
  for (let tries = 0; tries < 20; tries++) {
    const f = await r.fields();
    const screen = f['shell.screen'];
    if (screen === (CFG.playScreen ?? 3)) return f;
    if (screen === 1) await tap(0, 'south'); // the title: its first item is Play
    else if (screen === 2) await (joined < seats ? tap(joined++, 'south') : tap(0, 'start')); // join: each seat, then start
    else if (screen === 0) await r.run([{ pads: idle(), frames: 30 }]); // still loading
    else throw new Error(`newcomer: the shell is on screen ${screen}, not the title, join or play`);
  }
  throw new Error('newcomer: did not reach play through the menus in 20 tries');
}

/** one playthrough; `blind` is the control (cues ignored) */
async function play(gpu, seats, seed, blind, seconds = null) {
  const r = await Romdev.load({ cart, gpu, label: 'newcomer' });
  const rand = rng(seed);
  const log = [];
  try {
    const start = await enterPlay(r, seats);
    const maxSeconds = seconds ?? +opt('seconds', CFG.maxSeconds || 120), t0 = r.frame, limit = t0 + Math.round(maxSeconds * 60);
    if (start['shell.players'] !== undefined && start['shell.players'] !== seats)
      throw new Error(`newcomer: ${start['shell.players']} player(s) in play, wanted ${seats}`);
    let f = start, heading = null, pressLeft = 0, pressButtons = [];
    const lastPress = (CFG.press || []).map(() => -1e9);
    while (r.frame < limit) {
      if (matches(f, CFG.goal)) return { done: true, secs: ((r.frame - t0) / 60).toFixed(1), requests: r.calls, log };
      // what this look saw is acted on a reaction time later; until then the hands keep doing what they did
      const react = Math.min(LOOK, frames(HUMAN.reactionMs[0] + rand() * (HUMAN.reactionMs[1] - HUMAN.reactionMs[0])));
      const cue = blind ? [0, 1] : vec0(f[CFG.move.field]);
      const held = heading === null ? [] : DPAD[heading];
      if (Math.hypot(...cue) > 0.2) {
        const a = Math.atan2(cue[0], cue[1]) + (gauss(rand) * HUMAN.aimErrorDeg * Math.PI) / 180;
        heading = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
      } else heading = null;
      const move = heading === null ? [] : DPAD[heading];
      // a button prompt on screen gets pressed, and pressed again every retryMs while it stays (nothing happened)
      const now = r.frame - t0, presses = [];
      (CFG.press || []).forEach((p, k) => {
        const on = blind ? now % 90 < LOOK : !!seat0(f[p.field]);
        if (on && now - lastPress[k] >= RETRY) { presses.push(p.button); lastPress[k] = now; }
      });
      const others = Array.from({ length: seats - 1 }, () => ({ buttons: [] }));
      const segs = [];
      const carry = Math.min(pressLeft, react); // a press still held from the last look
      segs.push({ pads: [{ buttons: [...held, ...pressButtons] }, ...others], frames: carry });
      segs.push({ pads: [{ buttons: held }, ...others], frames: react - carry });
      const p = presses.length ? Math.min(PRESS, LOOK - react) : 0;
      segs.push({ pads: [{ buttons: [...move, ...presses] }, ...others], frames: p });
      segs.push({ pads: [{ buttons: move }, ...others], frames: LOOK - react - p });
      if (presses.length) { pressButtons = presses; pressLeft = PRESS - p; } else pressLeft = 0;
      await r.run(segs);
      f = await r.fields();
      log.push([r.frame - t0, ...cue.map((x) => +x.toFixed(2)), [...move, ...presses].join('+'), ...(CFG.progress || []).map((k) => f[k]), ...(CFG.press || []).map((p) => seat0(f[p.field]))]);
    }
    await r.shot(join(OUT, `${gpu}-${seats}p-${blind ? 'control' : seed}-timeout.png`));
    return { done: false, secs: maxSeconds, requests: r.calls, log, fields: Object.fromEntries((CFG.progress || []).map((k) => [k, f[k]])) };
  } finally {
    await r.close();
  }
}

let failed = 0;
const seats = CFG.players > 1 ? [1, 2] : [1];
const runs = +opt('runs', CFG.runs || 1), seed0 = +opt('seed', 1);
for (const gpu of GPUS) {
  let slowest = 0;
  for (const n of seats) {
    for (let k = 0; k < runs; k++) {
      const seed = seed0 + k + (n - 1) * 100;
      const tag = `newcomer (${gpu}, ${n === 1 ? 'one player' : `${n} seats, seat 2 idle`}, seed ${seed})`;
      const res = await play(gpu, n, seed, false);
      writeFileSync(join(OUT, `${gpu}-${n}p-${seed}.json`), JSON.stringify(res.log));
      if (res.done) { console.log(`ok   ${tag}: finished in ${res.secs} s (${res.requests} romdev requests)`); slowest = Math.max(slowest, +res.secs); }
      else { console.log(`FAIL ${tag}: not finished in ${res.secs} s (${JSON.stringify(res.fields)}); its trace: out/newcomer/${gpu}-${n}p-${seed}.json`); failed++; }
    }
  }
  if (!argv.includes('--no-control')) {
    const cap = +opt('seconds', CFG.maxSeconds || 120);
    const res = await play(gpu, 1, seed0, true, slowest ? Math.min(cap, Math.max(20, Math.ceil(slowest * 2))) : cap);
    if (res.done) { console.log(`FAIL newcomer control (${gpu}, cues ignored) finished in ${res.secs} s: the gate cannot tell a player who reads the cues from one who does not`); failed++; }
    else console.log(`ok   newcomer control (${gpu}, cues ignored): did not finish, as it must (${JSON.stringify(res.fields)}, ${res.requests} romdev requests)`);
  }
}
process.exit(failed ? 1 : 0);
