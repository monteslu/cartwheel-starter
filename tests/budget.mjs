// The request budget's control: a check that loops, one frame a request, must be stopped by tests/lib/romdev.mjs
// before it floods the shared romdev server (it may send at most 40 requests plus 10 a second of game time).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Romdev, project } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = await Romdev.load({ cart: project(ROOT).autoCart, gpu: 'gl', label: 'budget-control' });
let stopped = null;
try {
  for (let i = 0; i < 200; i++) await r.step(1); // the wrong way: a request per frame
} catch (e) {
  stopped = e;
} finally {
  await r.close();
}
if (stopped && /budget/.test(stopped.message)) console.log(`ok   budget control: a loop of one frame a request was stopped after ${r.calls - 1} requests, as it must be`);
else { console.log(`FAIL budget control: a loop of one frame a request was ${stopped ? `stopped by something else: ${stopped.message}` : 'never stopped'}`); process.exit(1); }
