// Collects the project totals the weekly `website-site-stats` routine reports, and checks them.
//
//   node scripts/site-stats.mjs [--write] [--no-tests] [--json] [--repo owner/name] [--out file]
//
// Reads six GitHub API endpoints (the repository, issues, pull requests, merged pull requests, commits, releases),
// counts lines of code from the clone, and counts Playwright tests with `playwright test --list`
// (build the site first: the test files read dist/). Every API answer is checked against a JSON
// Schema in contracts/, the final data is checked against contracts/site-stats.schema.json, and no
// count may be lower than the committed src/data/site-stats.json.
//
// Without --write it only prints the totals. With --write it saves src/data/site-stats.json, and
// only when everything above passed. On any problem it prints one clear line, writes nothing, and
// exits 1.
//
// --no-tests keeps the committed test and spec counts instead of running Playwright (used by the
// tests). --json prints the data as JSON. GITHUB_TOKEN (or GH_TOKEN) raises the rate limit and is
// never printed. GITHUB_API_URL points the script at another API address (the tests use a local
// stand-in; GitHub Actions already sets it to the real one).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API,
  DEFAULT_REPO,
  SiteStatsError,
  buildStats,
  checkNotLower,
  collectApiCounts,
  countLines,
  makeClient,
  parseTestTotal,
  readCommitted,
  writeStats,
} from './lib/site-stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const repo = value('--repo', process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO);
const file = path.resolve(value('--out', path.join(root, 'src', 'data', 'site-stats.json')));
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

try {
  const committed = readCommitted(file);
  const client = makeClient({ token, baseUrl: process.env.GITHUB_API_URL ?? DEFAULT_API });
  if (!token) console.error('site-stats: no GITHUB_TOKEN set, so the unauthenticated rate limit applies (60 calls an hour).');

  const api = await collectApiCounts(client, repo);

  let tests;
  if (flag('--no-tests')) {
    if (!committed) throw new SiteStatsError('--no-tests needs a committed site-stats.json to take the test counts from.');
    tests = { playwright_tests: committed.playwright_tests, spec_files: committed.spec_files };
  } else {
    const listed = spawnSync('npx playwright test --list', { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (listed.status !== 0) throw new SiteStatsError(`\`playwright test --list\` failed: ${listed.stderr.trim().split('\n')[0]}`);
    tests = parseTestTotal(listed.stdout);
  }

  const stats = buildStats({ api, local: { lines_of_code: countLines(root), ...tests }, repo, date: new Date().toISOString().slice(0, 10) });
  checkNotLower(stats, committed);

  if (flag('--write')) {
    writeStats(file, stats);
    console.error(`site-stats: wrote ${path.relative(root, file)} after ${client.calls()} API calls.`);
  } else {
    console.error(`site-stats: checked ${client.calls()} API calls, nothing written (add --write to save).`);
  }
  console.log(flag('--json') ? JSON.stringify(stats, null, 2) : Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join('\n'));
} catch (error) {
  if (!(error instanceof SiteStatsError)) throw error;
  console.error(`site-stats: ${error.message}`);
  // exitCode, not process.exit: on Windows, exiting right after fetch can trip a libuv assertion.
  process.exitCode = 1;
}
