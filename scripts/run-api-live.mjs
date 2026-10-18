// Runs only the live GitHub API contract checks (tests/site-stats-live.spec.ts). A small script
// instead of an inline environment variable in package.json, so it works the same on Windows and
// Linux. GITHUB_TOKEN (or GH_TOKEN) is used if set and never printed.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, API_LIVE: '1' },
});
process.exit(result.status ?? 1);
