// A small client for the romdev MCP server's HTTP tool route (127.0.0.1:7331, or ROMDEV_URL): load the game's
// cart, step frames, set the pads, read debug fields, send debug requests, take screenshots. Every check in
// tests/ runs the cart through romdev with it: the cart is what ships, and romdev runs it headless on GL or
// WebGPU on the same GPU every time.
//
//   import { Romdev } from './lib/romdev.mjs';
//   const r = await Romdev.load({ cart, gpu: 'gl' });    // or 'webgpu'
//   await r.step(60); const f = await r.fields(); await r.shot('out/a.png'); await r.close();
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL_BASE = process.env.ROMDEV_URL || 'http://127.0.0.1:7331';
let seq = 0;

/** the machine's test GPU (~/.config/cartwheel/wgpu-adapter, chromium-gpu), when it names one: carts run on it */
function testGpu() {
  const dir = process.env.XDG_CONFIG_HOME || join(process.env.HOME || '', '.config');
  const read = (f) => { try { return readFileSync(join(dir, 'cartwheel', f), 'utf8').trim(); } catch { return ''; } };
  const match = (process.env.CW_WGPU_ADAPTER || read('wgpu-adapter')).toLowerCase();
  const pci = process.env.CW_CHROMIUM_GPU || read('chromium-gpu');
  if (!match || !pci || !existsSync(`/sys/bus/pci/devices/${pci}`)) return null;
  let vram = 0;
  try { vram = +readFileSync(`/sys/bus/pci/devices/${pci}/mem_info_vram_total`, 'utf8'); } catch { /* not amdgpu */ }
  return { match, power: vram === 0 || vram >= 3 * 2 ** 30 ? 'high-performance' : 'low-power' };
}

/** romdev's names for the engine's buttons (south east west north l r start up down left right; back is select) */
const BTN = { back: 'select' }; // romdev takes the spatial names (south, east, ...) for a wasmcart pad

// The request budget: a check sends ranges (one request steps many frames, then one reads), never a request per
// frame. Past BASE requests plus PER_SECOND for each second of game time run, the next request throws, so a check
// that loops fails at once instead of flooding the shared server.
const BUDGET = { base: 40, perSecond: 10 };

export class Romdev {
  constructor(session) { this.session = session; this.frame = 0; this.calls = 0; }

  /** requests sent, and the budget at this frame */
  budget() { return { calls: this.calls, limit: Math.floor(BUDGET.base + (this.frame / 60) * BUDGET.perSecond) }; }

