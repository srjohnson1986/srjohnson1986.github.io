import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { LIVE_COMMIT_PATH, decide, parseLiveCommit, shortCommit, waitForCommit } from '../scripts/lib/deploy-wait.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { buildMatrix, toHtml } from '../scripts/lib/traceability.mjs';

// After a deploy, the smoke test waits until the live site says it was built from the deployed commit,
// instead of pausing a fixed 30 seconds (scripts/wait-for-deploy.mjs, logic in scripts/lib/deploy-wait.mjs).
// These checks run the decision and the polling loop on made-up pages and a fake clock, run the real
// script against a local stand-in for the site, and read the workflow file to confirm it is wired to the
// script. No browser, and nothing here touches the live site.

const DEPLOYED = 'aeb1bf3c0ffee00000000000000000000000dead';
const SHORT = 'aeb1bf3';
const pageFor = (commit: string) => `<p><small>Generated 2026-11-12 03:19 UTC from commit ${commit}. Requirements are GitHub issues.</small></p>`;

/** A fake clock and a stand-in site that reports a different commit at each poll. */
function fakeSite(pages: Array<string | Error>, interval = 5_000) {
  let clock = 0;
  const slept: number[] = [];
  const log: string[] = [];
  let polls = 0;
  return {
    slept,
    log,
    run: (timeoutMs = 20_000) =>
      waitForCommit({
        sha: DEPLOYED,
        timeoutMs,
        intervalMs: interval,
        now: () => clock,
        sleep: async (ms: number) => {
          slept.push(ms);
          clock += ms;
        },
        fetchPage: async () => {
          // The last page repeats, like a site that stays on one version.
          const next = pages[Math.min(polls++, pages.length - 1)];
          if (next instanceof Error) throw next;
          return next;
        },
        log: (line: string) => log.push(line),
      }),
  };
}

test.describe('the wait reads the commit the site says it was built from', { tag: ['@req-349'] }, () => {
  test('a commit id is shortened to the 7 characters the page prints, and anything else is rejected', () => {
    expect(shortCommit(DEPLOYED)).toBe(SHORT);
    expect(shortCommit(` ${DEPLOYED.toUpperCase()}\n`)).toBe(SHORT);
    expect(shortCommit(SHORT)).toBe(SHORT);
    for (const bad of ['', 'abc', 'not-a-commit', 'zzzzzzzz', undefined, null]) expect(shortCommit(bad), String(bad)).toBeNull();
  });

  test('the commit is read from the real traceability page, so a change to its wording breaks this test', () => {
    const html = toHtml(buildMatrix([], []), { generated: '2026-11-12 03:19 UTC', commit: SHORT });
    expect(parseLiveCommit(html)).toBe(SHORT);
    // A deploy without GITHUB_SHA prints no commit, and so does the stand-in page in the repository.
    expect(parseLiveCommit(toHtml(buildMatrix([], []), { generated: '2026-11-12 03:19 UTC', commit: '' }))).toBeNull();
    const standIn = fs.readFileSync(path.join(root, 'src', 'pages', 'development-qa', 'this-site', 'traceability.astro'), 'utf8');
    expect(parseLiveCommit(standIn)).toBeNull();
  });

  test('other text, other commit-looking words, and an empty page give no commit', () => {
    expect(parseLiveCommit('')).toBeNull();
    expect(parseLiveCommit(undefined)).toBeNull();
    expect(parseLiveCommit('<p>from commit aeb1bf3 but nothing says it was generated</p>')).toBeNull();
    expect(parseLiveCommit(pageFor('not-hex'))).toBeNull();
    expect(parseLiveCommit(pageFor(DEPLOYED))).toBe(SHORT);
  });
});

