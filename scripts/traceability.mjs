// Builds the requirements traceability matrix and checks it.
//
//   node scripts/traceability.mjs [--results file.json ...] [--out traceability]
//                                 [--requirements issues.json] [--into dist] [--allow-problems]
//
// Reads Playwright JSON reports (a run, and a --list of the smoke project) and the requirements
// from GitHub (issues labelled `requirement`), writes traceability.md and traceability.html, and
// exits 1 when a requirement has no test and no written reason, a test names a requirement that
// does not exist, or a test has no requirement tag. See "Requirements traceability" in the README.
//
// GITHUB_TOKEN is optional (the repository is public); it only raises the rate limit.
// --requirements reads issues from a JSON file instead of GitHub (used by the tests).
// --into <dist> also copies the HTML to the This site project page's report address in a built site.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { buildMatrix, collectTests, summarize, toHtml, toMarkdown, toRequirements } from './lib/traceability.mjs';

const args = process.argv.slice(2);
const values = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const first = (flag, fallback) => values(flag)[0] ?? fallback;
const allowProblems = args.includes('--allow-problems');
const out = first('--out', 'traceability');
const repo = first('--repo', process.env.GITHUB_REPOSITORY ?? 'srjohnson1986/srjohnson1986.github.io');
let results = values('--results');
if (results.length === 0) results = ['traceability/results.json', 'traceability/smoke-results.json'].filter((f) => fs.existsSync(f));
if (results.length === 0) {
  console.error('traceability: no Playwright JSON report found. Run `npm run test:only` (it writes traceability/results.json) or pass --results.');
  process.exit(2);
}

async function fetchIssues() {
  const file = first('--requirements');
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'traceability-report' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const all = [];
  for (let page = 1; page < 20; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=requirement&state=all&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText} for the requirement issues of ${repo}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

let issues;
try {
  issues = await fetchIssues();
} catch (error) {
  console.error(`traceability: could not read the requirements. ${error.message}`);
  process.exit(2);
}

const reports = results.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
// The smoke tests only run against the live site, so a normal run does not include them. List them
// (without running them) so they are still linked to their requirement.
if (!collectTests(reports).some((t) => t.project === 'smoke')) {
  const listed = spawnSync('npx playwright test --list --reporter=json', { shell: true, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, SMOKE_ONLY: '1' } });
  if (listed.status !== 0) {
    console.error(`traceability: could not list the smoke tests.\n${listed.stderr}`);
    process.exit(2);
  }
  reports.push(JSON.parse(listed.stdout));
}
const matrix = buildMatrix(toRequirements(issues), collectTests(reports));
const meta = { generated: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', commit: (process.env.GITHUB_SHA ?? '').slice(0, 7) };
const md = toMarkdown(matrix, meta);
const html = toHtml(matrix, meta);

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'traceability.md'), md);
fs.writeFileSync(path.join(out, 'traceability.html'), html);
const into = first('--into');
if (into) {
  const target = path.join(into, 'development-qa', 'this-site', 'traceability');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'index.html'), html);
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

const s = summarize(matrix);
console.log(`traceability: ${s.requirements} requirements (${s.covered} tested, ${s.exempt} manual, ${s.gaps} gaps), ${s.tests} tests, ${matrix.problems.length} problem(s). Wrote ${out}/traceability.md and .html${into ? ` and the site page in ${into}` : ''}.`);
for (const p of matrix.problems) {
  console.error(process.env.GITHUB_ACTIONS ? `::error title=Traceability::${p.message}` : `  - ${p.message}`);
}
// exitCode, not process.exit: on Windows, exiting right after fetch can trip a libuv assertion.
process.exitCode = matrix.problems.length && !allowProblems ? 1 : 0;
