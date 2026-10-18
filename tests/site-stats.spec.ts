import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test, expect } from './helpers/test';
import { fakeFetch, recorded, startStub, REPO, type Answers } from './helpers/github-api';
import { root } from './helpers/data';
import {
  NEVER_LOWER,
  SiteStatsError,
  checkNotLower,
  collectApiCounts,
  lastPage,
  makeClient,
  parseTestTotal,
  readCommitted,
  validate,
  writeStats,
  // @ts-expect-error - plain JavaScript module with no type declarations
} from '../scripts/lib/site-stats.mjs';

// The API and contract checks around the project totals (issue #362). Everything here runs against
// recorded answers (tests/fixtures/github-api/good.json) or a local stand-in server, so it never
// uses the network and it runs on every pull request. The checks against the real GitHub API are in
// site-stats-live.spec.ts. No browser needed.

const committedFile = path.join(root, 'src', 'data', 'site-stats.json');
const committed = JSON.parse(fs.readFileSync(committedFile, 'utf8'));

async function collect(answers: Answers, token?: string) {
  return collectApiCounts(makeClient({ token, fetchImpl: fakeFetch(answers) }), REPO);
}

// Collects with one thing broken and returns the error message ('' if it did not fail).
async function failure(break_: (a: Answers) => void, token?: string) {
  const answers = recorded();
  break_(answers);
  try {
    await collect(answers, token);
    return '';
  } catch (error) {
    expect(error, 'a clear SiteStatsError, not a crash').toBeInstanceOf(SiteStatsError);
    return (error as Error).message;
  }
}

test.describe('site-stats: the contract', { tag: ['@req-362'] }, () => {
  test('every recorded answer matches its schema', () => {
    const answers = recorded();
    const contracts = { repo: 'repo', issues: 'search-issues', pull_requests: 'search-issues', pull_requests_merged: 'search-issues', commits: 'commits', releases: 'releases' } as const;
    for (const [name, contract] of Object.entries(contracts)) {
      expect(() => validate(contract, answers[name as keyof Answers].body), name).not.toThrow();
    }
  });

  test('the good answers give the expected totals', async () => {
    expect(await collect(recorded())).toEqual({ issues: 202, pull_requests: 160, pull_requests_merged: 157, commits: 329, releases: 0 });
  });

  test('extra fields and a new field order do not matter', async () => {
    const answers = recorded();
    (answers.issues.body as Record<string, unknown>).brand_new_field = { anything: true };
    (answers.repo.body as Record<string, unknown>).another = [1, 2, 3];
    expect((await collect(answers)).issues).toBe(202);
  });

  test('the committed data file matches its schema', () => {
    expect(() => validate('site-stats', committed)).not.toThrow();
    expect(() => readCommitted(committedFile)).not.toThrow();
    expect(committed.pull_requests_merged).toBeLessThanOrEqual(committed.pull_requests);
  });

  test('the data file schema rejects a missing field, a wrong type, a negative count, and an extra field', () => {
    const bad: Record<string, (d: Record<string, unknown>) => void> = {
      'a missing field': (d) => delete d.commits,
      'a count as a string': (d) => (d.issues = '202'),
      'a fractional count': (d) => (d.issues = 2.5),
      'a negative count': (d) => (d.pull_requests = -1),
      'a zero commit count': (d) => (d.commits = 0),
      'a badly formed date': (d) => (d.generated = '18 Oct 2026'),
      'an unknown field': (d) => (d.surprise = 1),
    };
    for (const [what, mutate] of Object.entries(bad)) {
      const data = structuredClone(committed);
      mutate(data);
      expect(() => validate('site-stats', data), what).toThrow(/site-stats\.schema\.json/);
    }
  });

  test('the page-count helper reads the last page of a Link header', () => {
    expect(lastPage('<https://x/y?per_page=1&page=2>; rel="next", <https://x/y?per_page=1&page=329>; rel="last"')).toBe(329);
    expect(lastPage(undefined)).toBeNull();
    expect(lastPage('<https://x/y?page=1>; rel="prev"')).toBeNull();
  });

  test('the test total is read from `playwright test --list`, and 0 is refused', () => {
    expect(parseTestTotal('Listing tests:\n...\nTotal: 624 tests in 29 files')).toEqual({ playwright_tests: 624, spec_files: 29 });
    expect(() => parseTestTotal('Total: 0 tests in 0 files')).toThrow(/Run `npm run build` first/);
    expect(() => parseTestTotal('nothing useful')).toThrow(/could not read the test total/);
  });
});

