import { test, expect } from './helpers/test';
import { nav } from '../src/data/site';

// Headless Chromium hides scrollbars unless told otherwise. They are turned back on here, because the
// scrollbar is what makes a long page narrower than a short one on a real desktop. (This setting has
// to be at the top of the file, so these checks live in their own spec.)
test.use({ viewport: { width: 1100, height: 700 }, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

// The header must not move when the page changes. The current link is semibold, which is wider, and a
// page long enough to scroll has a scrollbar that makes the page narrower. Both used to shift things.
test.describe('the header does not move between pages', () => {
  const places = async (page: import('@playwright/test').Page) => {
    await page.evaluate(() => document.fonts.ready);
    return page.evaluate(() =>
      [...document.querySelectorAll('.site-header .brand, .site-header .nav-wide a, .site-header .theme-toggle')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${(el.textContent || 'theme').trim()}: x ${Math.round(box.left * 10) / 10}, width ${Math.round(box.width * 10) / 10}`;
      }),
    );
  };

  test('every page has the same link positions as Home', async ({ page }) => {
    await page.goto('/');
    const home = await places(page);
    for (const path of nav.map((item) => item.href).filter((href) => href !== '/' && href !== '/resume/').concat('/resume/qa/')) {
      await page.goto(path);
      expect(await places(page), path).toEqual(home);
    }
  });

  test('a short page and a long page line up (the scrollbar space is always kept)', async ({ page }) => {
    await page.goto('/contact/');
    const shortPage = await places(page);
    await page.goto('/development/');
    const longPage = await places(page);
    expect(longPage).toEqual(shortPage);
  });
});

// The header (name, links or Menu button, theme button) must stay on one line at every width, on
// every page. The current page's link is semibold and so a little wider, which once pushed the theme
// button onto a second line, so each page is checked on its own. 736px is just inside the wide row,
// and 735px is just inside the Menu button. Scrollbars are on (see the top of the file), as on a real desktop.
test.describe('the header stays on one line', () => {
  const widths = [1100, 900, 768, 736, 735, 600, 375];
  // /resume/ is a redirect to the first version, so the page itself is listed instead.
  const paths = [...nav.map((item) => item.href).filter((href) => href !== '/resume/'), '/resume/qa/', '/development/care-communication-board/'];

  for (const width of widths) {
    test(`on every page at ${width}px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        // One line is about 52px tall (the line plus its padding). A wrapped row is about 90px.
        const header = await page.locator('.site-header').boundingBox();
        expect(header!.height, `${path} at ${width}px`).toBeLessThan(70);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}px scrolls sideways`).toBe(false);
      }
    });
  }
});
