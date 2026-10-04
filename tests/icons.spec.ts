import { test, expect } from './helpers/test';
import { builtPages } from './helpers/data';

// Every public page names the same three icons: the SVG favicon (which follows the browser's light
// or dark theme), a 32 px ICO fallback, and a 180 px Apple touch icon.
const pages = builtPages().filter((p) => !p.startsWith('/resume/print/') && p !== '/resume/');

for (const url of pages) {
  test(`${url} links the site icons`, async ({ page }) => {
    await page.goto(url);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');
  });
}

test('each icon file exists and is the right kind and size', async ({ page, request }) => {
  const svg = await request.get('/favicon.svg');
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('svg');
  expect(await svg.text()).toContain('prefers-color-scheme: dark');

  // The ICO is read byte by byte: headless Chromium does not load /favicon.ico as an image. It must
  // be a real ICO container (not a renamed PNG) holding one 32 px image.
  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  const bytes = await ico.body();
  expect([bytes.readUInt16LE(0), bytes.readUInt16LE(2), bytes.readUInt16LE(4)], 'ICO header: reserved, type, count').toEqual([0, 1, 1]);
  expect([bytes[6], bytes[7]], 'ICO image size').toEqual([32, 32]);
  expect(bytes.subarray(bytes.readUInt32LE(18), bytes.readUInt32LE(18) + 4).toString('hex'), 'image data is a PNG').toBe('89504e47');

  const apple = await request.get('/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
  expect(apple.headers()['content-type']).toContain('image/png');
  await page.goto('/apple-touch-icon.png');
  const natural = await page.evaluate(() => {
    const img = document.querySelector('img')!;
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  expect(natural).toEqual({ w: 180, h: 180 });
});