test.describe('site-stats: bad answers stop the collection', { tag: ['@req-362'] }, () => {
  test('a missing field names the field', async () => {
    expect(await failure((a) => delete (a.issues.body as Record<string, unknown>).total_count)).toMatch(/issues answer.*search-issues\.schema\.json.*total_count/);
    expect(await failure((a) => delete (a.repo.body as Record<string, unknown>).default_branch)).toMatch(/repo answer.*default_branch/);
    expect(await failure((a) => delete (a.commits.body as Record<string, unknown>[])[0].sha)).toMatch(/commits answer.*sha/);
  });

  test('a release without a tag name is rejected', async () => {
    expect(await failure((a) => (a.releases.body = [{ name: 'v1' }]))).toMatch(/releases answer.*tag_name/);
  });

  test('a wrong type is rejected', async () => {
    expect(await failure((a) => ((a.issues.body as Record<string, unknown>).total_count = '202'))).toMatch(/total_count must be integer/);
    expect(await failure((a) => ((a.pull_requests.body as Record<string, unknown>).total_count = 160.5))).toMatch(/total_count must be integer/);
    expect(await failure((a) => ((a.issues.body as Record<string, unknown>).incomplete_results = 'no'))).toMatch(/incomplete_results must be boolean/);
    expect(await failure((a) => (a.commits.body = { sha: 'x' }))).toMatch(/commits answer.*must be array/);
    expect(await failure((a) => (a.issues.body = []))).toMatch(/issues answer.*must be object/);
  });

  test('a negative count is rejected', async () => {
    expect(await failure((a) => ((a.issues.body as Record<string, unknown>).total_count = -3))).toMatch(/total_count must be >= 0/);
  });

  test('an empty commit list is rejected, but an empty release list is a valid zero', async () => {
    expect(await failure((a) => (a.commits.body = []))).toMatch(/commit list is empty/);
    expect((await collect(recorded())).releases).toBe(0);
  });

  test('an incomplete search is rejected', async () => {
    expect(await failure((a) => ((a.pull_requests.body as Record<string, unknown>).incomplete_results = true))).toMatch(/pull_requests search as incomplete/);
  });

  test('a page that is not JSON is rejected, not crashed on', async () => {
    expect(await failure((a) => (a.issues.raw = '<html>Bad gateway</html>'))).toMatch(/issues answer.*must be object|does not match/);
  });

  test('more merged pull requests than pull requests is rejected', async () => {
    expect(await failure((a) => ((a.pull_requests_merged.body as Record<string, unknown>).total_count = 999))).toMatch(/merged pull requests is more than/);
  });

  test('an answer about a different repository is rejected', async () => {
    expect(await failure((a) => ((a.repo.body as Record<string, unknown>).full_name = 'someone/else'))).toMatch(/asked for .* but GitHub returned someone\/else/);
  });

  test('a rate-limit answer is named as one, with the reset time', async () => {
    const limited = (a: Answers) => Object.assign(a.issues, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' }, body: { message: 'API rate limit exceeded' } });
    expect(await failure(limited)).toMatch(/rate limit reached while reading issues \(HTTP 403\)\. It resets at 2026-/);
    expect(await failure((a) => Object.assign(a.commits, { status: 429, body: { message: 'slow down' } }))).toMatch(/rate limit reached while reading commits \(HTTP 429\)/);
    // A 403 for another reason is not called a rate limit.
    const forbidden = await failure((a) => Object.assign(a.issues, { status: 403, headers: { 'x-ratelimit-remaining': '10' }, body: { message: 'Forbidden' } }));
    expect(forbidden).toMatch(/HTTP 403/);
    expect(forbidden).not.toMatch(/rate limit/);
  });

  test('a 404 names the endpoint and the repository check', async () => {
    expect(await failure((a) => Object.assign(a.repo, { status: 404, body: { message: 'Not Found' } }))).toMatch(/404 for repo .*Check the repository name/);
  });

  test('a rejected token and a server error are named with their status', async () => {
    expect(await failure((a) => Object.assign(a.repo, { status: 401, body: { message: 'Bad credentials' } }))).toMatch(/rejected the token.*401/);
    expect(await failure((a) => Object.assign(a.releases, { status: 502, body: {} }))).toMatch(/HTTP 502 for releases.*expected 200/);
  });

  test('a network failure is a clear error', async () => {
    const client = makeClient({ fetchImpl: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com')) });
    await expect(collectApiCounts(client, REPO)).rejects.toThrow(/could not reach GitHub.*ENOTFOUND/);
  });

  test('the error says nothing was written, and never contains the token', async () => {
    const message = await failure((a) => Object.assign(a.issues, { status: 500, body: {} }), 'ghs_SECRET_TOKEN_VALUE');
    expect(message).toMatch(/Nothing was written/);
    expect(message).not.toContain('ghs_SECRET_TOKEN_VALUE');
  });
});

test.describe('site-stats: be a good API citizen', { tag: ['@req-362'] }, () => {
  test('a run makes six calls, and asking twice reuses the answers', async () => {
    const seen: string[] = [];
    const client = makeClient({ fetchImpl: fakeFetch(recorded(), seen) });
    await collectApiCounts(client, REPO);
    await collectApiCounts(client, REPO);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    expect(client.calls()).toBe(6);
  });

  test('the token is sent as a bearer header and nowhere else', async () => {
    const seenHeaders: Record<string, string>[] = [];
    const urls: string[] = [];
    const inner = fakeFetch(recorded());
    const client = makeClient({
      token: 'ghs_SECRET_TOKEN_VALUE',
      fetchImpl: async (url: string, init: { headers: Record<string, string> }) => {
        urls.push(url);
        seenHeaders.push(init.headers);
        return inner(url);
      },
    });
    await collectApiCounts(client, REPO);
    expect(seenHeaders.every((h) => h.Authorization === 'Bearer ghs_SECRET_TOKEN_VALUE')).toBe(true);
    expect(urls.some((u) => u.includes('SECRET'))).toBe(false);
  });

  test('without a token no Authorization header is sent', async () => {
    let sent: Record<string, string> = {};
    const inner = fakeFetch(recorded());
    const client = makeClient({ fetchImpl: async (url: string, init: { headers: Record<string, string> }) => ((sent = init.headers), inner(url)) });
    await client.get('/repos/x/y');
    expect(sent.Authorization).toBeUndefined();
  });

  test('neither the script nor the library ever logs the token', () => {
    for (const file of ['scripts/site-stats.mjs', 'scripts/lib/site-stats.mjs']) {
      const lines = fs.readFileSync(path.join(root, file), 'utf8').split('\n');
      const leaks = lines.filter((l) => /console\.\w+\(.*token/i.test(l) && !/no GITHUB_TOKEN set/.test(l));
      expect(leaks, file).toEqual([]);
    }
  });
});

test.describe('site-stats: never lower than the committed values', { tag: ['@req-362'] }, () => {
  test('a count that drops is refused, naming the field', () => {
    for (const key of NEVER_LOWER as string[]) {
      const lower = { ...committed, [key]: committed[key] - 1 };
      if (committed[key] === 0) continue; // nothing is lower than zero
      expect(() => checkNotLower(lower, committed), key).toThrow(new RegExp(`${key} dropped from ${committed[key]} to ${committed[key] - 1}`));
    }
  });

  test('equal or higher counts pass, and so does a lower line count', () => {
    expect(() => checkNotLower(committed, committed)).not.toThrow();
    const higher = { ...committed, issues: committed.issues + 5, commits: committed.commits + 1 };
    expect(() => checkNotLower(higher, committed)).not.toThrow();
    expect(() => checkNotLower({ ...committed, lines_of_code: 1, playwright_tests: 1 }, committed)).not.toThrow();
    expect(() => checkNotLower(committed, null)).not.toThrow();
  });

  test('the committed file has sane numbers', () => {
    for (const key of [...(NEVER_LOWER as string[]), 'lines_of_code', 'playwright_tests', 'spec_files']) {
      expect(Number.isInteger(committed[key]) && committed[key] >= 0, key).toBe(true);
    }
  });
});

test.describe('site-stats: the command writes nothing on a bad answer', { tag: ['@req-362'] }, () => {
  let dir: string;
  let out: string;
  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-stats-'));
    out = path.join(dir, 'site-stats.json');
    fs.writeFileSync(out, `${JSON.stringify(committed, null, 2)}\n`);
  });
  test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Runs the real command against a local stand-in for the API. --no-tests skips Playwright.
  async function run(answers: Answers, extra: string[] = []) {
    const stub = await startStub(answers);
    try {
      const child = spawn(process.execPath, ['scripts/site-stats.mjs', '--no-tests', '--out', out, '--repo', REPO, ...extra], {
        cwd: root,
        env: { ...process.env, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'ghs_SECRET_TOKEN_VALUE' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      // Async on purpose: the stand-in server runs in this process, so a blocking spawn would deadlock.
      const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
      return { status, stdout, stderr, text: `${stdout}${stderr}` };
    } finally {
      await stub.close();
    }
  }
  const unchanged = () => expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual(committed);

  test('good answers with --write save a file that matches the schema', async () => {
    const answers = recorded();
    (answers.issues.body as Record<string, unknown>).total_count = committed.issues + 7;
    const result = await run(answers, ['--write']);
    expect(result.status, result.text).toBe(0);
    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(() => validate('site-stats', saved)).not.toThrow();
    expect(saved.issues).toBe(committed.issues + 7);
    expect(fs.existsSync(`${out}.tmp`)).toBe(false);
  });

  test('without --write nothing is saved', async () => {
    const answers = recorded();
    (answers.issues.body as Record<string, unknown>).total_count = committed.issues + 7;
    const result = await run(answers);
    expect(result.status, result.text).toBe(0);
    unchanged();
  });

  test('a 404 exits 1 with a clear line and leaves the file alone', async () => {
    const answers = recorded();
    Object.assign(answers.repo, { status: 404, body: { message: 'Not Found' } });
    const result = await run(answers, ['--write']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/site-stats: GitHub answered 404 for repo/);
    unchanged();
  });

  test('a rate limit exits 1 and leaves the file alone', async () => {
    const answers = recorded();
    Object.assign(answers.issues, { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'API rate limit exceeded' } });
    const result = await run(answers, ['--write']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/rate limit reached while reading issues/);
    unchanged();
  });

  test('a missing field, a wrong type, and an empty commit list each exit 1 and leave the file alone', async () => {
    const breaks: Array<[RegExp, (a: Answers) => void]> = [
      [/total_count/, (a) => delete (a.issues.body as Record<string, unknown>).total_count],
      [/total_count must be integer/, (a) => ((a.issues.body as Record<string, unknown>).total_count = 'many')],
      [/commit list is empty/, (a) => (a.commits.body = [])],
    ];
    for (const [expected, mutate] of breaks) {
      const answers = recorded();
      mutate(answers);
      const result = await run(answers, ['--write']);
      expect(result.status, result.text).toBe(1);
      expect(result.stderr).toMatch(expected);
      unchanged();
    }
  });

  test('a count lower than the committed value exits 1 and leaves the file alone', async () => {
    const answers = recorded();
    (answers.issues.body as Record<string, unknown>).total_count = committed.issues - 1;
    const result = await run(answers, ['--write']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(new RegExp(`issues dropped from ${committed.issues} to ${committed.issues - 1}`));
    unchanged();
  });

  test('the token never appears in the output, even on failure', async () => {
    const answers = recorded();
    Object.assign(answers.repo, { status: 500, body: {} });
    const result = await run(answers, ['--write', '--json']);
    expect(result.status).toBe(1);
    expect(result.text).not.toContain('ghs_SECRET_TOKEN_VALUE');
  });

  test('the writer itself refuses data that breaks the schema', () => {
    expect(() => writeStats(out, { ...committed, issues: 'many' })).toThrow(/site-stats\.schema\.json/);
    unchanged();
  });
});
