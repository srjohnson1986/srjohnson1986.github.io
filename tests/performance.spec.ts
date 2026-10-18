import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - a plain JavaScript module, shared with the runner
import { anyFailed, k6Rows, lighthouseRows, readBudgets, toMarkdown } from '../scripts/lib/perf-report.mjs';

// The performance checks (Lighthouse CI budgets and the k6 smoke test) are run by `npm run perf`, in the
// Performance workflow. These specs do not repeat that measurement: timings depend on the machine, so a
// copy inside this suite would be noisy and would only duplicate the check it guards. They read the files
// and check what can be checked exactly - the budget numbers, the k6 settings, the workflow settings, and
// the report builder on made-up results. No browser, no build, no network.

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const config = createRequire(import.meta.url)(path.join(root, 'lighthouserc.cjs'));
const KB = 1024;

type Assertion = [string, { minScore?: number; maxNumericValue?: number; aggregationMethod?: string }];
const matrix = config.ci.assert.assertMatrix as { matchingUrlPattern: string; assertions: Record<string, Assertion> }[];
const entryFor = (url: string) => matrix.find((entry) => new RegExp(entry.matchingUrlPattern).test(url))!;

// What was approved on 2026-10-18, from seven real runs per page. A change here is a deliberate decision:
// update lighthouserc.cjs, this table, the issue, and the README together.
const APPROVED = {
  '/': { score: 0.95, lcp: 2000, tbt: 200, cls: 0.05, weight: 125 * KB },
  '/resume/qa/': { score: 0.95, lcp: 2000, tbt: 200, cls: 0.05, weight: 75 * KB },
  '/art/': { score: 0.9, lcp: 2500, tbt: 200, cls: 0.05, weight: 1400 * KB },
} as const;

test.describe('Performance budgets cover the home, resume, and Art pages on five measures', { tag: ['@req-373'] }, () => {
  test('exactly three pages are measured, all on the local address', () => {
    const urls = config.ci.collect.url as string[];
    expect(urls.map((u) => new URL(u).pathname).sort()).toEqual(Object.keys(APPROVED).sort());
    for (const url of urls) expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(matrix).toHaveLength(3);
  });

  for (const [page, limits] of Object.entries(APPROVED)) {
    test(`${page} has all five limits, at the approved values`, () => {
      const url = `http://127.0.0.1:4321${page}`;
      const a = entryFor(url).assertions;
      expect(Object.keys(a).sort()).toEqual(
        ['categories:performance', 'cumulative-layout-shift', 'largest-contentful-paint', 'total-blocking-time', 'total-byte-weight'],
      );
      expect(a['categories:performance'][1].minScore).toBe(limits.score);
      expect(a['largest-contentful-paint'][1].maxNumericValue).toBe(limits.lcp);
      expect(a['total-blocking-time'][1].maxNumericValue).toBe(limits.tbt);
      expect(a['cumulative-layout-shift'][1].maxNumericValue).toBe(limits.cls);
      expect(a['total-byte-weight'][1].maxNumericValue).toBe(limits.weight);
    });
  }

  test('a missed budget is an error (not a warning), judged on the median of three runs', () => {
    expect(config.ci.collect.numberOfRuns).toBe(3);
    for (const entry of matrix) {
      for (const [id, [level, options]] of Object.entries(entry.assertions)) {
        expect(level, `${entry.matchingUrlPattern} ${id}`).toBe('error');
        expect(options.aggregationMethod, `${entry.matchingUrlPattern} ${id}`).toBe('median');
      }
    }
  });

  test('results stay on this machine and the page patterns match only their own page', () => {
    expect(config.ci.upload.target).toBe('filesystem');
    const urls = config.ci.collect.url as string[];
    for (const entry of matrix) {
      const matches = urls.filter((u) => new RegExp(entry.matchingUrlPattern).test(u));
      expect(matches, entry.matchingUrlPattern).toHaveLength(1);
    }
  });
});

const k6Script = read('perf/k6-smoke.js');

