// The logic behind scripts/site-stats.mjs: ask the GitHub API for the project totals, check every
// answer against a JSON Schema in contracts/, and build the data file. Kept apart from the command
// line so the tests can run it with a fake `fetch` and recorded answers (no network).
//
// Every problem throws a SiteStatsError with a plain message, and nothing here writes a file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

export class SiteStatsError extends Error {}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const contractsDir = path.join(root, 'contracts');
export const DEFAULT_REPO = 'srjohnson1986/srjohnson1986.github.io';
export const DEFAULT_API = 'https://api.github.com';

// The numbers that must never go down between runs. Lines of code and test counts are left out on
// purpose: deleting code or a test is a legitimate change.
export const NEVER_LOWER = ['issues', 'pull_requests', 'pull_requests_merged', 'commits', 'releases'];

const schemas = new Map();
const ajv = new Ajv({ allErrors: true, strict: false });
export function schema(name) {
  if (!schemas.has(name)) {
    schemas.set(name, JSON.parse(fs.readFileSync(path.join(contractsDir, `${name}.schema.json`), 'utf8')));
  }
  return schemas.get(name);
}

// Checks `data` against contracts/<name>.schema.json and says exactly which field is wrong.
export function validate(name, data, what = name) {
  const check = ajv.getSchema(schema(name).$id) ?? ajv.compile(schema(name));
  if (check(data)) return data;
  const problems = check.errors.map((e) => `${e.instancePath || '(top level)'} ${e.message}`).join('; ');
  throw new SiteStatsError(`${what} does not match its contract (${name}.schema.json): ${problems}`);
}

// The endpoints the sync calls: six calls in all. The `per_page=1` trick means a list endpoint
// returns one item plus a Link header whose last page number is the count.
export function endpoints(repo = DEFAULT_REPO) {
  const q = (extra) => `/search/issues?q=${encodeURIComponent(`repo:${repo} ${extra}`)}&per_page=1`;
  return {
    repo: { path: `/repos/${repo}`, contract: 'repo' },
    issues: { path: q('type:issue'), contract: 'search-issues' },
    pull_requests: { path: q('type:pr'), contract: 'search-issues' },
    pull_requests_merged: { path: q('type:pr is:merged'), contract: 'search-issues' },
    commits: { path: `/repos/${repo}/commits?per_page=1`, contract: 'commits' },
    releases: { path: `/repos/${repo}/releases?per_page=1`, contract: 'releases' },
  };
}

// A client that sends the token (never printed) and remembers each answer, so asking for the same
// path twice in one run costs one call.
export function makeClient({ token, baseUrl = DEFAULT_API, fetchImpl = globalThis.fetch } = {}) {
  const cache = new Map();
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'site-stats', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    calls: () => cache.size,
    async get(apiPath) {
      if (!cache.has(apiPath)) {
        cache.set(
          apiPath,
          (async () => {
            let res;
            try {
              res = await fetchImpl(`${baseUrl}${apiPath}`, { headers });
            } catch (error) {
              throw new SiteStatsError(`could not reach GitHub for ${apiPath}: ${error.message}`);
            }
            const text = await res.text();
            let body;
            try {
              body = JSON.parse(text);
            } catch {
              body = undefined;
            }
            return { status: res.status, headers: res.headers, body, apiPath };
          })(),
        );
      }
      return cache.get(apiPath);
    },
  };
}

// Turns a non-200 answer into a clear error. The rate limit is checked first because GitHub
// answers it with 403 or 429, which looks like a permissions problem otherwise.
export function checkStatus(res, name) {
  const remaining = res.headers?.get?.('x-ratelimit-remaining');
  if (res.status === 429 || (res.status === 403 && (remaining === '0' || /rate limit/i.test(res.body?.message ?? '')))) {
    const reset = res.headers?.get?.('x-ratelimit-reset');
    const when = reset ? ` It resets at ${new Date(Number(reset) * 1000).toISOString()}.` : '';
    throw new SiteStatsError(`GitHub rate limit reached while reading ${name} (HTTP ${res.status}).${when} Nothing was written.`);
  }
  if (res.status === 404) throw new SiteStatsError(`GitHub answered 404 for ${name} (${res.apiPath}). Check the repository name. Nothing was written.`);
  if (res.status === 401) throw new SiteStatsError(`GitHub rejected the token for ${name} (HTTP 401). Nothing was written.`);
  if (res.status !== 200) throw new SiteStatsError(`GitHub answered HTTP ${res.status} for ${name} (${res.apiPath}), expected 200. Nothing was written.`);
}

