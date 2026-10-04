import { test, expect, type Page } from './helpers/test';
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

// The same address the site builds for the dark player: the dark card and accent colors.
const darkEmbed = (embed: string) => embed.replace(/\/bgcol=[0-9a-f]+/i, '/bgcol=1b1b20').replace(/\/linkcol=[0-9a-f]+/i, '/linkcol=e0a070');

test.describe('Audio players', () => {
  test('every release has a light and a dark Bandcamp player, and no button or Bandcamp link around them', async ({ page }) => {
    await stubBandcamp(page);
    await page.goto('/audio/');
    await expect(page.locator('iframe')).toHaveCount(releases.length * 2);
    await expect(page.getByRole('button', { name: /player/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Bandcamp/i })).toHaveCount(0);
    for (const release of releases) {
      const title = `Bandcamp player: ${release.title} by ${release.artist}`;
      const light = card(page, release.title).locator('iframe.embed-light');
      const dark = card(page, release.title).locator('iframe.embed-dark');
      await expect(light).toHaveAttribute('src', release.embed);
      await expect(dark).toHaveAttribute('src', darkEmbed(release.embed));
      await expect(light).toHaveAttribute('title', title);
      await expect(dark).toHaveAttribute('title', title);
      expect(new URL(release.embed).hostname).toBe('bandcamp.com');
    }
  });

  test('players are marked lazy, so the browser loads them as the visitor scrolls', async ({ page }) => {
    await stubBandcamp(page);
    await page.goto('/audio/');
    await expect(page.locator('iframe[loading="lazy"]')).toHaveCount(releases.length * 2);
  });

  test.describe('with a light page', () => {
    test.use({ colorScheme: 'light' });

    test('only the light players show, and the dark ones are never requested', async ({ page }) => {
      const requested = await stubBandcamp(page);
      await page.goto('/audio/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('iframe.embed-light:visible')).toHaveCount(releases.length);
      await expect(page.locator('iframe.embed-dark:visible')).toHaveCount(0);
      expect(requested.filter((url) => url.includes('bgcol=1b1b20'))).toEqual([]);
    });
  });

  test.describe('with a dark page', () => {
    test.use({ colorScheme: 'dark' });

    test('only the dark players show, and the light ones are never requested', async ({ page }) => {
      const requested = await stubBandcamp(page);
      await page.goto('/audio/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('iframe.embed-dark:visible')).toHaveCount(releases.length);
      await expect(page.locator('iframe.embed-light:visible')).toHaveCount(0);
      expect(requested.length).toBeGreaterThan(0);
      expect(requested.filter((url) => !url.includes('bgcol=1b1b20'))).toEqual([]);
    });

    test('the theme button switches the players, and the choice holds', async ({ page }) => {
      await stubBandcamp(page);
      await page.goto('/audio/');
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
      await expect(page.locator('iframe.embed-light:visible')).toHaveCount(releases.length);
      await expect(page.locator('iframe.embed-dark:visible')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('iframe.embed-light:visible')).toHaveCount(releases.length);
    });
  });

  test('with scripts off, each release still shows one player for the system theme', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
    const page = await context.newPage();
    await page.route('https://bandcamp.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>stub</p>' }));
    await page.goto('/audio/');
    await expect(page.locator('iframe:visible')).toHaveCount(releases.length);
    await expect(page.locator('iframe.embed-dark:visible')).toHaveCount(releases.length);
    await context.close();
  });

  test.describe('one player at a time', () => {
    test.use({ colorScheme: 'light' });

    // Each load of a stubbed player shows a new number, so a reloaded player can be told apart.
    async function numberedPlayers(page: Page) {
      let loads = 0;
      await page.route('https://bandcamp.com/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: `<button id="play">play</button><p id="n">${++loads}</p>` }),
      );
    }
    const shown = (page: Page, i: number) => page.locator('iframe.embed-light').nth(i);
    const number = async (page: Page, i: number) => (await shown(page, i).contentFrame().locator('#n').textContent()) ?? '';

    test('clicking into a second player resets the first, and leaves a player nobody touched alone', async ({ page }) => {
      await numberedPlayers(page);
      await page.goto('/audio/');
      const [a, b, c] = [await number(page, 0), await number(page, 1), await number(page, 2)];

      await shown(page, 0).contentFrame().locator('#play').click();
      expect(await number(page, 0)).toBe(a); // the first one on its own is not reset

      await shown(page, 1).contentFrame().locator('#play').click();
      await expect.poll(() => number(page, 0)).not.toBe(a); // the first was reset
      expect(await number(page, 1)).toBe(b); // the one just used is not
      expect(await number(page, 2)).toBe(c); // one nobody touched is not
    });

    test('clicking in the same player again does not reset it', async ({ page }) => {
      await numberedPlayers(page);
      await page.goto('/audio/');
      const a = await number(page, 0);
      await shown(page, 0).contentFrame().locator('#play').click();
      await shown(page, 0).contentFrame().locator('#play').click();
      await page.waitForTimeout(300);
      expect(await number(page, 0)).toBe(a);
    });

    test('switching theme after using a player removes the hidden copy, so it cannot keep playing', async ({ page }) => {
      await numberedPlayers(page);
      await page.goto('/audio/');
      // Remember the exact iframe elements of the first release, one used and one never touched.
      await page.evaluate(() => {
        const w = window as unknown as { __used: Element; __untouched: Element };
        w.__used = document.querySelectorAll('iframe.embed-light')[0];
        w.__untouched = document.querySelectorAll('iframe.embed-light')[1];
      });
      await shown(page, 0).contentFrame().locator('#play').click();
      await expect(shown(page, 0).contentFrame().locator('#n')).toHaveCount(1);

      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await expect(page.locator('iframe.embed-dark:visible').first()).toBeVisible();

      await expect
        .poll(() => page.evaluate(() => (window as unknown as { __used: Element }).__used.isConnected))
        .toBe(false); // the light player that was used is gone, so its sound stops
      expect(await page.evaluate(() => (window as unknown as { __untouched: Element }).__untouched.isConnected)).toBe(true);
      await expect(page.locator('iframe.embed-light')).toHaveCount(releases.length); // replaced by a copy, not lost
    });
  });

  test('each card shows its release type, and there is no Kind dropdown', async ({ page }) => {
    await page.goto('/audio/');
    const labels: Record<string, string> = { album: 'Album', ep: 'EP', single: 'Single', split: 'Split' };
    for (const release of releases) {
      await expect(card(page, release.title).locator('.meta')).toContainText(labels[release.type]);
    }
    await expect(page.locator('select[name="kind"]')).toHaveCount(0);
    await expect(page.getByLabel('Kind')).toHaveCount(0);
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