test.describe('the decision to start, keep waiting, or give up', { tag: ['@req-349'] }, () => {
  const base = { expected: SHORT, timeoutMs: 180_000 };

  test('the matching commit is ready at once, even when the time is nearly up', () => {
    expect(decide({ ...base, live: SHORT, elapsedMs: 0 }).state).toBe('ready');
    expect(decide({ ...base, live: SHORT, elapsedMs: 179_999 }).state).toBe('ready');
  });

  test('a different commit, no commit, or an unreadable page keeps waiting until the limit', () => {
    expect(decide({ ...base, live: '1234567', elapsedMs: 10_000 })).toMatchObject({ state: 'waiting' });
    expect(decide({ ...base, live: null, elapsedMs: 10_000 })).toMatchObject({ state: 'waiting' });
    expect(decide({ ...base, live: null, elapsedMs: 10_000, problem: 'HTTP 503' })).toMatchObject({ state: 'waiting' });
    expect(decide({ ...base, live: '1234567', elapsedMs: 179_999 }).state).toBe('waiting');
  });

  test('at the limit it gives up and says which commit it wanted and which it saw', () => {
    const stale = decide({ ...base, live: '1234567', elapsedMs: 180_000 });
    expect(stale.state).toBe('timeout');
    expect(stale.message).toContain(SHORT);
    expect(stale.message).toContain('1234567');
    expect(stale.message).toContain('180 seconds');
    expect(decide({ ...base, live: null, elapsedMs: 180_000 }).message).toContain('reports no commit');
    expect(decide({ ...base, live: null, elapsedMs: 180_000, problem: 'HTTP 503' }).message).toContain('HTTP 503');
  });

  test('a deployed commit that is not a commit id fails at once instead of waiting for nothing', () => {
    expect(decide({ expected: null, live: SHORT, elapsedMs: 0, timeoutMs: 180_000 }).state).toBe('timeout');
  });
});

test.describe('the polling loop', { tag: ['@req-349'] }, () => {
  test('it starts at once when the site already reports the commit, with no pause', async () => {
    const site = fakeSite([pageFor(SHORT)]);
    const result = await site.run();
    expect(result).toMatchObject({ ok: true, polls: 1 });
    expect(site.slept).toEqual([]);
  });

  test('it keeps asking while the site shows the previous version, then starts when it switches', async () => {
    const site = fakeSite([pageFor('1234567'), pageFor('1234567'), pageFor(SHORT)]);
    const result = await site.run();
    expect(result).toMatchObject({ ok: true, polls: 3 });
    expect(site.slept).toEqual([5_000, 5_000]);
    expect(site.log.at(-1)).toContain(`reports commit ${SHORT}`);
  });

  test('a page that cannot be read for a while does not end the wait', async () => {
    const site = fakeSite([new Error('HTTP 503'), pageFor('<p>stand-in, no commit</p>'), pageFor(SHORT)]);
    expect(await site.run()).toMatchObject({ ok: true, polls: 3 });
  });

  test('if the site never reports the commit it fails at the limit, and does not pause after the last look', async () => {
    const site = fakeSite([pageFor('1234567')]);
    const result = await site.run(20_000);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(`never reported commit ${SHORT}`);
    expect(result.message).toContain('1234567');
    // Looks at 0, 5, 10, 15, and 20 seconds: five looks, four pauses.
    expect(result.polls).toBe(5);
    expect(site.slept).toEqual([5_000, 5_000, 5_000, 5_000]);
  });

  test('a site that is always down fails with the reason', async () => {
    const result = await fakeSite([new Error('HTTP 503')]).run(10_000);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP 503');
  });
});

