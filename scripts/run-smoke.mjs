// Runs only the smoke checks, against the deployed site (or SMOKE_URL). A small script instead of
// an inline environment variable in package.json, so it works the same on Windows and Linux.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SMOKE_ONLY: '1' },
});
process.exit(result.status ?? 1);
