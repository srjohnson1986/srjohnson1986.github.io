import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { builtPages, dist } from './helpers/data';
import { site } from '../src/data/site';

// Link previews (LinkedIn, GitHub, Instagram and others) read Open Graph tags. Twitter or X tags
// are deliberately not used.
const SITE = site.url;
const isPrint = (p: string) => p.startsWith('/resume/print/');
const publicPages = builtPages().filter((p) => !isPrint(p) && p !== '/resume/');

test.describe('link previews', () => {
  for (const url of publicPages) {
    test(`${url} has Open Graph tags that match the page`, async ({ page }) => {
      await page.goto(url);
      const og = (name: string) => page.locator(`meta[property="og:${name}"]`);
      const title = await page.title();

      await expect(og('title')).toHaveAttribute('content', title);
      await expect(og('type')).toHaveAttribute('content', 'website');
      await expect(og('site_name')).toHaveAttribute('content', site.name);
      await expect(og('url')).toHaveAttribute('content', `${SITE}${url}`);
      await expect(og('url')).toHaveAttribute('content', (await page.locator('link[rel="canonical"]').getAttribute('href'))!);

      const description = await page.locator('meta[name="description"]').getAttribute('content');
      if (description) await expect(og('description')).toHaveAttribute('content', description);

      await expect(og('image')).toHaveAttribute('content', `${SITE}/images/social-preview.jpg`);
      await expect(og('image:width')).toHaveAttribute('content', '1200');
      await expect(og('image:height')).toHaveAttribute('content', '630');
      expect(await og('image:alt').getAttribute('content')).toBeTruthy();

      // No Twitter or X metadata.
      await expect(page.locator('meta[name^="twitter:"]')).toHaveCount(0);
    });
  }

  test('the preview image exists, is 1200 by 630, and is served as an image', async ({ page, request }) => {
    const response = await request.get('/images/social-preview.jpg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/');
    await page.goto('/images/social-preview.jpg');
    const size = await page.evaluate(() => {
      const img = document.querySelector('img')!;
      return { w: img.naturalWidth, h: img.naturalHeight };
    });
    expect(size).toEqual({ w: 1200, h: 630 });
  });
});

test.describe('sitemap and robots.txt', () => {
  const read = (file: string) => fs.readFileSync(path.join(dist, file), 'utf8');
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  test('robots.txt allows crawling and points to the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain(`Sitemap: ${SITE}/sitemap-index.xml`);
  });

  test('the sitemap index points to a sitemap that exists', () => {
    const files = locs(read('sitemap-index.xml')).map((u) => u.replace(SITE, ''));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.existsSync(path.join(dist, f)), `${f} should exist`).toBe(true);
  });

  test('the sitemap lists every public page and none of the print routes, the 404 page, or the redirect', () => {
    const listed = locs(read('sitemap-0.xml')).map((u) => u.replace(SITE, ''));
    expect(listed.sort()).toEqual([...publicPages].sort());
    expect(listed.filter((u) => isPrint(u) || u.includes('404') || u === '/resume/')).toEqual([]);
  });
});
