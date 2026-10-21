import { test, expect } from '@playwright/test';
import { shownResumes, releases, projects, navPages } from './helpers/data';

// Short checks that the real, public site is alive and serving what it should. They run against
// the deployed site (see playwright.config.ts) and deliberately do few things, quickly.

const mainPages = ['/', '/resume/qa/', '/development-qa/', '/audio/', '/art/', '/creative/', '/jabroni-fest/', '/contact/'];

test('the home page is served with its title and heading', { tag: ['@req-349'] }, async ({ page, baseURL }) => {
  const response = await page.goto('/');
  expect(response!.status()).toBe(200);
  await expect(page).toHaveTitle(/Steve Johnson/);
  await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
});

test('a plain http address is sent on to https', { tag: ['@req-349'] }, async ({ request, baseURL }) => {
  // Asks for the http:// address and does not follow the redirect, so it sees the redirect itself.
  // (Checking the address after loading an https page would always pass, whatever the server does.)
  test.skip(!baseURL!.startsWith('https://'), 'only meaningful when the site under test is served over https');
  const response = await request.get(`${baseURL!.replace(/^https:/, 'http:')}/`, { maxRedirects: 0 });
  expect([301, 302, 307, 308], `status of the http address was ${response.status()}`).toContain(response.status());
  expect(response.headers()['location'], 'where the http address redirects to').toMatch(/^https:\/\//);
});

test('every navigation link responds', { tag: ['@req-349'] }, async ({ request }) => {
  const problems: string[] = [];
  for (const item of navPages) {
    const response = await request.get(item.href);
    if (response.status() !== 200) problems.push(`${item.href} returned ${response.status()}`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('each resume version and its PDF are served', { tag: ['@req-349'] }, async ({ page, request }) => {
  for (const version of shownResumes) {
    await page.goto(`/resume/${version.route}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Professional Experience' })).toBeVisible();

    const pdf = await request.get(`/resume/${version.pdf}`);
    expect(pdf.status(), `${version.route} PDF`).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
});

test('the project archive lists the projects and a project page loads', { tag: ['@req-349'] }, async ({ page }) => {
  await page.goto('/development-qa/');
  await expect(page.locator('[data-item]')).toHaveCount(projects.length);
  await page.getByRole('link', { name: projects[0].title }).click();
  await expect(page.getByRole('heading', { level: 1, name: projects[0].title })).toBeVisible();
  for (const section of ['Problem', 'What I built', 'Stack', 'Outcome', 'Links']) {
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
  }
});

test('the audio page lists the releases, each with one visible Bandcamp player', { tag: ['@req-349'] }, async ({ page }) => {
  await page.goto('/audio/');
  await expect(page.locator('.release')).toHaveCount(releases.length);
  // Each release has a light and a dark copy; CSS shows the one that matches the theme.
  await expect(page.locator('iframe:visible')).toHaveCount(releases.length);
  await expect(page.locator('iframe[src^="https://bandcamp.com/EmbeddedPlayer/"]')).toHaveCount(releases.length * 2);
});

test('the art page serves its images', { tag: ['@req-349'] }, async ({ page, request }) => {
  await page.goto('/art/');
  const sources = await page.locator('.piece > .zoom > img').evaluateAll((imgs) => imgs.slice(0, 3).map((img) => (img as HTMLImageElement).src));
  expect(sources.length).toBeGreaterThan(0);
  for (const src of sources) {
    const response = await request.get(src);
    expect(response.status(), src).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\//);
  }
});

test('the contact page offers email, LinkedIn, and GitHub', { tag: ['@req-349'] }, async ({ page }) => {
  await page.goto('/contact/');
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /linkedin\.com\/in\// })).toBeVisible();
  await expect(page.getByRole('link', { name: /github\.com\// })).toBeVisible();
});

test('the main pages have no console errors or failed requests', { tag: ['@req-349'] }, async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // The Audio page embeds real Bandcamp players. What those pages log, and the connections they keep
  // open, are Bandcamp's business, so only this site's own errors and requests are judged here.
  const ours = (url: string) => url.startsWith(origin);
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && ours(message.location().url || page.url())) {
      problems.push(`console error on ${page.url()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`script error on ${page.url()}: ${error}`));
  page.on('requestfailed', (request) => {
    if (ours(request.url())) problems.push(`request failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (ours(response.url()) && response.status() >= 400) problems.push(`${response.status()} for ${response.url()}`);
  });

  for (const path of mainPages) {
    // 'load', not 'networkidle': the players on the Audio page keep the network busy.
    await page.goto(path, { waitUntil: 'load' });
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

// The deploy replaces a stand-in page with the real matrix (see .github/workflows/deploy.yml). The
// stand-in has no table, so this fails if the deploy skipped that step.
test('the requirements traceability report is published with a row per requirement', { tag: ['@req-349', '@req-355'] }, async ({ page }) => {
  const response = await page.goto('/development-qa/this-site/traceability/');
  expect(response!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Requirements traceability matrix' })).toBeVisible();
  expect(await page.locator('tbody tr').count(), 'requirement rows').toBeGreaterThan(30);
  await expect(page.locator('.problems'), 'the report lists no problems').toHaveCount(0);
});

test('an unknown address returns a real 404', { tag: ['@req-349'] }, async ({ request }) => {
  const response = await request.get('/this-page-does-not-exist/');
  expect(response.status()).toBe(404);
});
