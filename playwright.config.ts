import { defineConfig, devices } from '@playwright/test';

// Two ways to run the suite:
//
//   npm test              builds the site, serves it with `astro preview`, and runs every check in
//                         the "site" project against that local copy.
//   npm run test:smoke    runs only the short "smoke" checks against the deployed site. It never
//                         starts a local server. Set SMOKE_URL to check somewhere other than the
//                         live site.
//
// Set BASE_URL to run the "site" project against an already running copy instead of a local build.
const PORT = 4173;
const smokeOnly = Boolean(process.env.SMOKE_ONLY);
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const smokeURL = process.env.SMOKE_URL ?? 'https://srjohnson1986.github.io';
const usingLocalServer = !smokeOnly && !process.env.BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // Only one project is active per run, so the normal suite never touches the live site and the
  // smoke run never needs a build.
  projects: smokeOnly
    ? [
        {
          name: 'smoke',
          testMatch: /smoke\.spec\.ts/,
          // A fresh deployment can take a moment to reach everyone, so a check gets a few tries.
          retries: 2,
          use: { ...devices['Desktop Chrome'], baseURL: smokeURL },
        },
      ]
    : [{ name: 'site', testIgnore: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } }],
  webServer: usingLocalServer
    ? {
        command: `npm run preview -- --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
});
