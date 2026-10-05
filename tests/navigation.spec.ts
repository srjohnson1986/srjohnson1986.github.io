import { test, expect } from './helpers/test';
import { nav, site } from '../src/data/site';
import { intros, homeCards } from './helpers/data';

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
  test('the cards appear in the order set in src/data/home-cards.yaml, with their words', async ({ page }) => {
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Explore' });
    await expect(section.locator('h3')).toHaveText(homeCards.map((c) => c.title));
    for (const card of homeCards) await expect(section).toContainText(card.blurb);
  });


  for (const card of homeCards) {
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

test.describe('page introductions come from src/data/intros.yaml', () => {
  const words = (text: string) => text.replace(/\s+/g, ' ').trim();

  test('the Home page shows the tagline and paragraphs from the file, in order', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tagline')).toHaveText(words(intros.home.lead));
    const shown = await page.locator('.intro-text > p:not(.tagline):not(.actions)').allTextContents();
    expect(shown.map(words)).toEqual(intros.home.paragraphs.map(words));
  });

  test('the Art page shows the lead and the statement from the file, in order', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.locator('p.lead')).toHaveText(words(intros.art.lead));
    const shown = await page.locator('.statement > p').allTextContents();
    expect(shown.map(words)).toEqual(intros.art.paragraphs.map(words));
  });

  test('the Audio page shows its lead from the file', async ({ page }) => {
    await page.goto('/audio/');
    await expect(page.locator('p.lead')).toHaveText(words(intros.audio.lead));
  });

  test('the Contact page shows its email note and lead, with the area filled in from site.ts', async ({ page }) => {
    await page.goto('/contact/');
    const expected = `${intros.contact.email_note} ${intros.contact.lead.replace('{area}', site.area)}`;
    await expect(page.locator('p.lead')).toHaveText(words(expected));
    await expect(page.locator('p.lead')).not.toContainText('{area}');
  });

  test('the 404 page shows its heading, lead, button, and list heading from the file', async ({ page }) => {
    await page.goto('/this-page-does-not-exist/');
    const text = intros['not-found'];
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(words(text.heading!));
    await expect(page.locator('p.lead')).toHaveText(words(text.lead));
    await expect(page.getByRole('link', { name: words(text.button!) })).toHaveAttribute('href', '/');
    await expect(page.getByRole('heading', { level: 2, name: words(text.links_heading!) })).toBeVisible();
  });
});
