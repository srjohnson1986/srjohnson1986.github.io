import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MAX_RUNS, RESULTS_FILE, TREE_FILE, parseCommit, pickCiResults, usableReport } from '../scripts/lib/ci-results.mjs';

// The deploy reuses the pull request's test results instead of running the suite a second time, but
// only when that CI run passed on exactly the code being deployed (scripts/reuse-ci-results.mjs, logic
// in scripts/lib/ci-results.mjs). These checks run the decision on made-up commits, runs, and reports,
// then read the two workflow files to confirm they are wired to it. No browser, no network.

const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const goodReport = { suites: [{ title: 'a.spec.ts', specs: [] }], stats: { expected: 12, unexpected: 0, flaky: 0, skipped: 1 } };

type Artifact = { tree: string | null; report: unknown };
/** A stand-in for GitHub: which runs a commit has, and what each run's artifact holds. */
function github(runs: Record<string, number[]>, artifacts: Record<number, Artifact | Error>) {
  const asked: string[] = [];
  const downloaded: number[] = [];
  return {
    asked,
    downloaded,
    listRuns: (sha: string) => {
      asked.push(sha);
      return (runs[sha] ?? []).map((id) => ({ id }));
    },
    download: (id: number) => {
      downloaded.push(id);
      const found = artifacts[id];
      if (found instanceof Error) throw found;
      return found;
    },
  };
}
const decide = (gh: ReturnType<typeof github>, commit: { tree?: string | null; parents?: string[] } = {}) =>
  pickCiResults({ tree: TREE, parents: [BASE, HEAD], ...commit, listRuns: gh.listRuns, download: gh.download });

test.describe('the deploy reuses test results only for the exact code being deployed', { tag: ['@req-430'] }, () => {
  test('a passed CI run that tested the same tree is reused', () => {
    const gh = github({ [HEAD]: [71] }, { 71: { tree: `${TREE}\n`, report: goodReport } });
    const decision = decide(gh);
    expect(decision.reuse).toBe(true);
    expect(decision.runId).toBe(71);
    expect(decision.report).toBe(goodReport);
    // The run is looked up by the pull request's last commit: the second parent of the merge commit.
    expect(gh.asked).toEqual([HEAD]);
  });

  test('a run that tested a different tree is not reused (main moved after the check ran)', () => {
    const gh = github({ [HEAD]: [71] }, { 71: { tree: OTHER_TREE, report: goodReport } });
    const decision = decide(gh);
    expect(decision.reuse).toBe(false);
    expect(decision.report).toBeUndefined();
    expect(decision.reason).toContain('different code');
  });

  test('a later run of the same commit is used when an earlier one does not match', () => {
    const gh = github({ [HEAD]: [72, 71] }, { 72: { tree: OTHER_TREE, report: goodReport }, 71: { tree: TREE, report: goodReport } });
    expect(decide(gh)).toMatchObject({ reuse: true, runId: 71 });
    expect(gh.downloaded).toEqual([72, 71]);
  });

  test('a run from before CI recorded the tree is not reused', () => {
    const gh = github({ [HEAD]: [71] }, { 71: { tree: null, report: goodReport } });
    const decision = decide(gh);
    expect(decision.reuse).toBe(false);
    expect(decision.reason).toContain('did not record');
  });

  test('a commit that is not a pull request merge is not looked up at all', () => {
    for (const parents of [[], [BASE], [BASE, HEAD, '3'.repeat(40)]]) {
      const gh = github({ [HEAD]: [71], [BASE]: [70] }, { 70: { tree: TREE, report: goodReport }, 71: { tree: TREE, report: goodReport } });
      const decision = decide(gh, { parents });
      expect(decision.reuse, `${parents.length} parents`).toBe(false);
      expect(gh.asked, `${parents.length} parents`).toEqual([]);
    }
  });

  test('no successful CI run, or an unreadable commit, means no reuse', () => {
    expect(decide(github({}, {}))).toMatchObject({ reuse: false, reason: expect.stringContaining('no successful CI run') });
    const gh = github({ [HEAD]: [71] }, { 71: { tree: TREE, report: goodReport } });
    expect(decide(gh, { tree: null }).reuse).toBe(false);
    expect(gh.asked).toEqual([]);
  });

  test('a missing, empty, or failed report is not reused, even on the same tree', () => {
    const bad: unknown[] = [
      null,
      'not a report',
      {},
      { suites: [], stats: { expected: 12, unexpected: 0 } },
      { suites: [{}], stats: { expected: 0, unexpected: 0 } },
      { suites: [{}], stats: { expected: 12, unexpected: 1 } },
      { suites: [{}] },
    ];
    for (const report of bad) {
      expect(usableReport(report), JSON.stringify(report)).toBe(false);
      const gh = github({ [HEAD]: [71] }, { 71: { tree: TREE, report } });
      expect(decide(gh).reuse, JSON.stringify(report)).toBe(false);
    }
    // A test that passed on its retry does not block reuse: the run still finished green.
    expect(usableReport({ suites: [{}], stats: { expected: 11, unexpected: 0, flaky: 1 } })).toBe(true);
  });

  test('a failed listing or download gives a reason instead of an error', () => {
    const listing = pickCiResults({
      tree: TREE,
      parents: [BASE, HEAD],
      listRuns: () => {
        throw new Error('HTTP 403');
      },
      download: () => ({ tree: TREE, report: goodReport }),
    });
    expect(listing).toMatchObject({ reuse: false, reason: expect.stringContaining('HTTP 403') });

    const expired = github({ [HEAD]: [72, 71] }, { 72: new Error('artifact expired'), 71: { tree: TREE, report: goodReport } });
    // One run's artifact being gone does not stop the next run from being checked.
    expect(decide(expired)).toMatchObject({ reuse: true, runId: 71 });
    const gone = github({ [HEAD]: [72] }, { 72: new Error('artifact expired') });
    expect(decide(gone)).toMatchObject({ reuse: false, reason: expect.stringContaining('artifact expired') });
  });

  test('only the newest few runs of a commit are downloaded', () => {
    const ids = Array.from({ length: MAX_RUNS + 3 }, (_, i) => 100 - i);
    const gh = github({ [HEAD]: ids }, Object.fromEntries(ids.map((id) => [id, { tree: OTHER_TREE, report: goodReport }])));
    expect(decide(gh).reuse).toBe(false);
    expect(gh.downloaded).toEqual(ids.slice(0, MAX_RUNS));
  });

  test('the tree and the parents are read from a raw commit', () => {
    const merge = `tree ${TREE}\nparent ${BASE}\nparent ${HEAD}\nauthor A <a@example.test> 1 +0000\ncommitter A <a@example.test> 1 +0000\n\nMerge pull request #1\n\nparent ${OTHER_TREE} is only text in the message\n`;
    expect(parseCommit(merge)).toEqual({ tree: TREE, parents: [BASE, HEAD] });
    expect(parseCommit(merge.replace(/\n/g, '\r\n'))).toEqual({ tree: TREE, parents: [BASE, HEAD] });
    expect(parseCommit(`tree ${TREE}\nauthor A <a@example.test> 1 +0000\n\nFirst commit\n`)).toEqual({ tree: TREE, parents: [] });
    expect(parseCommit('')).toEqual({ tree: null, parents: [] });
  });

  test('the script exits 0 and writes nothing when the lookup fails', () => {
    const target = path.join(root, 'traceability', RESULTS_FILE);
    const before = fs.existsSync(target) ? fs.statSync(target).mtimeMs : null;
    // A commit that does not exist fails at the first step, before anything reaches GitHub.
    const done = spawnSync(process.execPath, ['scripts/reuse-ci-results.mjs', '--commit', 'no-such-commit'], { cwd: root, encoding: 'utf8' });
    expect(done.status, done.stderr).toBe(0);
    expect(done.stdout).toContain('Running the test suite in this deploy');
    expect(fs.existsSync(target) ? fs.statSync(target).mtimeMs : null).toBe(before);
  });
});

