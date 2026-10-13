// Measures each lane resume and saves how many steps of its cut plan (src/lib/lane-fit.js) it takes to fit two pages.
//
//   node scripts/fit-lanes.mjs            fit every lane and write src/data/resume/lane-fit.yaml
//   node scripts/fit-lanes.mjs --check    change nothing; fail if a saved fit is missing, stale, or no longer fits
//
// How it works:
//   1. Builds a throwaway copy of the site (LANE_FIT=1) that has, for every lane, a page holding all of its candidate
//      bullets plus the cut plan as JSON. The copy is deleted afterwards and is never published.
//   2. Opens each lane page in headless Chromium. For a number of cut steps k, it shows only the items left after k
//      steps, prints the page to a PDF, and counts the pages. Every step only removes content, so it searches for the
//      smallest k that fits (a binary search, then a check of the answer) instead of rendering every state.
//   3. "Fits" means two pages or fewer AND a safety margin: the content must end a few lines short of the end of page 2,
//      so a small difference in another machine's text layout does not push a lane onto a third page.
//
// If even tier 1 plus the role floors does not fit, the lane is flagged and nothing is written (tier 1 is never cut).
// Exit code 1 on a flag, a stale or failing check, or any error.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import * as yaml from 'js-yaml';
import { applySteps } from '../src/lib/lane-fit.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fitFile = path.join(root, 'src', 'data', 'resume', 'lane-fit.yaml');
const reportFile = path.join(root, 'private', 'lane-fit-report.md');
const check = process.argv.includes('--check');

const MAX_PAGES = 2;
const PAGE_PX = 960; // 10in of content on a letter page with the @page margins of print.css
const SLACK_PX = 48; // the content must end at least this far above the end of page 2 (about two lines)
const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

const fail = (message) => {
  console.error(`fit-lanes: ${message}`);
  process.exit(1);
};

// ------------------------------------------------------------------ 1. build the fit pages
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-lanes-'));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
process.on('exit', cleanup);

console.log('fit-lanes: building the lane fit pages...');
const build = spawnSync('npx', ['astro', 'build'], {
  cwd: root,
  shell: true,
  encoding: 'utf8',
  env: { ...process.env, LANE_FIT: '1', LANE_FIT_OUT: tmp },
});
if (build.status !== 0) fail(`the build failed:\n${build.stdout}\n${build.stderr}`);
const pagesDir = path.join(tmp, 'resume', 'lane-fit');
if (!fs.existsSync(pagesDir)) fail('the build made no lane fit pages. Is anything tagged for a lane?');
const laneIds = fs.readdirSync(pagesDir).sort();

// ------------------------------------------------------------------ 2. serve them and measure
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let file = path.join(tmp, decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
    if (path.relative(tmp, file).startsWith('..')) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  server.close();
  fail(`could not start Chromium. Install it with: npx playwright install chromium-headless-shell\n${error.message}`);
}

