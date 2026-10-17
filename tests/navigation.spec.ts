import { test, expect, type Page } from './helpers/test';
import { site } from '../src/data/site';
import { intros, homeCards, nav, navPages, projectsInArchiveOrder } from './helpers/data';

const topLevel = nav.map((item) => item.label);
// Items that have pages under them (Creative). On a wide screen their pages open in a list.
const sections = nav.filter((item) => item.children);

// The other navigation, header, and 404 checks take their expected pages from the site's own navigation data,
// so removing a page from it would remove the page from every expected list too. This is the one place
// the intended pages are written out. Add a page here when one is added to src/data/site.ts on purpose.
// (The pages under Development & QA come from the project files and are checked against them elsewhere.)
test('the navigation holds the pages the site is meant to have', { tag: ['@req-324'] }, () => {
  expect(nav.map((item) => [item.label, item.href])).toEqual([
    ['Home', '/'],
    ['Resume', '/resume/'],
    ['Development & QA', '/development-qa/'],
    ['Creative', '/creative/'],
    ['Contact', '/contact/'],
  ]);
  const creative = nav.find((item) => item.label === 'Creative')!;
  expect(creative.children!.map((item) => [item.label, item.href])).toEqual([
    ['Audio', '/audio/'],
    ['Art', '/art/'],
    ['Jabroni Fest', '/jabroni-fest/'],
  ]);
});