test.describe('The k6 smoke test has error-rate and p95 thresholds and only targets a local server', { tag: ['@req-374'] }, () => {
  test('a few virtual users for a short time', () => {
    const vus = Number(/vus:\s*(\d+)/.exec(k6Script)?.[1]);
    const seconds = Number(/duration:\s*'(\d+)s'/.exec(k6Script)?.[1]);
    expect(vus).toBeGreaterThanOrEqual(1);
    expect(vus).toBeLessThanOrEqual(5);
    expect(seconds).toBeGreaterThanOrEqual(5);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  test('fails on an error rate of 1% or more or a p95 response time of 100 ms or more', () => {
    expect(k6Script).toContain("http_req_failed: ['rate<0.01']");
    expect(k6Script).toContain("http_req_duration: ['p(95)<100']");
  });

  test('requests only the home page, the resume page, and the Art page', () => {
    expect(/const PAGES = \[(.*?)\];/.exec(k6Script)?.[1]).toBe("'/', '/resume/qa/', '/art/'");
  });

  test('stops before the first request if BASE_URL is not a local address', () => {
    // The guard is a pattern plus a throw, both before the default function. Check the pattern on real examples.
    const pattern = new RegExp(/if \(!(\/.*\/)\.test\(BASE_URL\)\)/.exec(k6Script)![1].slice(1, -1));
    for (const ok of ['http://127.0.0.1:4321', 'http://127.0.0.1', 'http://localhost:4321']) expect(ok).toMatch(pattern);
    for (const bad of ['https://srjohnson1986.github.io', 'http://example.com', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com:80', 'https://127.0.0.1:4321', 'http://10.0.0.5:4321']) {
      expect(bad).not.toMatch(pattern);
    }
    expect(k6Script.indexOf('throw new Error')).toBeLessThan(k6Script.indexOf('export default function'));
  });

  test('nothing in the performance files names the live site', () => {
    for (const file of ['perf/k6-smoke.js', 'lighthouserc.cjs', 'scripts/perf.mjs', 'scripts/lib/perf-report.mjs', '.github/workflows/performance.yml']) {
      expect(read(file), file).not.toContain('github.io');
    }
  });
});

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
const workflowText = read('.github/workflows/performance.yml');
const workflow = yaml.load(workflowText) as {
  on: { pull_request?: { paths: string[] }; workflow_dispatch?: unknown; [k: string]: unknown };
  permissions: Record<string, string>;
  concurrency?: { group: string };
  jobs: Record<string, { 'timeout-minutes'?: number; permissions?: unknown; steps: Step[] }>;
};
const job = workflow.jobs.performance;

test.describe('The performance workflow measures only a local build and only on site changes', { tag: ['@req-375'] }, () => {
  test('runs on pull requests that change site code, content, or the performance files, and on demand', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    const paths = workflow.on.pull_request!.paths;
    for (const needed of ['src/**', 'public/**', 'package-lock.json', 'lighthouserc.cjs', 'perf/**', 'scripts/perf.mjs', '.github/workflows/performance.yml']) {
      expect(paths, needed).toContain(needed);
    }
    // A pull request that only changes tests, docs, or other workflows does not start it.
    for (const left of ['tests/**', 'docs/**', 'README.md']) expect(paths).not.toContain(left);
  });

  test('builds the site, then runs the one script that serves it on 127.0.0.1 and measures it', () => {
    const runs = job.steps.map((s) => s.run ?? '');
    const build = runs.findIndex((r) => r.includes('npm run build:site'));
    const perf = runs.findIndex((r) => r.trim() === 'npm run perf');
    expect(build).toBeGreaterThanOrEqual(0);
    expect(perf).toBeGreaterThan(build);
    const runner = read('scripts/perf.mjs');
    expect(runner).toContain("const HOST = '127.0.0.1'");
    expect(runner).toContain("'preview'");
    expect(runner).not.toMatch(/https:\/\//); // no other address to talk to (the install link is in a message, not a request)
  });

  test('is read-only, has a timeout and a concurrency group, and takes no secrets', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(workflow.concurrency?.group).toContain('performance');
    expect(workflowText).not.toContain('secrets.');
  });

  test('the only action from outside GitHub is pinned to a full commit, and k6 to an exact version', () => {
    const outside = job.steps.filter((s) => s.uses && !s.uses.startsWith('actions/'));
    expect(outside.map((s) => s.uses!.split('@')[0])).toEqual(['grafana/setup-k6-action']);
    expect(outside[0].uses).toMatch(/@[0-9a-f]{40}$/);
    expect(String(outside[0].with?.['k6-version'])).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('keeps the results, even when the run failed', () => {
    const upload = job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'))!;
    expect(upload).toBeDefined();
    expect((upload as { if?: string }).if).toContain('!cancelled()');
  });
});

// Made-up results, shaped like the files Lighthouse and k6 write.
const lhr = (url: string, score: number, lcp: number, tbt: number, cls: number, bytes: number) => ({
  finalDisplayedUrl: url,
  categories: { performance: { score } },
  audits: {
    'largest-contentful-paint': { numericValue: lcp },
    'total-blocking-time': { numericValue: tbt },
    'cumulative-layout-shift': { numericValue: cls },
    'total-byte-weight': { numericValue: bytes },
  },
});
const smallConfig = {
  ci: {
    collect: { url: ['http://127.0.0.1:4321/', 'http://127.0.0.1:4321/art/'] },
    assert: {
      assertMatrix: [
        { matchingUrlPattern: '^http://[^/]+/$', assertions: { 'categories:performance': ['error', { minScore: 0.95 }], 'largest-contentful-paint': ['error', { maxNumericValue: 2000 }], 'total-byte-weight': ['error', { maxNumericValue: 125 * KB }] } },
        { matchingUrlPattern: '/art/$', assertions: { 'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }] } },
      ],
    },
  },
};
const goodHome = [1, 2, 3].map(() => lhr('http://127.0.0.1:4321/', 1, 1500, 0, 0, 80 * KB));
const goodArt = [1, 2, 3].map(() => lhr('http://127.0.0.1:4321/art/', 1, 1450, 0, 0.02, 1100 * KB));
const k6Summary = (p95: number, failedRate = 0, checksRate = 1) => ({
  metrics: {
    http_req_failed: { value: failedRate, passes: 0, fails: 180, thresholds: { 'rate<0.01': failedRate >= 0.01 } },
    http_req_duration: { 'p(95)': p95, avg: 2, thresholds: { 'p(95)<100': p95 >= 100 } },
    checks: { value: checksRate, passes: 360, fails: 0, thresholds: { 'rate>0.99': checksRate <= 0.99 } },
  },
});

test.describe('The performance report shows each value next to its budget and names every failure', { tag: ['@req-376'] }, () => {
  const budgets = readBudgets(smallConfig);

  test('one row per page and metric, with the measured value and the budget side by side', () => {
    const rows = lighthouseRows(budgets, [...goodHome, ...goodArt]);
    expect(rows).toHaveLength(4);
    const lcp = rows.find((r: { metric: string }) => r.metric === 'Largest contentful paint')!;
    expect(lcp).toMatchObject({ page: '/', measured: '1500 ms', budget: 'at most 2000 ms', status: 'pass' });
    const weight = rows.find((r: { metric: string }) => r.metric === 'Total page weight')!;
    expect(weight).toMatchObject({ measured: '80.0 KB', budget: 'at most 125 KB', status: 'pass' });
    const score = rows.find((r: { metric: string }) => r.metric === 'Performance score')!;
    expect(score).toMatchObject({ measured: '100', budget: 'at least 95' });
    const k6 = k6Rows(k6Summary(3.3));
    expect(k6).toHaveLength(3);
    expect(k6.map((r: { measured: string; budget: string }) => [r.measured, r.budget])).toEqual([
      ['0.00%', 'under 1%'],
      ['3.30 ms', 'under 100 ms'],
      ['100.00%', 'over 99%'],
    ]);
  });

  test('uses the median of the runs, so one odd run does not decide', () => {
    const odd = [lhr('http://127.0.0.1:4321/', 1, 1500, 0, 0, 80 * KB), lhr('http://127.0.0.1:4321/', 1, 9000, 0, 0, 80 * KB), lhr('http://127.0.0.1:4321/', 1, 1600, 0, 0, 80 * KB)];
    const rows = lighthouseRows(budgets, [...odd, ...goodArt]);
    expect(rows.find((r: { metric: string }) => r.metric === 'Largest contentful paint')).toMatchObject({ measured: '1600 ms', status: 'pass' });
  });

  test('a value outside its budget fails, and the message names the page, metric, value, and limit', () => {
    const slow = [1, 2, 3].map(() => lhr('http://127.0.0.1:4321/', 0.8, 2600, 0, 0, 300 * KB));
    const rows = lighthouseRows(budgets, [...slow, ...goodArt]);
    const failed = rows.filter((r: { status: string }) => r.status === 'fail').map((r: { message: string }) => r.message);
    expect(failed).toContain('/ Largest contentful paint: 2600 ms is over the budget of 2000 ms');
    expect(failed).toContain('/ Total page weight: 300.0 KB is over the budget of 125 KB');
    expect(failed).toContain('/ Performance score: 80 is under the minimum of 95');
    expect(failed).toHaveLength(3);
    const k6 = k6Rows(k6Summary(312, 0.05));
    const k6Failed = k6.filter((r: { status: string }) => r.status === 'fail').map((r: { message: string }) => r.message);
    expect(k6Failed).toContain('k6 Response time (p(95)): 312.00 ms is not under 100 ms');
    expect(k6Failed).toContain('k6 Failed requests: 5.00% is not under 1%');
  });

  test('a value exactly on its limit passes', () => {
    const edge = [1, 2, 3].map(() => lhr('http://127.0.0.1:4321/', 0.95, 2000, 0, 0, 125 * KB));
    const rows = lighthouseRows(budgets, [...edge, ...goodArt]);
    expect(rows.every((r: { status: string }) => r.status === 'pass')).toBe(true);
  });

  test('a missing result is a failure, never a pass', () => {
    // No Lighthouse result for the Art page at all.
    const rows = lighthouseRows(budgets, goodHome);
    expect(rows.find((r: { page: string }) => r.page === '/art/')).toMatchObject({ status: 'fail', measured: 'no result' });
    expect(anyFailed(rows)).toBe(true);
    // k6 left no summary, or a summary with no thresholds.
    expect(k6Rows(undefined).every((r: { status: string }) => r.status === 'fail')).toBe(true);
    expect(k6Rows({ metrics: {} }).map((r: { measured: string }) => r.measured)).toEqual(['no result', 'no result', 'no result']);
    // Nothing measured at all.
    expect(anyFailed([])).toBe(true);
  });

  test('anyFailed is false only when every row passes', () => {
    expect(anyFailed([...lighthouseRows(budgets, [...goodHome, ...goodArt]), ...k6Rows(k6Summary(3))])).toBe(false);
    expect(anyFailed([...lighthouseRows(budgets, [...goodHome, ...goodArt]), ...k6Rows(k6Summary(150))])).toBe(true);
  });

  test('the Markdown has the table, a verdict, and a line for each failure', () => {
    const passing = toMarkdown([...lighthouseRows(budgets, [...goodHome, ...goodArt]), ...k6Rows(k6Summary(3))]);
    expect(passing).toContain('| Tool | Page | Metric | Measured | Budget | Result |');
    expect(passing).toContain('**Passed** - all 7 checks are inside their budgets.');
    expect(passing).not.toContain('What failed');
    const failing = toMarkdown([...lighthouseRows(budgets, [...goodHome, ...goodArt]), ...k6Rows(k6Summary(312))]);
    expect(failing).toContain('**FAILED** - 1 of 7 checks are outside their budgets.');
    expect(failing).toContain('### What failed');
    expect(failing).toContain('- k6 Response time (p(95)): 312.00 ms is not under 100 ms');
    expect(failing).toContain('| k6 | all pages | Response time (p(95)) | 312.00 ms | under 100 ms | **FAIL** |');
    expect(toMarkdown([])).toContain('**FAILED** - nothing was measured.');
  });

  test('the real config produces a row for every budgeted page and metric', () => {
    const real = readBudgets(config);
    expect(real.map((b: { page: string }) => b.page)).toEqual(['/', '/resume/qa/', '/art/']);
    for (const budget of real) expect(budget.limits).toHaveLength(5);
  });
});
