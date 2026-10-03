import { defineConfig, devices } from '@playwright/test';

// The suite runs against the built site, served by `astro preview`. Build first (`npm run build`),
// or use `npm test`, which builds and then runs the suite.
//
// Set BASE_URL to point the suite at an already running site instead, for example the deployed one.
const PORT = 4173;
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const usingLocalServer = !process.env.BASE_URL;

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
  projects: [{ name: 'site', use: { ...devices['Desktop Chrome'] } }],
  webServer: usingLocalServer
    ? {
        command: `npm run preview -- --host 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
});
