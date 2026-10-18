import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type APIResponse } from '@playwright/test';
import { root } from './helpers/data';
import {
  DEFAULT_REPO,
  NEVER_LOWER,
  checkNotLower,
  countFromList,
  endpoints,
  validate,
  // @ts-expect-error - plain JavaScript module with no type declarations
} from '../scripts/lib/site-stats.mjs';

// Contract checks against the REAL GitHub API, for the same six endpoints scripts/site-stats.mjs
// calls (it takes the paths from the same `endpoints()` function). These never run on a pull
// request: they use the live network and the rate limit. They run in the "API live" workflow, weekly
// and on demand, with `npm run test:api-live` (API_LIVE=1, see playwright.config.ts).
//
// Good API citizen: six calls in the whole run (the first test makes them, the rest read the saved
// answers), the repository token from GITHUB_TOKEN sent only as a header, never printed, and traces
// are off for this project so no request header is ever saved.

const eps = endpoints(DEFAULT_REPO) as Record<string, { path: string; contract: string }>;
const committed = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'site-stats.json'), 'utf8'));

type Saved = { status: number; headers: Record<string, string>; body: any; contract: string };
const answers: Record<string, Saved> = {};
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

async function save(name: string, response: APIResponse) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  answers[name] = { status: response.status(), headers: response.headers(), body, contract: eps[name].contract };
}

test.describe.serial('site-stats live: the GitHub endpoints the sync uses', { tag: ['@req-362'] }, () => {
  test('every endpoint answers 200 (six calls, made once for the whole run)', async ({ request }) => {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    for (const [name, ep] of Object.entries(eps)) {
      await save(name, await request.get(ep.path, { headers }));
    }
    for (const name of Object.keys(eps)) {
      expect(answers[name].status, `${name} (${eps[name].path}) answered ${answers[name].status}: ${JSON.stringify(answers[name].body).slice(0, 200)}`).toBe(200);
    }
  });

  test('every response matches its schema', () => {
    for (const name of Object.keys(eps)) {
      expect(() => validate(answers[name].contract, answers[name].body, `the live ${name} answer`), name).not.toThrow();
    }
  });

  test('the repository is the one we asked for, on the main branch', () => {
    expect(answers.repo.body.full_name.toLowerCase()).toBe(DEFAULT_REPO.toLowerCase());
    expect(answers.repo.body.default_branch).toBe('main');
  });

  test('the searches are complete', () => {
    for (const name of ['issues', 'pull_requests', 'pull_requests_merged']) {
      expect(answers[name].body.incomplete_results, name).toBe(false);
    }
  });

  test('counts are non-negative integers, and merged never exceeds total', () => {
    const counts = liveCounts();
    for (const [name, value] of Object.entries(counts)) {
      expect(Number.isInteger(value) && value >= 0, `${name} = ${value}`).toBe(true);
    }
    expect(counts.commits).toBeGreaterThan(0);
    expect(counts.pull_requests_merged).toBeLessThanOrEqual(counts.pull_requests);
  });

  test('counts are never lower than the committed values', () => {
    const counts = liveCounts();
    for (const key of NEVER_LOWER as string[]) {
      expect(counts[key], `${key}: live ${counts[key]}, committed ${committed[key]}`).toBeGreaterThanOrEqual(committed[key]);
    }
    expect(() => checkNotLower({ ...committed, ...counts }, committed)).not.toThrow();
  });

  test('the rate limit has room left', () => {
    for (const [name, a] of Object.entries(answers)) {
      const remaining = a.headers['x-ratelimit-remaining'];
      if (remaining !== undefined) expect(Number(remaining), `${name} rate limit remaining`).toBeGreaterThan(3);
    }
  });
});

function liveCounts(): Record<string, number> {
  return {
    issues: answers.issues.body.total_count,
    pull_requests: answers.pull_requests.body.total_count,
    pull_requests_merged: answers.pull_requests_merged.body.total_count,
    commits: countFromList({ headers: new Headers(answers.commits.headers), body: answers.commits.body }),
    releases: countFromList({ headers: new Headers(answers.releases.headers), body: answers.releases.body }),
  };
}