/** Opens a lane page and returns a function that measures the lane with only the first k cut steps applied. */
async function openLane(laneId) {
  const page = await browser.newPage({ viewport: { width: 701, height: 960 } });
  await page.goto(`http://127.0.0.1:${port}/resume/lane-fit/${laneId}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const { fingerprint, plan } = JSON.parse(await page.locator('#lane-plan').evaluate((el) => el.textContent));

  async function measure(k) {
    const visible = applySteps(plan, k).map((i) => i.id);
    const height = await page.evaluate((keys) => {
      const show = new Set(keys);
      for (const li of document.querySelectorAll('li[data-key]')) {
        const on = show.has(li.dataset.key);
        li.hidden = !on;
        li.style.display = on ? '' : 'none';
      }
      // A role with nothing left disappears with its heading; a role with three or fewer bullets stays in one piece.
      for (const role of document.querySelectorAll('section.role')) {
        const left = role.querySelectorAll('li[data-key]:not([hidden])').length;
        role.hidden = left === 0;
        role.style.display = left === 0 ? 'none' : '';
        role.classList.toggle('role-short', left <= 3);
      }
      return document.querySelector('.resume').scrollHeight;
    }, visible);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pages = countPages(pdf);
    return { k, pages, height, fits: pages <= MAX_PAGES && height <= MAX_PAGES * PAGE_PX - SLACK_PX, items: visible.length };
  }
  return { page, fingerprint, plan, measure };
}

const results = [];
const flagged = [];
const saved = fs.existsSync(fitFile) ? (yaml.load(fs.readFileSync(fitFile, 'utf8')) ?? []) : [];
const problems = [];

try {
  for (const laneId of laneIds) {
    const lane = await openLane(laneId);
    const n = lane.plan.steps.length;

    if (check) {
      const entry = saved.find((e) => e.id === laneId);
      if (!entry) problems.push(`${laneId}: no saved fit`);
      else if (entry.fingerprint !== lane.fingerprint) problems.push(`${laneId}: the saved fit is stale (the data, wording, summary, skills, or print stylesheet changed)`);
      else {
        const m = await lane.measure(entry.steps);
        if (!m.fits) problems.push(`${laneId}: the saved fit no longer fits (${m.pages} page(s), content ${m.height}px of ${MAX_PAGES * PAGE_PX - SLACK_PX}px allowed)`);
        else results.push({ laneId, ...m, fingerprint: lane.fingerprint, plan: lane.plan });
      }
      await lane.page.close();
      continue;
    }

    // Search for the smallest k that fits.
    const everything = await lane.measure(n);
    if (!everything.fits) {
      flagged.push(`${laneId}: does not fit even with every possible cut (tier 1 and the role floors alone take ${everything.pages} page(s), content ${everything.height}px of ${MAX_PAGES * PAGE_PX - SLACK_PX}px allowed)`);
      await lane.page.close();
      continue;
    }
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await lane.measure(mid)).fits) hi = mid;
      else lo = mid + 1;
    }
    let best = await lane.measure(lo);
    // The search assumes every step only helps. Check it, and fall back to a plain scan if it does not hold.
    if (!best.fits || (lo > 0 && (await lane.measure(lo - 1)).fits)) {
      console.warn(`fit-lanes: ${laneId}: the cuts did not shrink the page evenly; scanning one step at a time`);
      for (let k = 0; k <= n; k++) {
        best = await lane.measure(k);
        if (best.fits) break;
      }
    }
    results.push({ laneId, ...best, fingerprint: lane.fingerprint, plan: lane.plan });
    await lane.page.close();
  }
} finally {
  await browser.close();
  server.close();
}

// ------------------------------------------------------------------ 3. report and save
const lines = ['# Lane fit report', '', `Made ${new Date().toISOString().slice(0, 10)}. Private: this file is not committed.`, ''];
console.log('');
for (const r of results) {
  const swaps = r.plan.steps.slice(0, r.k).filter((s) => s.type === 'swap');
  const cuts = r.plan.steps.slice(0, r.k).filter((s) => s.type === 'cut');
  const kept = applySteps(r.plan, r.k);
  console.log(`  ${r.laneId.padEnd(5)} ${String(r.k).padStart(3)} of ${String(r.plan.steps.length).padStart(3)} steps  ${kept.length} items shown (${r.plan.initial.length} to start, ${swaps.length} swaps, ${cuts.length} cuts)  ${r.pages} page(s)  ${r.height}px of ${MAX_PAGES * PAGE_PX}px`);
  lines.push(`## ${r.laneId}`, '', `${kept.length} items shown, ${swaps.length} combined-bullet swaps, ${cuts.length} cuts, ${r.pages} page(s), content ${r.height}px of ${MAX_PAGES * PAGE_PX}px (limit ${MAX_PAGES * PAGE_PX - SLACK_PX}px).`, '');
  const byRole = new Map();
  for (const i of kept) byRole.set(i.role, [...(byRole.get(i.role) ?? []), i]);
  lines.push('Shown:', '');
  for (const [role, items] of byRole) for (const i of items) lines.push(`- ${role} tier ${i.tier}.${i.pos} \`${i.id}\`${i.kind === 'combo' ? ' (combined)' : ''}`);
  lines.push('', 'Cut or swapped out:', '');
  for (const s of r.plan.steps.slice(0, r.k)) lines.push(s.type === 'swap' ? `- swapped ${s.replaces.map((x) => `\`${x}\``).join(', ')} for \`${s.combo}\`` : `- cut ${s.role} tier ${s.tier} \`${s.id}\``);
  lines.push('');
}

if (flagged.length) {
  console.error('\nFLAGGED (nothing was written):');
  for (const f of flagged) console.error(`  - ${f}`);
  fail('some lanes cannot fit on two pages without cutting tier 1. Tell the owner.');
}
if (problems.length) {
  console.error('\nProblems:');
  for (const p of problems) console.error(`  - ${p}`);
  fail('run "npm run fit-lanes" to fit the lanes again, then commit src/data/resume/lane-fit.yaml.');
}

if (check) {
  console.log(`\nfit-lanes: ${results.length} lane(s) are up to date and fit.`);
} else {
  const eol = fs.existsSync(fitFile) && fs.readFileSync(fitFile, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  const text =
    ["# Where each lane's fit stands: how many steps of the lane's cut plan (src/lib/lane-fit.js) it takes to fit two pages,", '# and the fingerprint of everything that fit was measured against. Written by scripts/fit-lanes.mjs (npm run fit-lanes); do not edit by hand.', '']
      .concat(results.flatMap((r) => [`- id: ${r.laneId}`, `  steps: ${r.k}`, `  fingerprint: ${r.fingerprint}`, `  pages: ${r.pages}`, '']))
      .join(eol)
      .trimEnd() + eol;
  const before = fs.existsSync(fitFile) ? fs.readFileSync(fitFile, 'utf8') : '';
  if (before === text) console.log('\nfit-lanes: lane-fit.yaml is already up to date.');
  else {
    fs.writeFileSync(fitFile, text);
    console.log('\nfit-lanes: wrote src/data/resume/lane-fit.yaml');
  }
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, lines.join('\n'));
  console.log('fit-lanes: wrote private/lane-fit-report.md (what each lane keeps and drops)');
}
