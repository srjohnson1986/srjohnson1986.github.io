import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { builtPages, dist, redirectPages } from './helpers/data';

// The site font, Atkinson Hyperlegible Next, is served from this site (bundled by the build). These
// checks make sure it really loads and that no font comes from a third party.
const pages = ['/', '/resume/qa/', '/development-qa/'];

for (const path of pages) {
  test(`${path} loads the bundled Atkinson font and no outside fonts`, { tag: ['@req-344'] }, async ({ page }) => {
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

// Without a preload the browser only finds the font files after the stylesheet has loaded, draws the
// text in a fallback font, and the page jumps when Atkinson swaps in (a layout shift of 0.12 on the Resume
// page, measured by Lighthouse on a Linux runner). These checks read the built HTML, so they need no browser.
test.describe('Every page preloads the three bundled fonts', { tag: ['@req-382'] }, () => {
  const weights = ['400', '600', '700'];
  const pagesWithLayout = builtPages().filter((page) => !redirectPages.includes(page));

  test('there are pages to check', () => {
    expect(pagesWithLayout.length).toBeGreaterThan(10);
  });

  for (const page of pagesWithLayout) {
    test(`${page} preloads the 400, 600, and 700 files, from this site, with crossorigin`, () => {
      const html = fs.readFileSync(path.join(dist, page, 'index.html'), 'utf8');
      const preloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)].map((m) => m[0]);
      const fonts = preloads.filter((tag) => /as="font"/.test(tag));
      expect(fonts, 'font preloads').toHaveLength(3);
      for (const tag of fonts) {
        expect(tag).toContain('type="font/woff2"');
        // Fonts are always fetched in anonymous CORS mode, so a preload without crossorigin is fetched twice.
        expect(tag).toMatch(/crossorigin(="anonymous")?/);
        const href = /href="([^"]+)"/.exec(tag)![1];
        expect(href, 'a path on this site, not another host').toMatch(/^\/_astro\//);
        expect(fs.existsSync(path.join(dist, href)), `${href} exists in the build`).toBe(true);
      }
      for (const weight of weights) {
        expect(fonts.filter((tag) => tag.includes(`latin-${weight}-normal`)), `weight ${weight}`).toHaveLength(1);
      }
    });
  }

  test('the fallback is Arial (or Liberation Sans, its Linux stand-in), not system-ui, so the swap barely moves anything', () => {
    // Atkinson is about as wide as Arial and much narrower than the system-ui font on Linux. Drawing the text in a
    // wider fallback and then swapping made the Resume page jump by a layout shift of 0.1 on a Linux runner.
    const css = fs.readFileSync(path.join(dist, '..', 'src', 'styles', 'global.css'), 'utf8');
    const stack = /--font-body:\s*([^;]+);/.exec(css)![1].split(',').map((name) => name.trim().replace(/^['"]|['"]$/g, ''));
    expect(stack[0]).toBe('Atkinson Hyperlegible Next');
    expect(stack.indexOf('Arial'), 'Arial is in the stack').toBeGreaterThan(0);
    expect(stack.indexOf('Liberation Sans'), 'Liberation Sans is in the stack').toBeGreaterThan(0);
    expect(stack.indexOf('Arial')).toBeLessThan(stack.indexOf('system-ui'));
    expect(stack.indexOf('Liberation Sans')).toBeLessThan(stack.indexOf('system-ui'));
    expect(stack[stack.length - 1]).toBe('sans-serif');
  });

  test('each preload is the same file the stylesheet uses, so nothing is fetched twice', () => {
    const css = fs
      .readdirSync(path.join(dist, '_astro'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(dist, '_astro', f), 'utf8'))
      .join('\n');
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    for (const [, href] of html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)) {
      expect(css, href).toContain(`url(${href})`);
    }
  });
});