type Step = { name?: string; uses?: string; run?: string; if?: string; 'continue-on-error'?: boolean; with?: Record<string, string> };
type Workflow = { permissions: Record<string, string>; jobs: Record<string, { steps: Step[] }> };
const load = (name: string) => yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8')) as Workflow;

test.describe('the workflows are wired to the reuse rule', { tag: ['@req-430'] }, () => {
  test('CI records the tested tree after the suite and before the results are uploaded', () => {
    const steps = load('ci.yml').jobs.build.steps;
    const at = (match: (s: Step) => boolean) => steps.findIndex(match);
    const suite = at((s) => s.run === 'npx playwright test');
    const record = at((s) => (s.run ?? '').includes("git rev-parse 'HEAD^{tree}'"));
    const upload = at((s) => (s.uses ?? '').startsWith('actions/upload-artifact') && s.with?.name === 'traceability');
    expect(suite).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(suite);
    expect(upload).toBeGreaterThan(record);
    // The file name and folder are the ones the deploy looks for, and the whole folder is uploaded.
    expect(steps[record].run).toContain(`> traceability/${TREE_FILE}`);
    expect(steps[upload].with?.path).toBe('traceability/');
  });

  test('the deploy looks for results before the build, and runs the suite only when none were reused', () => {
    const deploy = load('deploy.yml');
    const steps = deploy.jobs.build.steps;
    const reuse = steps.findIndex((s) => s.run === 'node scripts/reuse-ci-results.mjs');
    const build = steps.findIndex((s) => (s.uses ?? '').startsWith('withastro/action'));
    expect(reuse).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(reuse);
    // The lookup has no condition and no dry run: it runs on every deploy and really writes the file.
    expect(steps[reuse].if).toBeUndefined();
    // Even a script that cannot start (a syntax error, a missing file) must not stop the deploy.
    expect(steps[reuse]['continue-on-error']).toBe(true);

    const command = String(steps[build].with?.['build-cmd']).replace(/\s+/g, ' ').trim();
    // Reused results skip the suite; otherwise it runs, and a failure there still does not stop the deploy.
    expect(command).toContain(`(test -f traceability/${RESULTS_FILE} || npx playwright test || true) &&`);
    expect(command.endsWith('node scripts/traceability.mjs --into dist --allow-problems')).toBe(true);
    expect(command.match(/playwright test/g)).toHaveLength(1);
  });

  test('the deploy may read Actions runs and nothing more than it needs', () => {
    expect(load('deploy.yml').permissions).toEqual({ contents: 'read', issues: 'read', actions: 'read', pages: 'write', 'id-token': 'write' });
  });
});