/** Serves one page at the traceability address on a local port, and counts the requests. */
async function localSite(respond: () => { status: number; body: string }) {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    const { status, body } = respond();
    res.writeHead(status, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function runScript(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; out: string; err: string; ms: number }>((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['scripts/wait-for-deploy.mjs', ...args], { cwd: root, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (status) => resolve({ status, out, err, ms: Date.now() - started }));
  });
}

test.describe('the script, against a local stand-in for the site', { tag: ['@req-349'] }, () => {
  test('it exits 0 straight away when the site reports the deployed commit, and asks for the traceability page', async () => {
    const site = await localSite(() => ({ status: 200, body: pageFor(SHORT) }));
    try {
      const done = await runScript(['--commit', DEPLOYED, '--url', site.url]);
      expect(done.status, done.err).toBe(0);
      expect(site.requests).toEqual([LIVE_COMMIT_PATH]);
      expect(done.ms, 'no fixed pause before the checks').toBeLessThan(4_000);
    } finally {
      await site.close();
    }
  });

  test('it waits through a stale version and exits 0 when the site switches', async () => {
    let asked = 0;
    const site = await localSite(() => ({ status: 200, body: pageFor(++asked < 3 ? '1234567' : SHORT) }));
    try {
      const done = await runScript(['--commit', DEPLOYED, '--url', site.url, '--interval', '0.2', '--timeout', '30']);
      expect(done.status, done.err).toBe(0);
      expect(asked).toBe(3);
    } finally {
      await site.close();
    }
  });

  test('it exits 1 with a clear message naming both commits when the site never switches', async () => {
    const site = await localSite(() => ({ status: 200, body: pageFor('1234567') }));
    try {
      const done = await runScript(['--commit', DEPLOYED, '--url', site.url, '--interval', '0.2', '--timeout', '1']);
      expect(done.status).toBe(1);
      expect(done.err).toContain(`never reported commit ${SHORT}`);
      expect(done.err).toContain('it reports commit 1234567');
      // A GitHub Actions error annotation, so the reason shows on the run summary.
      expect(done.err).toContain('::error title=Deploy not live::');
    } finally {
      await site.close();
    }
  });

  test('it exits 1 when the page is gone, and says so', async () => {
    const site = await localSite(() => ({ status: 404, body: 'not found' }));
    try {
      const done = await runScript(['--commit', DEPLOYED, '--url', site.url, '--interval', '0.2', '--timeout', '1']);
      expect(done.status).toBe(1);
      expect(done.err).toContain('HTTP 404');
    } finally {
      await site.close();
    }
  });

  test('it takes the commit from DEPLOYED_SHA when --commit is not given, and fails when there is none', async () => {
    const site = await localSite(() => ({ status: 200, body: pageFor(SHORT) }));
    try {
      expect((await runScript(['--url', site.url], { DEPLOYED_SHA: DEPLOYED })).status).toBe(0);
      const none = await runScript(['--url', site.url], { DEPLOYED_SHA: '' });
      expect(none.status).toBe(1);
      expect(none.err).toContain('--commit');
    } finally {
      await site.close();
    }
  });
});

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, string> };
type Workflow = { on: Record<string, unknown>; jobs: { smoke: { steps: Step[]; 'timeout-minutes': number } } };
const smoke = yaml.load(fs.readFileSync(path.join(root, '.github', 'workflows', 'smoke.yml'), 'utf8')) as Workflow;

test.describe('the smoke workflow waits for the commit instead of sleeping', { tag: ['@req-349'] }, () => {
  const steps = smoke.jobs.smoke.steps;

  test('there is no fixed pause any more', () => {
    for (const step of steps) expect(step.run ?? '', step.name).not.toMatch(/\bsleep\b/);
  });

  test('the wait runs only after a deploy, after the setup and before the checks', () => {
    const wait = steps.findIndex((s) => (s.run ?? '').trim() === 'node scripts/wait-for-deploy.mjs');
    const checks = steps.findIndex((s) => s.run === 'npx playwright test');
    const chromium = steps.findIndex((s) => (s.run ?? '').startsWith('npx playwright install'));
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(chromium);
    expect(checks).toBeGreaterThan(wait);
    // Scheduled, manual, and pull request runs have no fresh deploy to wait for.
    expect(steps[wait].if).toBe("github.event_name == 'workflow_run'");
  });

  test('the deployed commit reaches the script as an environment variable, not pasted into the command', () => {
    const wait = steps.find((s) => (s.run ?? '').includes('wait-for-deploy'))!;
    expect(wait.env).toEqual({ DEPLOYED_SHA: '${{ github.event.workflow_run.head_sha }}' });
    expect(wait.run).not.toContain('${{');
  });

  test('the checks run against the same commit that is waited for, and the job still has a time limit', () => {
    const checkout = steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'))!;
    expect(checkout.with?.ref).toContain('github.event.workflow_run.head_sha');
    expect(smoke.jobs.smoke['timeout-minutes']).toBeGreaterThan(3);
  });
});
