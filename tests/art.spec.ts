import { test, expect } from './helpers/test';
import { artworks } from './helpers/data';

const withStory = artworks.filter((a) => a.story || a.more || a.caption);
const withoutStory = artworks.filter((a) => !a.story && !a.more && !a.caption);
const series = artworks.filter((a) => a.more);

test.describe('Art page', () => {
  test('shows every piece, and every image has real alt text', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.locator('.piece')).toHaveCount(artworks.length);

    const expectedImages = artworks.reduce((n, a) => n + 1 + (a.more?.length ?? 0), 0);
    const alts = await page.locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('alt') ?? ''));
    expect(alts).toHaveLength(expectedImages);
    const weak = alts.filter((alt) => alt.trim().length < 12);
    expect(weak, 'images with missing or very short alt text').toEqual([]);
  });

  test('pieces keep their own aspect ratio (no stretched or cropped images)', async ({ page }) => {
    await page.goto('/art/');
    const boxes = await page
      .locator('.piece > .zoom > img')
      .evaluateAll((imgs) => imgs.map((img) => ({ w: img.getAttribute('width'), h: img.getAttribute('height'), css: getComputedStyle(img).objectFit })));
    for (const box of boxes) {
      expect(Number(box.w)).toBeGreaterThan(0);
      expect(Number(box.h)).toBeGreaterThan(0);
      expect(box.css).not.toBe('cover');
    }
  });

  test('a piece with no story or extra images has no expand control', async ({ page }) => {
    test.skip(withoutStory.length === 0, 'every piece has a story or extra images');
    await page.goto('/art/');
    for (const art of withoutStory) {
      const piece = page.locator('.piece', { has: page.getByText(art.title, { exact: true }) });
      await expect(piece.locator('details')).toHaveCount(0);
    }
  });

  test('any tags on a piece are lowercase-kebab-case and not repeated', () => {
    const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const art of artworks) {
      for (const tag of art.tags ?? []) expect(tag, `${art.title}: "${tag}"`).toMatch(kebab);
      expect(new Set(art.tags ?? []).size, `${art.title} repeats a tag`).toBe((art.tags ?? []).length);
    }
  });

  test('the control says Read more, never "the story behind"', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.getByText(/story behind/i)).toHaveCount(0);
    const storyOnly = withStory.find((a) => (a.story || a.caption) && !a.more);
    if (storyOnly) {
      const piece = page.locator('.piece', { has: page.getByText(storyOnly.title, { exact: true }) });
      await expect(piece.locator('summary')).toHaveText('Read more');
    }
    // A piece with both text and extra images says so, when the data has one.
    const both = withStory.find((a) => (a.story || a.caption) && a.more);
    if (both) {
      const piece = page.locator('.piece', { has: page.getByText(both.title, { exact: true }) });
      await expect(piece.locator('summary')).toHaveText(`Read more and ${both.more!.length} more image${both.more!.length === 1 ? '' : 's'}`);
    }
  });

  test('each Signals Midwest and Friends with Jennafits flier is its own piece in the gallery', async ({ page }) => {
    await page.goto('/art/');
    const signals = ['Brooklyn', 'Philly (tweed)', 'Philly', 'Malden', 'Lancaster'].map((place) => `Signals Midwest tour alt flier: ${place}`);
    const jennafits = ['Friends with Jennafits', 'Friends with Jennafits: rabbit', 'Friends with Jennafits: blue'];
    for (const title of [...signals, ...jennafits]) {
      const piece = page.locator('.piece', { has: page.getByText(title, { exact: true }) });
      await expect(piece, title).toHaveCount(1);
      await expect(piece.locator('.more'), `${title} should not hide more images`).toHaveCount(0);
    }
    // The tour story sits with the top flier of the run, under Read more.
    const top = page.locator('.piece', { has: page.getByText(signals[0], { exact: true }) });
    await expect(top.locator('details')).toContainText('Signals Midwest');

    // The summer collage is just the collage: only its own caption is under Read more.
    const collage = page.locator('.piece', { has: page.getByText("A collage from my summer of '25", { exact: true }) });
    await expect(collage.locator('details')).not.toContainText('Signals Midwest');

    // Newest first within 2025: the run comes before the pieces from earlier in the year.
    const titles = await page.locator('.piece > figcaption > strong').allTextContents();
    expect(titles.indexOf(signals[0])).toBeLessThan(titles.indexOf("A collage from my summer of '25"));
    expect(titles.indexOf('Friends with Jennafits')).toBeGreaterThan(titles.indexOf("A collage from my summer of '25"));
  });

  test('the Grog Shop flyer is the newest piece, with its two social versions under Read more', async ({ page }) => {
    await page.goto('/art/');
    const first = page.locator('.piece').first();
    await expect(first.locator(':scope > figcaption strong')).toHaveText('Grog Shop, August 29');
    await expect(first.locator(':scope > figcaption .meta')).toContainText('2026.08.29');
    await expect(first.locator('summary')).toHaveText('Read more and 2 more images');
    await expect(first.locator('.more img')).toHaveCount(2); // in the page already, hidden until opened
    await expect(first.locator('.more')).toBeHidden();
    await first.locator('summary').click();
    await expect(first.locator('.more')).toBeVisible();
    await expect(first.locator('.more img')).toHaveCount(2);
  });

  test('the gallery runs newest first by date', async ({ page }) => {
    await page.goto('/art/');
    const titles = await page.locator('.piece > figcaption > strong').allTextContents();
    const shown = titles.map((title) => artworks.find((a) => a.title === title)!);
    expect(shown.every(Boolean), 'every title on the page is in the data').toBe(true);

    // Years never go up as you scroll down (a piece with no year comes last).
    const years = shown.map((a) => a.year ?? 0);
    expect(years, 'years').toEqual([...years].sort((a, b) => b - a));

    // Pieces with a full date (2026.02.13, or the start of a range) are newest first, even when
    // undated pieces sit between them.
    const full = shown.flatMap((a) => (a.date && /^\d{4}\.\d{2}\.\d{2}/.test(a.date) ? [a.date.slice(0, 10)] : []));
    expect(full.length).toBeGreaterThan(5);
    expect(full, 'dates').toEqual([...full].sort().reverse());

    // A piece with only a year, or a date that is not numeric, comes after the dated pieces of its year.
    for (const year of new Set(years)) {
      const group = shown.filter((a) => (a.year ?? 0) === year);
      const firstUndated = group.findIndex((a) => !a.date || !/^\d{4}\.\d{2}/.test(a.date));
      if (firstUndated === -1) continue;
      const datedAfter = group.slice(firstUndated).filter((a) => a.date && /^\d{4}\.\d{2}/.test(a.date));
      expect(datedAfter.map((a) => a.title), `${year}: dated pieces after an undated one`).toEqual([]);
    }
  });

  test('under an image there is only the title, date, and format; every caption is under Read more', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.locator('.piece > figcaption .caption')).toHaveCount(0);
    for (const art of artworks) {
      const piece = page.locator('.piece', { has: page.getByText(art.title, { exact: true }) });
      const under = piece.locator(':scope > figcaption');
      await expect(under.locator('strong')).toHaveText(art.title);
      const parts = await under.locator('> *').evaluateAll((els) => els.map((el) => el.tagName + '.' + el.className));
      expect(parts.every((p) => p === 'STRONG.' || p.startsWith('SPAN.meta')), `${art.title}: ${parts.join(', ')}`).toBe(true);
      if (art.caption) {
        await expect(piece.locator('details > p.caption')).toHaveText(art.caption.replace(/\s+/g, ' ').trim());
        await expect(piece.locator('summary')).toBeVisible();
      }
    }
  });

  test('with a single group there is no group heading, but the gallery is still a named region', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    await expect(page.getByText('Show flyers', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Show flyers' })).toHaveCount(1);
  });

  test('a piece with a story opens and closes from the keyboard', async ({ page }) => {
    const art = withStory.find((a) => a.story)!;
    await page.goto('/art/');
    const piece = page.locator('.piece', { has: page.getByText(art.title, { exact: true }) });
    const summary = piece.locator('summary');
    const details = piece.locator('details');

    await expect(details).not.toHaveAttribute('open', '');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    for (const paragraph of art.story!) await expect(piece).toContainText(paragraph);

    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('a series reveals its extra images inside the control', async ({ page }) => {
    test.skip(series.length === 0, 'no piece has extra images');
    await page.goto('/art/');
    for (const art of series) {
      const piece = page.locator('.piece', { has: page.getByText(art.title, { exact: true }) });
      const count = art.more!.length;
      await expect(piece.locator('summary')).toContainText(`${count} more image${count === 1 ? '' : 's'}`);

      await piece.locator('summary').click();
      await expect(piece.locator('.more img')).toHaveCount(count);
      for (const extra of art.more!) {
        await expect(piece.locator(`.more img[alt="${extra.alt.replace(/"/g, '\\"')}"]`)).toHaveCount(1);
        if (extra.caption) await expect(piece).toContainText(extra.caption);
      }
    }
  });
});

test.describe('Larger view of an image', () => {
  // The first piece with a series, for the extra-image case.
  const seriesPiece = (page: import('@playwright/test').Page) =>
    page.locator('.piece', { has: page.getByText(series[0].title, { exact: true }) });

  test('every image is a link to a larger version, which is served as an image', async ({ page, request }) => {
    await page.goto('/art/');
    const expected = artworks.reduce((n, a) => n + 1 + (a.more?.length ?? 0), 0);
    const links = page.locator('a[data-lightbox]');
    await expect(links).toHaveCount(expected);
    const hrefs = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(new Set(hrefs).size).toBe(expected); // each image has its own larger version
    for (const href of hrefs.slice(0, 4)) {
      const response = await request.get(href);
      expect(response.status(), href).toBe(200);
      expect(response.headers()['content-type'], href).toContain('image/');
    }
    // Every link has a name that says what it does.
    const names = await links.evaluateAll((as) => as.map((a) => a.getAttribute('aria-label') ?? ''));
    expect(names.filter((n) => !n.startsWith('View larger')), 'links without a clear name').toEqual([]);
  });

  test('nothing is added to the page until an image is clicked', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.locator('dialog')).toHaveCount(0);
  });

  test('clicking an image fills the page with a larger version, and the X closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('/art/');
    const link = page.locator('a[data-lightbox]').first();
    const thumb = link.locator('img');
    const alt = await thumb.getAttribute('alt');
    const thumbWidth = (await thumb.boundingBox())!.width;

    await link.click();
    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();
    const big = dialog.locator('img');
    await expect(big).toHaveAttribute('alt', alt!);
    await expect(big).toHaveJSProperty('src', await link.evaluate((a) => (a as HTMLAnchorElement).href));

    // It fills the window, the picture is much bigger than the thumbnail, and it is a real picture.
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(1000);
    expect(box.height).toBe(700);
    const shown = (await big.boundingBox())!;
    expect(shown.height).toBeGreaterThan(thumbWidth * 1.5);
    await expect.poll(() => big.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(640);

    const close = page.getByRole('button', { name: 'Close larger view' });
    await expect(close).toBeVisible();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(link).toBeFocused(); // back where the visitor was
  });

  test('Escape and a click on the dark area close it too', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('/art/');
    const link = page.locator('a[data-lightbox]').first();
    const dialog = page.locator('dialog.lightbox');

    await link.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await link.click();
    await expect(dialog).toBeVisible();
    // Wait for the picture to load, so its edges are known, then click the dark margin beside it.
    await expect.poll(() => dialog.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.mouse.click(5, 350);
    await expect(dialog).toBeHidden();
  });

  test('opens from the keyboard, and shows the right picture for each image', async ({ page }) => {
    await page.goto('/art/');
    // The second piece's image (an extra image inside a closed Read more is not reachable yet).
    const second = page.locator('.piece > a[data-lightbox]').nth(1);
    await second.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveJSProperty('src', await second.evaluate((a) => (a as HTMLAnchorElement).href));
    await expect(page.getByRole('button', { name: 'Close larger view' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(second).toBeFocused();
  });

  test('the extra images in a series open full page too', async ({ page }) => {
    test.skip(series.length === 0, 'no piece has extra images');
    await page.goto('/art/');
    const piece = seriesPiece(page);
    await piece.locator('summary').click();
    const extra = piece.locator('.more a[data-lightbox]').first();
    const alt = await extra.locator('img').getAttribute('alt');
    await extra.click();
    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveAttribute('alt', alt!);
    await expect(dialog.locator('img')).toHaveJSProperty('src', await extra.evaluate((a) => (a as HTMLAnchorElement).href));
  });

  test('with scripts off, an image is a plain link to the larger version', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/art/');
    const href = await page.locator('a[data-lightbox]').first().getAttribute('href');
    const response = await page.request.get(new URL(href!, page.url()).href);
    expect(response.status()).toBe(200);
    await expect(page.locator('dialog')).toHaveCount(0);
    await context.close();
  });
});

test.describe('Gallery alignment', () => {
  for (const [name, width] of [
    ['phone, small', 320],
    ['phone', 375],
    ['large phone', 430],
    ['two columns', 500],
    ['two columns, wide', 620],
    ['tablet', 700],
    ['tablet, wide', 780],
    ['laptop', 1100],
    ['desktop', 1600],
  ] as const) {
    test(`every flyer sits whole in the same frame (${name})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/art/');
      const frames = await page.locator('.piece > .zoom').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const card = el.closest('.piece')!.getBoundingClientRect();
          return { ratio: r.width / r.height, widthGap: Math.abs(card.width - r.width) - 2, fit: getComputedStyle(el.querySelector('img')!).objectFit };
        }),
      );
      expect(frames.length).toBeGreaterThan(0);
      for (const f of frames) {
        expect(f.ratio).toBeCloseTo(0.8, 2); // 4:5, the same for squares and posters
        expect(f.fit).toBe('contain'); // the whole flyer shows; nothing is cropped
      }
    });

    test(`cards in the same row end at the same place (${name})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/art/');
      const cards = await page.locator('.piece').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top + window.scrollY), bottom: r.bottom + window.scrollY, title: el.querySelector('strong')?.textContent ?? '' };
        }),
      );
      const rows = new Map<number, typeof cards>();
      for (const c of cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c]);
      for (const [top, row] of rows) {
        const bottoms = row.map((c) => c.bottom);
        const spread = Math.max(...bottoms) - Math.min(...bottoms);
        expect(spread, `row at ${top}: ${row.map((c) => c.title).join(' | ')}`).toBeLessThanOrEqual(2);
      }
      if (width >= 500) expect([...rows.values()].some((row) => row.length > 1)).toBe(true); // there are real rows to compare
    });
  }

  test('rows still line up when the text is wider, whatever the font', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/art/');
    // A much wider font makes titles wrap to more lines, as on a machine with different fonts.
    await page.addStyleTag({ content: 'body, body * { font-family: "DejaVu Sans Mono", monospace !important; font-size-adjust: none; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(200);
    const cards = await page.locator('.piece').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top + window.scrollY), bottom: r.bottom + window.scrollY };
      }),
    );
    const rows = new Map<number, number[]>();
    for (const c of cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c.bottom]);
    for (const [top, bottoms] of rows) {
      expect(Math.max(...bottoms) - Math.min(...bottoms), `row at ${top}`).toBeLessThanOrEqual(2);
    }
  });

  test('opening Read more still grows only that card', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto('/art/');
    const first = page.locator('.piece').first();
    const second = page.locator('.piece').nth(1);
    const before = { first: (await first.boundingBox())!.height, second: (await second.boundingBox())!.height };
    await first.locator('summary').click();
    expect((await first.boundingBox())!.height).toBeGreaterThan(before.first);
    expect((await second.boundingBox())!.height).toBeCloseTo(before.second, 0);
  });
});
