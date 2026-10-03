import { test, expect, type Page } from '@playwright/test';
import { releases } from './helpers/data';

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
  test('opening the page makes no request to Bandcamp and adds no player', async ({ page }) => {
    const requested = await stubBandcamp(page);
    await page.goto('/audio/');
    await page.waitForLoadState('networkidle');
    expect(requested).toEqual([]);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Load player for / })).toHaveCount(releases.length);
  });

  test('every release links to its Bandcamp page', async ({ page }) => {
    await page.goto('/audio/');
    for (const release of releases) {
      const link = card(page, release.title).getByRole('link', { name: 'Listen on Bandcamp' });
      await expect(link).toHaveAttribute('href', release.bandcamp);
    }
  });

  test('Load player loads that one release from a Bandcamp address', async ({ page }) => {
    const requested = await stubBandcamp(page);
    await page.goto('/audio/');
    const release = releases[0];

    await page.getByRole('button', { name: `Load player for ${release.title} by ${release.artist}` }).click();

    const frame = card(page, release.title).locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src', release.embed);
    await expect(frame).toHaveAttribute('title', `Bandcamp player: ${release.title} by ${release.artist}`);
    expect(new URL(release.embed).hostname).toBe('bandcamp.com');
    await expect.poll(() => requested).toEqual([release.embed]);

    // Nothing else loaded, and the plain link is still there.
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(card(page, release.title).getByRole('button', { name: /^Load player for / })).toHaveCount(0);
    await expect(card(page, release.title).getByRole('link', { name: 'Listen on Bandcamp' })).toBeVisible();
  });

  test('Load player works from the keyboard', async ({ page }) => {
    await stubBandcamp(page);
    await page.goto('/audio/');
    const release = releases[releases.length - 1];

    await page.getByRole('button', { name: `Load player for ${release.title} by ${release.artist}` }).focus();
    await page.keyboard.press('Enter');
    await expect(card(page, release.title).locator('iframe')).toHaveAttribute('src', release.embed);
  });

  test('with scripts off, each release still has its Bandcamp link and no button', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/audio/');
    await expect(page.getByRole('link', { name: 'Listen on Bandcamp' })).toHaveCount(releases.length);
    await expect(page.getByRole('button', { name: /^Load player for / })).toHaveCount(0);
    await context.close();
  });

  test('the studio rates section is linked from the top and reachable', async ({ page }) => {
    await page.goto('/audio/');
    await page.getByRole('link', { name: 'Rates and how to prepare' }).click();
    await expect(page).toHaveURL(/#studio$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Kingdom Hell rates' })).toBeInViewport();
    await expect(page.getByRole('link', { name: 'contact page' })).toHaveAttribute('href', '/contact/');
  });
});
