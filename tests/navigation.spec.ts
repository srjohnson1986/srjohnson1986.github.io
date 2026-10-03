import { test, expect } from '@playwright/test';
import { nav, entryCards } from '../src/data/site';

const grouped = nav.filter((item) => item.group);
const groupName = grouped[0]?.group;

test.describe('navigation on a wide screen', () => {
  test('shows every link in one row and no Menu button', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(main.getByRole('link')).toHaveText(nav.map((item) => item.label));
    await expect(page.locator('summary', { hasText: 'Menu' })).toBeHidden();
  });

  for (const item of nav) {
    test(`"${item.label}" opens ${item.href} and is marked as the current page`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: item.label, exact: true }).click();
      // /resume/ redirects to the first version, so the destination may be inside the linked section.
      await expect(page).toHaveURL((url) => (item.href === '/' ? url.pathname === '/' : url.pathname.startsWith(item.href)));
      await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveText(item.label);
    });
  }

  test('Resume stays marked on the pages inside it', async ({ page }) => {
    await page.goto('/resume/consulting/');
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveText('Resume');
  });
});

test.describe('navigation on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('shows one Menu button instead of the row, on a single line', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('summary', { hasText: 'Menu' })).toBeVisible();
    await expect(page.locator('.nav-wide')).toBeHidden();
    const header = await page.locator('.site-header').boundingBox();
    expect(header!.height).toBeLessThan(80);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test('the menu opens and closes from the keyboard without moving the page', async ({ page }) => {
    await page.goto('/art/');
    const summary = page.locator('summary', { hasText: 'Menu' });
    const details = page.locator('.nav-menu');
    const heading = page.getByRole('heading', { level: 1 });
    const before = (await heading.boundingBox())!.y;

    await expect(details).not.toHaveAttribute('open', '');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    expect((await heading.boundingBox())!.y).toBe(before);

    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('the open menu lists every page, with the grouped pages under their group name', async ({ page }) => {
    test.skip(grouped.length === 0, 'no navigation items are grouped');
    await page.goto('/');
    await page.locator('summary', { hasText: 'Menu' }).click();
    const menu = page.getByRole('navigation', { name: 'Main' });

    await expect(menu.getByRole('link')).toHaveText(nav.map((item) => item.label));
    const group = menu.locator('li.group');
    await expect(group.locator('.group-label')).toHaveText(groupName!);
    await expect(group.getByRole('link')).toHaveText(grouped.map((item) => item.label));
  });

  test('choosing a page from the menu goes there and marks it current', async ({ page }) => {
    await page.goto('/');
    await page.locator('summary', { hasText: 'Menu' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audio', exact: true }).click();
    await expect(page).toHaveURL(/\/audio\/$/);

    await page.locator('summary', { hasText: 'Menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveText('Audio');
  });
});

test.describe('Home page entry cards', () => {
  for (const card of entryCards) {
    test(`"${card.title}" ${card.href ? `links to ${card.href}` : 'is not a link while its page is not built'}`, async ({ page }) => {
      await page.goto('/');
      const section = page.getByRole('region', { name: 'Explore' });
      if (card.href) {
        await expect(section.getByRole('link', { name: new RegExp(card.title) })).toHaveAttribute('href', card.href);
      } else {
        await expect(section.getByRole('link', { name: new RegExp(card.title) })).toHaveCount(0);
        await expect(section).toContainText('Coming soon');
      }
    });
  }
});
