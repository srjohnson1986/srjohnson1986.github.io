import { test, expect } from './helpers/test';
import { intros, nav, navPages } from './helpers/data';

// An address the site does not have must answer with a real 404 status and show the site's own
// page, with the navigation, instead of the host's generic error page.
for (const address of ['/this-page-does-not-exist/', '/resume/no-such-version/', '/missing.html']) {
  test(`an unknown address ${address} shows the friendly page with a 404 status`, { tag: ['@req-347'] }, async ({ page }) => {
    const response = await page.goto(address);
    expect(response!.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: intros['not-found'].heading! })).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
}

test('the friendly page links home and to every main section, and each link works', { tag: ['@req-347'] }, async ({ page, request }) => {
  await page.goto('/this-page-does-not-exist/');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: intros['not-found'].button! })).toHaveAttribute('href', '/');

  for (const item of navPages.filter((n) => n.href !== '/')) {
    const link = main.getByRole('link', { name: item.label, exact: true });
    await expect(link).toHaveAttribute('href', item.href);
    expect((await request.get(item.href)).status()).toBe(200);
  }
});

test('the page list groups each section\'s pages beneath it, the way the header does', { tag: ['@req-347'] }, async ({ page }) => {
  await page.goto('/this-page-does-not-exist/');
  const list = page.getByRole('main').locator('ul.sections');
  const sections = nav.filter((item) => item.href !== '/');

  // The top level is the sections (Home is left out; the button goes there).
  await expect(list.locator(':scope > li > a')).toHaveText(sections.map((item) => item.label));

  for (const section of sections) {
    const entry = list.locator(':scope > li').filter({ has: page.locator(`:scope > a[href="${section.href}"]`) });
    const nested = entry.locator(':scope > ul > li > a');
    if (section.children) {
      // Each page sits under its own section, in the same order as the header, with the right address.
      await expect(nested).toHaveText(section.children.map((child) => child.label));
      for (const [i, child] of section.children.entries()) await expect(nested.nth(i)).toHaveAttribute('href', child.href);
    } else {
      await expect(entry.locator(':scope > ul')).toHaveCount(0);
    }
  }
});
