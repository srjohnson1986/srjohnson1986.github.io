import { test, expect } from '@playwright/test';
import { variants, releases, projects } from './helpers/data';
import { nav } from '../src/data/site';

// Short checks that the real, public site is alive and serving what it should. They run against
// the deployed site (see playwright.config.ts) and deliberately do few things, quickly.

const mainPages = ['/', '/resume/qa/', '/development/', '/audio/', '/art/', '/events/', '/contact/'];

test('the home page is served with its title and heading', async ({ page, baseURL }) => {
  const response = await page.goto('/');
  expect(response!.status()).toBe(200);
  if (baseURL!.startsWith('https://')) expect(page.url()).toMatch(/^https:/);
  await expect(page).toHaveTitle(/Steve Johnson/);
  await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
});

test('every navigation link responds', async ({ request }) => {
  const problems: string[] = [];
  for (const item of nav) {
    const response = await request.get(item.href);
    if (response.status() !== 200) problems.push(`${item.href} returned ${response.status()}`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('each resume version and its PDF are served', async ({ page, request }) => {
  for (const variant of variants) {
    await page.goto(`/resume/${variant.id}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Experience' })).toBeVisible();

    const pdf = await request.get(`/resume/steve-johnson-resume-${variant.id}.pdf`);
    expect(pdf.status(), `${variant.id} PDF`).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
});

test('the project archive lists the projects and a project page loads', async ({ page }) => {
  await page.goto('/development/');
  await expect(page.locator('[data-item]')).toHaveCount(projects.length);
  await page.getByRole('link', { name: projects[0].title }).click();
  await expect(page.getByRole('heading', { level: 1, name: projects[0].title })).toBeVisible();
  for (const section of ['Problem', 'What I built', 'Stack', 'Outcome', 'Links']) {
    await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
  }
});

test('the audio page lists the releases, each with one visible Bandcamp player', async ({ page }) => {
  await page.goto('/audio/');
  await expect(page.locator('.release')).toHaveCount(releases.length);
  // Each release has a light and a dark copy; CSS shows the one that matches the theme.
  await expect(page.locator('iframe:visible')).toHaveCount(releases.length);
  await expect(page.locator('iframe[src^="https://bandcamp.com/EmbeddedPlayer/"]')).toHaveCount(releases.length * 2);
});

test('the art page serves its images', async ({ page, request }) => {
  await page.goto('/art/');
  const sources = await page.locator('.piece > img').evaluateAll((imgs) => imgs.slice(0, 3).map((img) => (img as HTMLImageElement).src));
  expect(sources.length).toBeGreaterThan(0);
  for (const src of sources) {
    const response = await request.get(src);
    expect(response.status(), src).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\//);
  }
});

test('the contact page offers email, LinkedIn, and GitHub', async ({ page }) => {
  await page.goto('/contact/');
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /linkedin\.com\/in\// })).toBeVisible();
  await expect(page.getByRole('link', { name: /github\.com\// })).toBeVisible();
});

test('the main pages have no console errors or failed requests', async ({ page, baseURL }) => {
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

test('an unknown address returns a real 404', async ({ request }) => {
  const response = await request.get('/this-page-does-not-exist/');
  expect(response.status()).toBe(404);
});
