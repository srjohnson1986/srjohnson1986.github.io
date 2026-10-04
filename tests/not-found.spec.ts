import { test, expect } from './helpers/test';
import { nav } from '../src/data/site';

// An address the site does not have must answer with a real 404 status and show the site's own
// page, with the navigation, instead of the host's generic error page.
for (const address of ['/this-page-does-not-exist/', '/resume/no-such-version/', '/missing.html']) {
  test(`an unknown address ${address} shows the friendly page with a 404 status`, async ({ page }) => {
    const response = await page.goto(address);
    expect(response!.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
}

test('the friendly page links home and to every main section, and each link works', async ({ page, request }) => {
  await page.goto('/this-page-does-not-exist/');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');

  for (const item of nav.filter((n) => n.href !== '/')) {
    const link = main.getByRole('link', { name: item.label, exact: true });
    await expect(link).toHaveAttribute('href', item.href);
    expect((await request.get(item.href)).status()).toBe(200);
  }
});
