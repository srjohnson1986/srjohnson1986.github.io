// Waits until the live site reports that it was built from the commit that was just deployed.
//
//   node scripts/wait-for-deploy.mjs --commit <sha> [--url <site>] [--timeout <seconds>] [--interval <seconds>]
//
// The smoke test workflow runs it after a deploy (instead of a fixed pause) so the checks never run
// against the previous version of the site. It exits 0 once the site reports the commit, and 1 with a
// clear message if it never does. The decision is in scripts/lib/deploy-wait.mjs; this file only asks
// the site and waits between tries.
//
// --url defaults to SMOKE_URL, then to the live site. The page is requested as a visitor would (no
// cache-busting), because that is the copy the checks will see.
import { setTimeout as pause } from 'node:timers/promises';
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS, LIVE_COMMIT_PATH, waitForCommit } from './lib/deploy-wait.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const site = (value('--url', process.env.SMOKE_URL ?? 'https://srjohnson1986.github.io') ?? '').replace(/\/$/, '');
const sha = value('--commit', process.env.DEPLOYED_SHA);
const seconds = (flag, fallback) => {
  const n = Number(value(flag));
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback;
};

if (!sha) {
  console.error('wait-for-deploy: give the deployed commit with --commit <sha> (or DEPLOYED_SHA).');
  process.exit(1);
}

const page = `${site}${LIVE_COMMIT_PATH}`;
console.log(`Waiting for ${page} to report commit ${sha.slice(0, 7)}.`);

const result = await waitForCommit({
  sha,
  timeoutMs: seconds('--timeout', DEFAULT_TIMEOUT_MS),
  intervalMs: seconds('--interval', DEFAULT_INTERVAL_MS),
  now: () => Date.now(),
  sleep: (ms) => pause(ms),
  log: (line) => console.log(line),
  fetchPage: async () => {
    const response = await fetch(page, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },
});

if (!result.ok) {
  console.error(`::error title=Deploy not live::${result.message}`);
  console.error(`wait-for-deploy: ${result.message}`);
}
// exitCode, not process.exit: on Windows, exiting right after fetch can trip a libuv assertion.
process.exitCode = result.ok ? 0 : 1;
