// Lets the deploy skip a second run of the test suite when the pull request's CI run already tested
// exactly the code being deployed.
//
//   node scripts/reuse-ci-results.mjs [--commit <sha>] [--dry-run]
//
// It looks up the successful CI run of the merged pull request, downloads its `traceability` artifact,
// and, only if that run tested the same Git tree as the commit being deployed, copies its Playwright
// report to traceability/results.json. The deploy then builds the traceability matrix from that file
// and skips the suite. When there is nothing to reuse it writes nothing, and the deploy runs the suite
// itself. The decision is in scripts/lib/ci-results.mjs.
//
// It always exits 0: a lookup that fails must never fail a deploy. It needs the GitHub CLI (`gh`),
// which reads its token from GH_TOKEN or GITHUB_TOKEN, and permission to read Actions runs.
// --commit checks another commit instead of HEAD; --dry-run reports the decision and writes nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RESULTS_FILE, TREE_FILE, parseCommit, pickCiResults } from './lib/ci-results.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const commit = value('--commit', 'HEAD');
const dryRun = args.includes('--dry-run');
const target = path.join('traceability', RESULTS_FILE);
const repo = process.env.GITHUB_REPOSITORY;

function run(command, commandArgs) {
  const done = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (done.error) throw new Error(`${command} could not be started: ${done.error.message}`);
  if (done.status !== 0) throw new Error(`${command} ${commandArgs[0]} failed: ${(done.stderr || done.stdout || '').trim().split('\n')[0]}`);
  return done.stdout;
}
const gh = (...commandArgs) => run('gh', repo ? [...commandArgs, '--repo', repo] : commandArgs);

function listRuns(sha) {
  const out = gh('run', 'list', '--workflow', 'ci.yml', '--commit', sha, '--status', 'success', '--limit', '5', '--json', 'databaseId');
  return JSON.parse(out).map((r) => ({ id: r.databaseId }));
}

function download(id) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-results-'));
  gh('run', 'download', String(id), '--name', 'traceability', '--dir', dir);
  const read = (file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : null);
  const text = read(RESULTS_FILE);
  let report = null;
  try {
    report = text ? JSON.parse(text) : null;
  } catch {
    report = null;
  }
  return { tree: read(TREE_FILE), report, file: path.join(dir, RESULTS_FILE) };
}

function say(message) {
  console.log(`reuse-ci-results: ${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

try {
  const files = new Map();
  const { tree, parents } = parseCommit(run('git', ['cat-file', '-p', commit]));
  const decision = pickCiResults({
    tree,
    parents,
    listRuns,
    download: (id) => {
      const artifact = download(id);
      files.set(id, artifact.file);
      return artifact;
    },
  });
  if (!decision.reuse) {
    say(`Running the test suite in this deploy: ${decision.reason}.`);
  } else if (dryRun) {
    say(`Would reuse the test results: ${decision.reason}. Nothing written (dry run).`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Copy under another name, then rename: the deploy only ever sees a complete results.json or none.
    fs.copyFileSync(files.get(decision.runId), `${target}.part`);
    fs.renameSync(`${target}.part`, target);
    say(`Reusing the test results instead of running the suite again: ${decision.reason}.`);
  }
} catch (error) {
  // Whatever went wrong, the deploy carries on and runs the suite itself.
  say(`Running the test suite in this deploy: the lookup failed (${error.message}).`);
}
