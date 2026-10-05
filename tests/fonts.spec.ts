import { test, expect } from './helpers/test';

// The site font, Atkinson Hyperlegible Next, is served from this site (bundled by the build). These
// checks make sure it really loads and that no font comes from a third party.
const pages = ['/', '/resume/qa/', '/development/'];

for (const path of pages) {
  test(`${path} loads the bundled Atkinson font and no outside fonts`, async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && !url.hostname.endsWith('bandcamp.com')) {
        outside.push(request.url());
      }
    });

    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);

    // The body and the headings both ask for Atkinson first.
    const families = await page.evaluate(() => [
      getComputedStyle(document.body).fontFamily,
      getComputedStyle(document.querySelector('h1')!).fontFamily,
    ]);
    for (const family of families) expect(family).toMatch(/^"?Atkinson Hyperlegible Next"?,/);

    // Asking for the font is not enough: the browser must have actually loaded the file for each
    // weight the site uses. (document.fonts.check() is no help here, because it says true for a
    // font that was never declared.)
    const loaded = await page.evaluate(() =>
      [...document.fonts]
        .filter((face) => face.family.replace(/"/g, '') === 'Atkinson Hyperlegible Next' && face.status === 'loaded')
        .map((face) => face.weight)
        .sort(),
    );
    expect(loaded).toEqual(['400', '600', '700']);

    expect(outside, 'requests to other hosts').toEqual([]);
  });
}
