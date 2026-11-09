// ./test.sh: every check, in order, each with its control. Prints one line per result; exit 1 when any failed.
//
//   node tests/run.mjs [check ...] [--gpu gl|webgpu]
// Checks: prompts (no GPU); budget, grounding, flash, newcomer, gates, text (the cart through romdev, on GL and WebGPU).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project, sdkTools } from './lib/romdev.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const gpuArgs = argv.includes('--gpu') ? ['--gpu', argv[argv.indexOf('--gpu') + 1]] : [];
const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--gpu');
const env = { ...process.env, CW_PROJECT_ROOT: ROOT }; // the engine's tools run this repository's carts
const node = (args) => spawnSync('node', args, { cwd: ROOT, stdio: 'inherit', env }).status;
const quiet = (args) => spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', env });
const gpus = gpuArgs.length ? [gpuArgs[1]] : ['gl', 'webgpu'];

const CHECKS = {
  // the SDK's prompt check over the game's sources and scenes; its control is a file that names a button
  prompts() {
    const tool = join(sdkTools(ROOT), 'check-prompts.mjs');
    const run = node([tool, 'src', 'main.cwscene', 'scenes']);
    const c = quiet([tool, 'tests/fixtures/prompt-control.c']);
    if (c.status === 0) { console.log('FAIL prompts control: a file that names a button passed the check'); return 1; }
    console.log('ok   prompts control: a file that names a button fails the check, as it must');
    return run;
  },
  budget: () => node(['tests/budget.mjs']),
  grounding: () => node(['tests/grounding.mjs', ...gpuArgs]),
  flash: () => node(['tests/flash.mjs', ...gpuArgs]),
  newcomer: () => node(['tests/newcomer.mjs', ...gpuArgs]),
  // the engine's gate runner, romdev alone: GL the reference, the WebGPU leg against it, a control per leg
  gates: () => node([join(sdkTools(ROOT), '..', 'tests', 'gate.mjs'), '--hosts', 'romdev', '--gpu', gpus.length > 1 ? 'both' : gpus[0]]),
  // the engine's text size check over every screen, and its control: the same screens at half the text size
  text() {
    const tool = join(sdkTools(ROOT), 'check-text.mjs');
    let bad = 0;
    for (const gpu of gpus) bad += node([tool, 'tests/text.json', '--gpu', gpu]) ? 1 : 0;
    const c = quiet([tool, 'tests/text.json', '--gpu', 'gl', '--scales', '0.5']);
    if (c.status === 0) { console.log('FAIL text control: the screens at half text size passed: the check cannot see small text'); bad++; }
    else console.log('ok   text control: the screens at half text size fail, as they must');
    return bad ? 1 : 0;
  },
};

// the apps the engine's tools are told to run are this game's (project.cwproj app, and <app>_auto) and are built:
// a renamed game renames them in tests/gates.json and tests/text.json too (CMakeLists.txt builds no others)
const needsCarts = !names.length || names.some((n) => n !== 'prompts');
const { app: APP } = project(ROOT);
for (const [file, apps] of needsCarts ? [['tests/gates.json', (j) => j.map((g) => g.app)], ['tests/text.json', (j) => [j.app, ...j.screens.map((s) => s.app)]]] : []) {
  for (const app of new Set(apps(JSON.parse(readFileSync(join(ROOT, file), 'utf8'))).filter(Boolean)))
    if (![APP, APP + '_auto'].includes(app) || !existsSync(join(ROOT, 'build/cart-wgpu/carts', app + '.wasc'))) {
      console.error(`${file} names the app "${app}": ${[APP, APP + '_auto'].includes(app) ? 'it has no cart yet: ./build.sh' : `this game's apps are "${APP}" and "${APP}_auto" (project.cwproj app): rename it`}`);
      process.exit(2);
    }
}
const unknown = names.filter((n) => !CHECKS[n]);
if (unknown.length) { console.error(`unknown check(s): ${unknown.join(', ')} (checks: ${Object.keys(CHECKS).join(', ')})`); process.exit(2); }
let failed = [];
for (const [name, run] of Object.entries(CHECKS)) {
  if (names.length && !names.includes(name)) continue;
  console.log(`== ${name}`);
  if (run() !== 0) failed.push(name);
}
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'all checks ok');
process.exit(failed.length ? 1 : 0);
