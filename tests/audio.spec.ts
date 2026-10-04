import { test, expect, type Page } from '@playwright/test';
import { releases, studio } from './helpers/data';

// Bandcamp is never contacted for real: any request to it is answered with a stub page, and the
// tests record whether a request was made at all.
async function stubBandcamp(page: Page) {
  const requested: string[] = [];
  await page.route('https://bandcamp.com/**', async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<p>stub player</p>' });
  });
  return requested;
}

const card = (page: Page, title: string) => page.locator('.release', { has: page.getByRole('heading', { name: title, exact: true }) });

test.describe('Audio players', () => {
  test('every release shows its own Bandcamp player, with no buttons to load it', async ({ page }) => {
    await stubBandcamp(page);
    await page.goto('/audio/');
    await expect(page.locator('iframe')).toHaveCount(releases.length);
    await expect(page.getByRole('button', { name: /player/i })).toHaveCount(0);
    for (const release of releases) {
      const frame = card(page, release.title).locator('iframe');
      await expect(frame).toHaveCount(1);
      await expect(frame).toHaveAttribute('src', release.embed);
      await expect(frame).toHaveAttribute('title', `Bandcamp player: ${release.title} by ${release.artist}`);
      expect(new URL(release.embed).hostname).toBe('bandcamp.com');
    }
  });

  test('players are marked lazy, so the browser loads them as the visitor scrolls', async ({ page }) => {
    await stubBandcamp(page);
    await page.goto('/audio/');
    await expect(page.locator('iframe[loading="lazy"]')).toHaveCount(releases.length);
  });

  test('every release links to its Bandcamp page', async ({ page }) => {
    await page.goto('/audio/');
    for (const release of releases) {
      const link = card(page, release.title).getByRole('link', { name: 'Listen on Bandcamp' });
      await expect(link).toHaveAttribute('href', release.bandcamp);
    }
  });

  test('with scripts off, each release still shows its player and its Bandcamp link', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('https://bandcamp.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }));
    await page.goto('/audio/');
    await expect(page.locator('iframe')).toHaveCount(releases.length);
    await expect(page.getByRole('link', { name: 'Listen on Bandcamp' })).toHaveCount(releases.length);
    await context.close();
  });

  test('the studio story is shown near the top, above the releases', async ({ page }) => {
    await page.goto('/audio/');
    const story = page.getByRole('region', { name: 'About the studio' });
    for (const paragraph of studio.story) await expect(story).toContainText(paragraph.replace(/\s+/g, ' ').trim());
    const storyBox = await story.boundingBox();
    const firstRelease = await page.locator('.release').first().boundingBox();
    expect(storyBox!.y).toBeLessThan(firstRelease!.y);
  });

  test('the studio rates section is linked from the top and reachable', async ({ page }) => {
    await page.goto('/audio/');
    await page.getByRole('link', { name: 'Rates and how to prepare' }).click();
    await expect(page).toHaveURL(/#studio$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Kingdom Hell rates' })).toBeInViewport();
    await expect(page.getByRole('link', { name: 'contact page' })).toHaveAttribute('href', '/contact/');
  });
});