// "page=329" in the rel="last" link of a per_page=1 list is the number of items.
export function lastPage(link) {
  const last = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link ?? '');
  return last ? Number(last[1]) : null;
}

export function countFromList(res) {
  const fromLink = lastPage(res.headers?.get?.('link'));
  return fromLink ?? res.body.length;
}

// Reads all six endpoints, checks status and contract for each, and returns the API counts.
export async function collectApiCounts(client, repo = DEFAULT_REPO) {
  const eps = endpoints(repo);
  const answers = {};
  for (const [name, ep] of Object.entries(eps)) {
    const res = await client.get(ep.path);
    checkStatus(res, name);
    validate(ep.contract, res.body, `the ${name} answer`);
    answers[name] = res;
  }
  if (answers.repo.body.full_name.toLowerCase() !== repo.toLowerCase()) {
    throw new SiteStatsError(`asked for ${repo} but GitHub returned ${answers.repo.body.full_name}`);
  }
  for (const name of ['issues', 'pull_requests', 'pull_requests_merged']) {
    if (answers[name].body.incomplete_results) throw new SiteStatsError(`GitHub marked the ${name} search as incomplete, so its count cannot be trusted. Run again later.`);
  }
  if (answers.commits.body.length === 0) throw new SiteStatsError('the commit list is empty, so the commit count cannot be right. Nothing was written.');
  const counts = {
    issues: answers.issues.body.total_count,
    pull_requests: answers.pull_requests.body.total_count,
    pull_requests_merged: answers.pull_requests_merged.body.total_count,
    commits: countFromList(answers.commits),
    releases: countFromList(answers.releases),
  };
  if (counts.pull_requests_merged > counts.pull_requests) {
    throw new SiteStatsError(`${counts.pull_requests_merged} merged pull requests is more than the ${counts.pull_requests} pull requests in total, so a count is wrong. Nothing was written.`);
  }
  return counts;
}

const CODE_EXTENSIONS = new Set(['.ts', '.astro', '.mjs', '.css']);

// Lines in the code files under src, tests, and scripts.
export function countLines(base = root) {
  let lines = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CODE_EXTENSIONS.has(path.extname(entry.name))) lines += fs.readFileSync(full, 'utf8').split('\n').length - 1;
    }
  };
  for (const dir of ['src', 'tests', 'scripts']) if (fs.existsSync(path.join(base, dir))) walk(path.join(base, dir));
  return lines;
}

// Reads the last line of `playwright test --list`: "Total: 123 tests in 45 files".
export function parseTestTotal(output) {
  const m = /Total:\s*(\d+) tests? in (\d+) files?/.exec(output ?? '');
  if (!m) throw new SiteStatsError('could not read the test total from `playwright test --list`.');
  const [tests, files] = [Number(m[1]), Number(m[2])];
  if (tests === 0) throw new SiteStatsError('`playwright test --list` found 0 tests. Run `npm run build` first: the test files read dist/.');
  return { playwright_tests: tests, spec_files: files };
}

export function buildStats({ api, local, repo = DEFAULT_REPO, date }) {
  return { generated: date, repo, ...api, ...local };
}

// The never-lower rule: a count that drops below the committed value means the API gave a wrong
// or partial answer (or something was deleted), so a person should look before it is saved.
export function checkNotLower(next, committed) {
  if (!committed) return;
  for (const key of NEVER_LOWER) {
    if (typeof committed[key] === 'number' && next[key] < committed[key]) {
      throw new SiteStatsError(`${key} dropped from ${committed[key]} to ${next[key]}. Counts must not go down, so nothing was written. Check the repository, then edit src/data/site-stats.json by hand if the drop is real.`);
    }
  }
}

// Validates, then writes through a temporary file so a failed write cannot leave half a file.
export function writeStats(file, stats) {
  validate('site-stats', stats, 'the site-stats data');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(stats, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function readCommitted(file) {
  if (!fs.existsSync(file)) return null;
  return validate('site-stats', JSON.parse(fs.readFileSync(file, 'utf8')), 'the committed site-stats.json');
}
