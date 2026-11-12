// Decides when the smoke test may start after a deploy. Used by scripts/wait-for-deploy.mjs; tested in
// tests/deploy-wait.spec.ts.
//
// The smoke test runs after the deploy workflow finishes, but the live site does not always switch to the
// new version at that instant, so a fixed pause could still test the previous version. Instead the site
// is asked which commit it was built from, and the checks start once it says the deployed one.
//
// Where the site says it: the requirements traceability page (/development-qa/this-site/traceability/)
// prints "Generated <time> from commit <first 7 characters>". The deploy writes that page last, from
// GITHUB_SHA, so it names exactly the commit that was published. (The page that is in the repository is a
// stand-in with no commit, so a deploy that skipped the report never matches, and the wait fails.)
//
// Nothing here touches the network or the clock: the caller passes in functions that do, so the tests
// can pass in made-up ones.

/** Where the live site says which commit it was built from. */
export const LIVE_COMMIT_PATH = '/development-qa/this-site/traceability/';
/** Characters of the commit the page prints (see scripts/traceability.mjs). */
export const SHORT_LENGTH = 7;
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_INTERVAL_MS = 5_000;

/** The first 7 characters of a commit id, lower case, or null when it is not a commit id. */
export function shortCommit(sha) {
  const text = String(sha ?? '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(text) ? text.slice(0, SHORT_LENGTH) : null;
}

/** The commit the traceability page says it was generated from, or null when it says none. */
export function parseLiveCommit(html) {
  const found = /Generated\s[^<]*?\sfrom commit ([0-9a-f]{7,40})\b/i.exec(String(html ?? ''));
  return found ? found[1].slice(0, SHORT_LENGTH).toLowerCase() : null;
}

/**
 * One step of the wait.
 * @param {object} input
 * @param {string | null} input.expected   short commit that was deployed
 * @param {string | null} input.live       short commit the live site reports now (null: none, or the page could not be read)
 * @param {number} input.elapsedMs
 * @param {number} input.timeoutMs
 * @param {string} [input.problem]         why the live site could not be read, if that is why live is null
 * @returns {{ state: 'ready' | 'waiting' | 'timeout', message: string }}
 */
export function decide({ expected, live, elapsedMs, timeoutMs, problem }) {
  if (!expected) return { state: 'timeout', message: 'the deployed commit is not a valid commit id, so there is nothing to wait for' };
  if (live === expected) return { state: 'ready', message: `the live site reports commit ${expected}` };
  const seen = live ? `it reports commit ${live}` : problem ? `it could not be read (${problem})` : 'it reports no commit';
  if (elapsedMs >= timeoutMs) {
    return { state: 'timeout', message: `the live site never reported commit ${expected} within ${Math.round(timeoutMs / 1000)} seconds; ${seen}` };
  }
  return { state: 'waiting', message: `waiting for commit ${expected}; ${seen}` };
}

/**
 * Polls until the live site reports the expected commit or the time runs out.
 * @param {object} input
 * @param {string} input.sha                 the deployed commit (full or short)
 * @param {() => Promise<string>} input.fetchPage   returns the page's HTML, or throws
 * @param {(ms: number) => Promise<void>} input.sleep
 * @param {() => number} input.now           milliseconds, any origin
 * @param {(line: string) => void} [input.log]
 * @returns {Promise<{ ok: boolean, message: string, polls: number }>}
 */
export async function waitForCommit({ sha, fetchPage, sleep, now, log = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS }) {
  const expected = shortCommit(sha);
  const started = now();
  let polls = 0;
  for (;;) {
    polls += 1;
    let live = null;
    let problem;
    try {
      live = parseLiveCommit(await fetchPage());
    } catch (error) {
      problem = error?.message ?? String(error);
    }
    const step = decide({ expected, live, elapsedMs: now() - started, timeoutMs, problem });
    log(step.message);
    if (step.state !== 'waiting') return { ok: step.state === 'ready', message: step.message, polls };
    await sleep(intervalMs);
  }
}
