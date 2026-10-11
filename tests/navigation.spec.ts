import { test, expect, type Page } from './helpers/test';
import { nav, navPages, site } from '../src/data/site';
import { intros, homeCards } from './helpers/data';

const topLevel = nav.map((item) => item.label);
// Items that have pages under them (Creative). On a wide screen their pages open in a list.
const sections = nav.filter((item) => item.children);

test.describe('navigation on a wide screen', () => {
  test('shows one row of top-level links and no Menu button, with the pages under Creative tucked away', async ({ page }) => {
    await page.goto('/');
    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(main.getByRole('link')).toHaveText(topLevel);
    await expect(page.locator('summary', { hasText: 'Menu' })).toBeHidden();
  });

  for (const item of navPages) {
    const parent = sections.find((section) => section.children!.includes(item));
    test(`"${item.label}" opens ${item.href} and is marked as the current page`, async ({ page }) => {
      await page.goto('/');
      const main = page.getByRole('navigation', { name: 'Main' });
      // A page under a section is reached through the section's list, which opens on hover.
      if (parent) await main.getByRole('link', { name: parent.label, exact: true }).hover();
      await main.getByRole('link', { name: item.label, exact: true }).click();
      // /resume/ redirects to the first version, so the destination may be inside the linked section.
      await expect(page).toHaveURL((url) => (item.href === '/' ? url.pathname === '/' : url.pathname.startsWith(item.href)));
      await expect(main.locator('[aria-current="page"]')).toHaveText(item.label);
    });
  }

  test('Resume stays marked on the pages inside it', async ({ page }) => {
    await page.goto('/resume/consulting/');
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveText('Resume');
  });
});

// The list under each section (Creative) on a wide screen.
for (const section of sections) {
  const children = section.children!;
  const names = children.map((child) => child.label);

  test.describe(`the "${section.label}" list on a wide screen`, () => {
    const main = (page: Page) => page.getByRole('navigation', { name: 'Main' });
    const link = (page: Page) => main(page).getByRole('link', { name: section.label, exact: true });

    test('is closed until the link is hovered, then lists its pages in order', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.submenu')).toBeHidden();
      await link(page).hover();
      await expect(page.locator('.submenu').getByRole('link')).toHaveText(names);
    });

    test('stays open while the pointer moves down from the link onto an item', async ({ page }) => {
      await page.goto('/');
      await link(page).hover();
      const box = (await link(page).boundingBox())!;
      const first = page.locator('.submenu').getByRole('link').first();
      const target = (await first.boundingBox())!;
      // Slow steps, so a gap between the link and the list would close it on the way down.
      await page.mouse.move(box.x + box.width / 2, target.y + target.height / 2, { steps: 15 });
      await expect(first).toBeVisible();
    });

    test('opens from the keyboard, can be walked through with Tab, and closes with Escape', async ({ page }) => {
      await page.goto('/');
      await link(page).focus();
      await expect(page.locator('.submenu')).toBeVisible();
      for (const name of names) {
        await page.keyboard.press('Tab');
        await expect(page.locator('.submenu').getByRole('link', { name, exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('.submenu')).toBeHidden();
      await expect(link(page)).toBeFocused(); // focus is not lost when the list closes
    });

    test('Escape closes a list opened by the pointer, and it opens again when the pointer returns', async ({ page }) => {
      await page.goto('/');
      await link(page).hover();
      await expect(page.locator('.submenu')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.submenu')).toBeHidden();
      await page.mouse.move(5, 400);
      await link(page).hover();
      await expect(page.locator('.submenu')).toBeVisible();
    });

    test('is marked as the current section, not the current page, while one of its pages is open', async ({ page }) => {
      await page.goto(children[0].href);
      await expect(link(page)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.nav-wide > ul > li > a[aria-current="page"]')).toHaveCount(0);
      await link(page).hover();
      await expect(page.locator('.submenu [aria-current="page"]')).toHaveText(children[0].label);
    });

    test('has a page of its own that links to every page under it', async ({ page }) => {
      await page.goto('/');
      await link(page).click();
      await expect(page).toHaveURL((url) => url.pathname === section.href);
      await expect(main(page).locator('[aria-current="page"]')).toHaveText(section.label);
      for (const child of children) {
        await expect(page.getByRole('main').getByRole('link', { name: new RegExp(child.label) })).toHaveAttribute('href', child.href);
      }
    });
  });
}

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

  test('the open menu lists every page, with the pages under a section listed beneath its link', async ({ page }) => {
    await page.goto('/');
    await page.locator('summary', { hasText: 'Menu' }).click();
    const menu = page.getByRole('navigation', { name: 'Main' });

    await expect(menu.getByRole('link')).toHaveText(navPages.map((item) => item.label));
    for (const section of sections) {
      const group = menu.locator('li.group', { has: page.getByRole('link', { name: section.label, exact: true }) });
      await expect(group.locator(':scope > a')).toHaveAttribute('href', section.href);
      await expect(group.locator('ul a')).toHaveText(section.children!.map((child) => child.label));
    }
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

test.describe('the Creative page', () => {
  const words = (text: string) => text.replace(/\s+/g, ' ').trim();
  const section = nav.find((item) => item.href === '/creative/')!;

  test('shows its lead and paragraphs from src/data/intros.yaml, in order', async ({ page }) => {
    await page.goto('/creative/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Creative');
    await expect(page.locator('p.lead')).toHaveText(words(intros.creative.lead));
    const shown = await page.locator('.statement > p').allTextContents();
    expect(shown.map(words)).toEqual(intros.creative.paragraphs!.map(words));
  });

  test('has one card for each page under Creative, in the navigation order, with the words from the file', async ({ page }) => {
    await page.goto('/creative/');
    const cards = page.getByRole('main').locator('a.card');
    // The same pages, in the same order, as the header list: the two cannot drift apart.
    expect(intros.creative.cards!.map((card) => card.href)).toEqual(section.children!.map((child) => child.href));
    await expect(cards).toHaveCount(intros.creative.cards!.length);
    for (const [index, card] of intros.creative.cards!.entries()) {
      await expect(cards.nth(index)).toHaveAttribute('href', card.href);
      await expect(cards.nth(index).locator('h3')).toHaveText(card.title);
      await expect(cards.nth(index)).toContainText(card.blurb);
    }
  });

  test('a card opens its page', async ({ page }) => {
    await page.goto('/creative/');
    await page.getByRole('main').getByRole('link', { name: /Jabroni Fest/ }).click();
    await expect(page).toHaveURL(/\/jabroni-fest\/$/);
  });
});

test.describe('Jabroni Fest, which used to be called Events', () => {
  test('the page is called Jabroni Fest in its heading and title', async ({ page }) => {
    await page.goto('/jabroni-fest/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jabroni Fest');
    await expect(page).toHaveTitle(/^Jabroni Fest \|/);
    await expect(page.getByRole('main')).not.toContainText(/\bEvents\b/);
  });

  test('the old /events/ address forwards to the new page and is kept out of search', async ({ page }) => {
    await page.goto('/events/');
    await expect(page).toHaveURL(/\/jabroni-fest\/$/);
    const forward = await page.request.get('/events/');
    const html = await forward.text();
    expect(html).toContain('url=/jabroni-fest/');
    expect(html).toContain('name="robots" content="noindex"');
  });

  test('no navigation link is still called Events', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Events' })).toHaveCount(0);
  });
});