  async call(tool, args) {
    this.calls++;
    const b = this.budget();
    if (b.calls > b.limit && !(tool === 'host' && args.op === 'shutdown'))
      throw new Error(`romdev request budget passed: ${b.calls} requests by frame ${this.frame} (at most ${BUDGET.base} + ${BUDGET.perSecond} a second of game time). Send ranges: one input sequence or frame step for many frames, then read once.`);
    let res;
    try {
      res = await fetch(`${URL_BASE}/tool/${tool}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-romdev-session': this.session, ...(process.env.ROMDEV_AGENT ? { 'x-romdev-agent': process.env.ROMDEV_AGENT } : {}) }, body: JSON.stringify(args) });
    } catch (e) {
      throw new Error(`romdev is not running at ${URL_BASE} (${e.cause?.code || e.message}): start it (npx romdevtools, see AGENTS.md)`);
    }
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok || body?.isError || (body && typeof body === 'object' && typeof body.error === 'string') || (typeof body === 'string' && /^error/i.test(body))) throw new Error(`romdev ${tool}(${JSON.stringify(args).slice(0, 200)}): ${typeof body === 'string' ? body : JSON.stringify(body).slice(0, 1500)}`);
    return body;
  }

  /** load a cart deterministically on 'gl' or 'webgpu'; frame 1 has run when this returns. seed: null loads it as a
   * player's host runs it: no seed, so its warm-up spreads over frames under the loading screen and Auto picks the
   * graphics (frames that are not reproducible: for checks that look for what a player can meet, not for hashes) */
  static async load({ cart, gpu = 'gl', seed = 1, label = 'check' }) {
    if (!existsSync(cart)) throw new Error(`no cart ${cart}: run ./build.sh first`);
    const r = new Romdev(`${label}-${gpu}-${process.pid}-${++seq}`);
    const pin = testGpu();
    const args = { platform: 'wasmcart', path: cart, wgpu: gpu === 'webgpu', ...(seed === null ? {} : { deterministicSeed: seed }) };
    if (pin) args.gpuPower = pin.power;
    const l = await r.call('loadMedia', args);
    const got = l.gpu === 'webgpu' ? 'webgpu' : 'gl';
    if (got !== gpu) { await r.close(); throw new Error(`romdev ran the cart on ${l.gpu}, not ${gpu}`); }
    if (gpu === 'webgpu' && pin && !String(l.gpuAdapter?.device || l.gpuAdapter?.description || '').toLowerCase().includes(pin.match)) {
      await r.close();
      throw new Error(`romdev's WebGPU adapter is ${JSON.stringify(l.gpuAdapter)}, not the test GPU (${pin.match})`);
    }
    r.gpu = gpu; r.width = l.fbWidth; r.height = l.fbHeight; r.frame = 1;
    return r;
  }

  async step(n = 1) { if (n > 0) { await this.call('frame', { op: 'step', frames: n }); this.frame += n; } }
  async stepTo(frame) { await this.step(frame - this.frame); }

  /** hold pads: [{ buttons: ['south', 'up'] }, ...] (pad 0, 1, ...); romdev takes no stick axes, so movement is the d-pad */
  async pads(list) {
    const ports = list.map((p) => Object.fromEntries((p?.buttons || []).map((b) => [BTN[b] || b, true])));
    await this.call('input', { op: 'set', ports });
  }

  /** a range in ONE request: [{ pads: [{ buttons }, ...], frames }, ...] held in turn (romdev input sequence).
   * Send ranges, never a request per frame: a check reads the fields once at the end of a range. */
  async run(segments) {
    const steps = segments.filter((s) => s.frames > 0).map((s) => ({
      input: { ports: s.pads.map((p) => Object.fromEntries((p?.buttons || []).map((b) => [BTN[b] || b, true]))) }, frames: s.frames }));
    if (!steps.length) return;
    await this.call('input', { op: 'sequence', steps });
    this.frame += steps.reduce((n, s) => n + s.frames, 0);
  }

  /** every debug field as { name: value } (arrays as arrays) */
  async fields() {
    const s = await this.call('wasm', { op: 'debugState' });
    const o = {};
    for (const f of s.fields || []) o[f.name] = 'values' in f ? f.values : 'value' in f ? f.value : f.text;
    return o;
  }

  /** a debug request (help, quality, set, grounding, ...): its JSON reply. Costs the game one frame. */
  async command(text) {
    const r = await this.call('wasm', { op: 'command', text });
    this.frame += r.framesRun || 0;
    if (r.reply && r.reply.error) throw new Error(`debug request "${text}": ${r.reply.error}`);
    return r.reply;
  }

  async shot(path) { path = resolve(path); await this.call('frame', { op: 'screenshot', path }); return path; }
  async close() { await this.call('host', { op: 'shutdown' }).catch(() => {}); }
}

/** the game's name (`app` in project.cwproj) and its carts */
export function project(root) {
  const app = /^app *= *"?([A-Za-z_]\w*)/m.exec(readFileSync(join(root, 'project.cwproj'), 'utf8'))?.[1];
  if (!app) throw new Error('project.cwproj: no `app = <name>`');
  const cart = (name) => join(root, 'build/cart-wgpu/carts', `${name}.wasc`);
  return { app, cart: cart(app), autoCart: cart(app + '_auto') };
}

/** the fetched SDK's tools directory (deps/cartwheel-sdk/<this machine's target>/tools): the engine's check tools */
export function sdkTools(root) {
  const dir = join(root, 'deps/cartwheel-sdk');
  const t = { 'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64', 'darwin-arm64': 'macos-arm64' }[`${process.platform}-${process.arch}`];
  const p = t && join(dir, t, 'tools');
  if (!p || !existsSync(p)) throw new Error(`no engine SDK tools at ${p}: run ./build.sh first`);
  return p;
}