test.describe('navigation on a wide screen', { tag: ['@req-324'] }, () => {
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

  test.describe(`the "${section.label}" list on a wide screen`, { tag: ['@req-324'] }, () => {
    const main = (page: Page) => page.getByRole('navigation', { name: 'Main' });
    const link = (page: Page) => main(page).getByRole('link', { name: section.label, exact: true });
    // Each section has its own list, so the list is found through its section's link.
    const submenu = (page: Page) => page.locator('.has-menu', { has: page.getByRole('link', { name: section.label, exact: true }) }).locator('.submenu');

    test('is closed until the link is hovered, then lists its pages in order', async ({ page }) => {
      await page.goto('/');
      await expect(submenu(page)).toBeHidden();
      await link(page).hover();
      await expect(submenu(page).getByRole('link')).toHaveText(names);
    });

    test('stays open while the pointer moves down from the link onto an item', async ({ page }) => {
      await page.goto('/');
      await link(page).hover();
      const box = (await link(page).boundingBox())!;
      const first = submenu(page).getByRole('link').first();
      const target = (await first.boundingBox())!;
      // Slow steps, so a gap between the link and the list would close it on the way down.
      await page.mouse.move(box.x + box.width / 2, target.y + target.height / 2, { steps: 15 });
      await expect(first).toBeVisible();
    });

    test('opens from the keyboard, can be walked through with Tab, and closes with Escape', async ({ page }) => {
      await page.goto('/');
      await link(page).focus();
      await expect(submenu(page)).toBeVisible();
      for (const name of names) {
        await page.keyboard.press('Tab');
        await expect(submenu(page).getByRole('link', { name, exact: true })).toBeFocused();
      }
      await page.keyboard.press('Escape');
      await expect(submenu(page)).toBeHidden();
      await expect(link(page)).toBeFocused(); // focus is not lost when the list closes
    });

    test('Escape closes a list opened by the pointer, and it opens again when the pointer returns', async ({ page }) => {
      await page.goto('/');
      await link(page).hover();
      await expect(submenu(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(submenu(page)).toBeHidden();
      await page.mouse.move(5, 400);
      await link(page).hover();
      await expect(submenu(page)).toBeVisible();
    });

    test('is marked as the current section, not the current page, while one of its pages is open', async ({ page }) => {
      await page.goto(children[0].href);
      await expect(link(page)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.nav-wide > ul > li > a[aria-current="page"]')).toHaveCount(0);
      await link(page).hover();
      await expect(submenu(page).locator('[aria-current="page"]')).toHaveText(children[0].label);
    });

    test('only the list that is hovered is open', async ({ page }) => {
      await page.goto('/');
      await link(page).hover();
      await expect(submenu(page)).toBeVisible();
      await expect(page.locator('.submenu:visible')).toHaveCount(1);
    });

    test('has a page of its own that links to every page under it', async ({ page }) => {
      await page.goto('/');
      await link(page).click();
      await expect(page).toHaveURL((url) => url.pathname === section.href);
      await expect(main(page).locator('[aria-current="page"]')).toHaveText(section.label);
      // Found by address, since a card or heading may carry a longer name than the short one in the header.
      for (const child of children) {
        await expect(page.getByRole('main').locator(`a[href="${child.href}"]`).first()).toBeVisible();
      }
    });
  });
}

test.describe('the Development & QA list', { tag: ['@req-324'] }, () => {
  const development = nav.find((item) => item.href === '/development-qa/')!;

  test('has one entry per project, in the order the Development & QA page lists them, under their short names', async ({ page }) => {
    await page.goto('/development-qa/');
    const onPage = await page.locator('.project h2 a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(onPage).toEqual(projectsInArchiveOrder.map((p) => `/development-qa/${p.slug}/`)); // the order the tests assume is the real one
    expect(development.children!.map((c) => c.href)).toEqual(onPage);
    expect(development.children!.map((c) => c.label)).toEqual(projectsInArchiveOrder.map((p) => p.navTitle));

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Development & QA', exact: true }).hover();
    const shown = page.locator('.has-menu', { has: page.getByRole('link', { name: 'Development & QA', exact: true }) }).locator('.submenu a');
    await expect(shown).toHaveText(projectsInArchiveOrder.map((p) => p.navTitle));
    await expect(shown).toHaveCount(projectsInArchiveOrder.length);
  });

  test('on a project page, Development & QA is the current section and the project is the current page', async ({ page }) => {
    const project = projectsInArchiveOrder[0];
    await page.goto(`/development-qa/${project.slug}/`);
    const main = page.getByRole('navigation', { name: 'Main' });
    const link = main.getByRole('link', { name: 'Development & QA', exact: true });
    await expect(link).toHaveAttribute('aria-current', 'true');
    await link.hover();
    await expect(page.locator('.submenu [aria-current="page"]')).toHaveText(project.navTitle);
    // On the Development & QA page itself it is the current page.
    await page.goto('/development-qa/');
    await expect(main.getByRole('link', { name: 'Development & QA', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('navigation on a phone', { tag: ['@req-324'] }, () => {
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

  // Found in an exploratory session: Escape closed the lists on a wide screen but not the phone menu.
  test('Escape closes the open menu and puts focus back on the Menu button', async ({ page }) => {
    await page.goto('/art/');
    const summary = page.locator('summary', { hasText: 'Menu' });
    const details = page.locator('.nav-menu');

    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    // Focus is on a link inside the menu, as it is after tabbing in, so Escape has to rescue it.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(summary).toBeFocused();

    // With the menu already closed, Escape leaves it closed and does not move focus.
    await page.getByRole('link', { name: 'Skip to content' }).focus();
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
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

test.describe('Home page portrait and action links', { tag: ['@req-325'] }, () => {
  test('shows the portrait with its alt text and the picture really loads, or the placeholder', async ({ page }) => {
    await page.goto('/');
    const portrait = page.locator('.portrait');
    if (!site.photo) {
      // site.ts says to leave the photo undefined to show a placeholder.
      await expect(portrait.locator('img')).toHaveCount(0);
      await expect(portrait.locator('.portrait-placeholder')).toBeVisible();
      return;
    }
    const image = portrait.getByRole('img', { name: site.photo.alt, exact: true });
    await expect(image).toHaveAttribute('src', site.photo.src);
    // A picture that failed to load still has its alt text, so check the browser decoded it.
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), 'the portrait loaded').toBe(true);
  });

  test('offers "View my resume" and "Get in touch", pointing to the Resume and Contact pages', async ({ page }) => {
    await page.goto('/');
    const actions = page.locator('p.actions');
    await expect(actions.getByRole('link')).toHaveCount(2);
    await expect(actions.getByRole('link', { name: 'View my resume', exact: true })).toHaveAttribute('href', '/resume/');
    await expect(actions.getByRole('link', { name: 'Get in touch', exact: true })).toHaveAttribute('href', '/contact/');
  });
});

test.describe('Home page entry cards', { tag: ['@req-325'] }, () => {
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

test.describe('page introductions come from src/data/intros.yaml', { tag: ['@req-328'] }, () => {
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

test.describe('the Creative page', { tag: ['@req-326'] }, () => {
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

test.describe('Jabroni Fest, which used to be called Events', { tag: ['@req-327'] }, () => {
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

test.describe('Development & QA, which used to be called Development', { tag: ['@req-327'] }, () => {
  test('the page, the header, and a project page all use the new name', async ({ page }) => {
    await page.goto('/development-qa/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Development & QA');
    await expect(page).toHaveTitle(/^Development & QA \|/);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Development & QA', exact: true })).toHaveAttribute('href', '/development-qa/');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Development', exact: true })).toHaveCount(0);

    await page.goto(`/development-qa/${projectsInArchiveOrder[0].slug}/`);
    await expect(page).toHaveTitle(new RegExp(`\| Development & QA \| ${site.name}$`));
  });

  test('the Home card is called Development & QA and opens the new page', async ({ page }) => {
    await page.goto('/');
    const card = page.getByRole('region', { name: 'Explore' }).getByRole('link', { name: /Development & QA/ });
    await expect(card).toHaveAttribute('href', '/development-qa/');
    await expect(card.locator('h3')).toHaveText('Development & QA');
  });

  test('the old /development/ address and every old project address forward to the new one and stay out of search', async ({ page }) => {
    for (const slug of ['', ...projectsInArchiveOrder.map((p) => `${p.slug}/`)]) {
      await page.goto(`/development/${slug}`);
      await expect(page, `/development/${slug}`).toHaveURL(new URL(`/development-qa/${slug}`, page.url()).href);
      const html = await (await page.request.get(`/development/${slug}`)).text();
      expect(html).toContain(`url=/development-qa/${slug}`);
      expect(html).toContain('name="robots" content="noindex"');
    }
  });
});

// Found to be fine in an exploratory session, and written down so it stays that way. Both are about the
// Back button, which is easy to break without a visible error: a redirect or a filter that adds history
// entries makes Back feel stuck or take a visitor somewhere they did not expect.
test.describe('the Back button', { tag: ['@req-324'] }, () => {
  test('from the resume it returns to the page the visitor came from, not through the redirect again', async ({ page }) => {
    await page.goto('/');
    await page.locator('.nav-wide').getByRole('link', { name: 'Resume', exact: true }).click();
    // /resume/ forwards at once to the first version.
    await expect(page).toHaveURL(/\/resume\/[a-z-]+\/$/);
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === ''); // the home page itself, not just any path ending in a slash
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.name);
  });

  test('changing filters does not add history entries, so Back leaves the archive', async ({ page }) => {
    await page.goto('/');
    await page.locator('.nav-wide').getByRole('link', { name: 'Creative', exact: true }).hover();
    await page.locator('.nav-wide .submenu').getByRole('link', { name: 'Audio', exact: true }).click();
    await expect(page).toHaveURL(/\/audio\/$/);

    await page.locator('[data-filter-panel] > summary').click();
    await page.locator('select[name="year"]').selectOption({ index: 1 });
    await page.locator('label.tag-option').first().click();
    await expect(page).toHaveURL(/\?.*year=/);

    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/' && url.search === ''); // the home page itself, not just any path ending in a slash
  });
});
