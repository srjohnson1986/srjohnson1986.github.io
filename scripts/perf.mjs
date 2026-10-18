// Runs the performance checks against a local preview server of the built site:
//
//   node scripts/perf.mjs [--only lighthouse|k6]
//
//   1. starts `astro preview` on 127.0.0.1 (build first: `npm run build:site`)
//   2. Lighthouse CI: measures each page three times (`lhci collect`), then checks the budgets (`lhci assert`)
//   3. k6: a short smoke test with a few virtual users (perf/k6-smoke.js)
//   4. prints a table of every measured value next to its budget, and adds it to the GitHub job summary
//
// Exit code: 0 when every check is inside its budget, 1 when something is over (or missing), 2 when the
// run could not be done (no build, no k6, the server did not start).
//
// It only ever talks to 127.0.0.1. The live site is not ours to load-test, and a number from the internet
// would say more about the network than about a change. See the README section "Performance budgets and
// the k6 smoke test".
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { anyFailed, k6Rows, lighthouseRows, readBudgets, toMarkdown } from './lib/perf-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const config = require(path.join(root, 'lighthouserc.cjs'));

const HOST = '127.0.0.1';
const PORT = 4321;
const ORIGIN = `http://${HOST}:${PORT}`;
const lhciDir = path.join(root, '.lighthouseci');
const outDir = path.join(root, 'perf-results');
const k6Summary = path.join(outDir, 'k6-summary.json');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
if (only && !['lighthouse', 'k6'].includes(only)) {
  console.error('perf: --only takes "lighthouse" or "k6".');
  process.exit(2);
}
const runLighthouse = only !== 'k6';
const runK6 = only !== 'lighthouse';

// Where k6 is: on the PATH, or (on Windows, where the installer may not have updated this shell yet) its usual folder.
function findK6() {
  const probe = spawnSync('k6', ['version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'k6';
  const windows = 'C:\\Program Files\\k6\\k6.exe';
  if (process.platform === 'win32' && fs.existsSync(windows)) return windows;
  return undefined;
}
const k6 = runK6 ? findK6() : undefined;

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('perf: there is no build to measure. Run `npm run build:site` first.');
  process.exit(2);
}
if (runK6 && !k6) {
  console.error('perf: k6 is not installed. The README section "Performance budgets and the k6 smoke test" says how to install it (or run with --only lighthouse).');
  process.exit(2);
}

fs.rmSync(lhciDir, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// --- the preview server ---------------------------------------------------------------------------
// If something already answers on the port, a stale server could be measured instead of the build in dist/,
// and `astro preview` would refuse to start a second one. Stop here rather than report on the wrong thing.
const alreadyUp = await fetch(`${ORIGIN}/`).then(() => true, () => false);
if (alreadyUp) {
  console.error(`perf: something is already listening on ${ORIGIN}. Stop it (a leftover \`astro preview\`?) so the checks measure the build in dist/.`);
  process.exit(2);
}
// Started with node and the astro entry file (not npx), so stopping it later really stops it, on Windows too.
const server = spawn(process.execPath, [path.join(root, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'preview', '--host', HOST, '--port', String(PORT)], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
});
let serverGone = false;
server.on('exit', () => (serverGone = true));
const stopServer = () => {
  if (!serverGone) server.kill();
};
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (serverGone) return false;
    try {
      const res = await fetch(`${ORIGIN}/`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
if (!(await waitForServer())) {
  console.error(`perf: the preview server did not start on ${ORIGIN}. Is something else using port ${PORT}?`);
  process.exit(2);
}

// --- Lighthouse CI --------------------------------------------------------------------------------
const lhci = (command) =>
  spawnSync(process.execPath, [path.join(root, 'node_modules', '@lhci', 'cli', 'src', 'cli.js'), command], { cwd: root, stdio: 'inherit' }).status ?? 1;

let lighthouseStatus = 0;
if (runLighthouse) {
  console.log('\n=== Lighthouse CI: measuring ===');
  lighthouseStatus = lhci('collect');
  if (lighthouseStatus === 0) {
    console.log('\n=== Lighthouse CI: checking the budgets ===');
    lighthouseStatus = lhci('assert');
  }
}

// --- k6 -------------------------------------------------------------------------------------------
let k6Status = 0;
if (runK6) {
  console.log('\n=== k6: smoke test ===');
  k6Status = spawnSync(k6, ['run', '--quiet', '--summary-export', k6Summary, '-e', `BASE_URL=${ORIGIN}`, path.join('perf', 'k6-smoke.js')], { cwd: root, stdio: 'inherit' }).status ?? 1;
}

stopServer();

// --- the report -----------------------------------------------------------------------------------
const rows = [];
if (runLighthouse) {
  const lhrs = fs.existsSync(lhciDir)
    ? fs
        .readdirSync(lhciDir)
        .filter((file) => /^lhr-.*\.json$/.test(file))
        .map((file) => JSON.parse(fs.readFileSync(path.join(lhciDir, file), 'utf8')))
    : [];
  rows.push(...lighthouseRows(readBudgets(config), lhrs));
}
if (runK6) {
  const summary = fs.existsSync(k6Summary) ? JSON.parse(fs.readFileSync(k6Summary, 'utf8')) : undefined;
  rows.push(...k6Rows(summary));
}

const markdown = toMarkdown(rows);
fs.writeFileSync(path.join(outDir, 'report.md'), markdown);
console.log(`\n${markdown}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);

// A tool that exits non-zero is a failure even if its numbers looked fine; the report catches the
// opposite case, a tool that exited 0 but left no result.
process.exit(anyFailed(rows) || lighthouseStatus !== 0 || k6Status !== 0 ? 1 : 0);
