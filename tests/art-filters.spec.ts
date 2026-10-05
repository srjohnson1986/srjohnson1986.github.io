import { test, expect, type Page } from './helpers/test';
import { artworks, intros } from './helpers/data';

// The Art page uses the same Filters panel as Audio and Development (those are tested in
// filters.spec.ts), plus a sort order. Everything is checked against the real art data.

const ART = '/art/';
// What the Format drop-down says for each shape. (The site's list lives in src/lib/art.ts, which a
// test cannot import because it needs Astro, so the wording is stated here too.)
const FORMAT_LABELS = { 'poster-11x17': '11x17 poster', square: 'Square', social: 'Social media' } as const;
const years = [...new Set(artworks.flatMap((a) => (a.year ? [a.year] : [])))].sort((a, b) => b - a).map(String);
const formats = Object.keys(FORMAT_LABELS).filter((f) => artworks.some((a) => a.format === f));
const tags = [...new Set(artworks.flatMap((a) => a.tags ?? []))];

const openFilters = (page: Page) => page.locator('[data-filter-panel] > summary').click();
const shownTitles = (page: Page) => page.locator('[data-item]:not([hidden]) .piece > figcaption > strong').allTextContents();
// The drop-downs by name (a label search would also match image links like "View larger: ... Year ...").
const control = (page: Page, name: string) => page.locator(`select[name="${name}"]`);
const status = (page: Page) => page.locator('.filter-status');
const total = artworks.length;

/** The titles on the page with no filters, which is the order the site is built in. */
const defaultOrder = async (page: Page) => {
  await page.goto(ART);
  return shownTitles(page);
};

/** The pieces that match, in the page's own order. */
const inPageOrder = (order: string[], keep: (a: (typeof artworks)[number]) => boolean) =>
  order.filter((title) => keep(artworks.find((a) => a.title === title)!));

test.describe('Art filters', () => {
  test('the data has enough variety to test', () => {
    expect(years.length).toBeGreaterThan(1);
    expect(formats.length).toBeGreaterThan(1);
  });

  test('with scripts off, the panel is hidden and every piece is listed', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(ART);
    await expect(page.locator('[data-archive-filters]')).toBeHidden();
    await expect(page.locator('.piece:visible')).toHaveCount(total);
    await context.close();
  });

  test('the Filters panel starts closed and offers Sort by, Year, and Format', async ({ page }) => {
    await page.goto(ART);
    const form = page.getByRole('form', { name: 'Filter pieces' });
    await expect(page.locator('[data-filter-panel]')).not.toHaveAttribute('open', '');
    await expect(form).toBeHidden();
    await expect(page.locator('.piece:visible')).toHaveCount(total);

    await openFilters(page);
    await expect(form).toBeVisible();
    await expect(status(page)).toHaveText(`Showing ${total} of ${total} pieces`);

    await expect(control(page, 'sort').locator('option')).toHaveText(['Newest first', 'Oldest first']);
    await expect(control(page, 'year').locator('option')).toHaveText(['All years', ...years]);
    await expect(control(page, 'format').locator('option')).toHaveText(['Any format', ...formats.map((f) => FORMAT_LABELS[f as keyof typeof FORMAT_LABELS])]);
  });

  test('Oldest first is exactly the newest first list turned around, and Clear puts it back', async ({ page }) => {
    const newest = await defaultOrder(page);
    await openFilters(page);
    await control(page, 'sort').selectOption('oldest');

    const oldest = await shownTitles(page);
    expect(oldest).toEqual([...newest].reverse());
    expect(new URL(page.url()).searchParams.get('sort')).toBe('oldest');
    await expect(page.locator('[data-filter-count]')).toHaveText(' · 1 selected');
    await expect(status(page)).toHaveText(`Showing ${total} of ${total} pieces`);

    // The first card on the page is now the oldest piece, and its dates read oldest to newest.
    const dates = await page.locator('[data-item] .piece > figcaption .meta').allTextContents();
    const firstYear = Number(dates[0].match(/\d{4}/)?.[0]);
    const lastYear = Number(dates.at(-1)!.match(/\d{4}/)?.[0]);
    expect(firstYear).toBeLessThanOrEqual(lastYear);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    expect(await shownTitles(page)).toEqual(newest);
    expect(new URL(page.url()).search).toBe('');
    await expect(page.locator('[data-filter-count]')).toHaveText('');
  });

  test('the sort order survives a reload and a shared link', async ({ page }) => {
    const newest = await defaultOrder(page);
    await openFilters(page);
    await control(page, 'sort').selectOption('oldest');
    await page.reload();
    expect(await shownTitles(page)).toEqual([...newest].reverse());
    await openFilters(page);
    await expect(control(page, 'sort')).toHaveValue('oldest');

    await page.goto(`${ART}?sort=oldest`);
    expect(await shownTitles(page)).toEqual([...newest].reverse());
  });

  test('each year shows exactly that year\'s pieces, still newest first', async ({ page }) => {
    const newest = await defaultOrder(page);
    await openFilters(page);
    for (const year of years) {
      await control(page, 'year').selectOption(year);
      const expected = inPageOrder(newest, (a) => String(a.year) === year);
      expect(await shownTitles(page), `year ${year}`).toEqual(expected);
      await expect(status(page)).toHaveText(`Showing ${expected.length} of ${total} pieces`);
    }
  });

  test('each format shows exactly the pieces of that shape', async ({ page }) => {
    const newest = await defaultOrder(page);
    await openFilters(page);
    for (const format of formats) {
      await control(page, 'format').selectOption(format);
      const expected = inPageOrder(newest, (a) => a.format === format);
      expect(await shownTitles(page), `format ${format}`).toEqual(expected);
    }
  });

  test('year, format, and sort work together, and a link restores them', async ({ page }) => {
    const newest = await defaultOrder(page);
    // A year and format that have pieces together.
    const sample = artworks.find((a) => a.year && a.format && artworks.filter((b) => b.year === a.year && b.format === a.format).length > 1)!;
    expect(sample, 'the data has a year and format that share more than one piece').toBeTruthy();
    const expected = inPageOrder(newest, (a) => a.year === sample.year && a.format === sample.format);

    await openFilters(page);
    await control(page, 'year').selectOption(String(sample.year));
    await control(page, 'format').selectOption(sample.format!);
    await control(page, 'sort').selectOption('oldest');
    expect(await shownTitles(page)).toEqual([...expected].reverse());
    await expect(page.locator('[data-filter-count]')).toHaveText(' · 3 selected');

    const search = new URL(page.url()).searchParams;
    expect([search.get('year'), search.get('format'), search.get('sort')]).toEqual([String(sample.year), sample.format, 'oldest']);

    await page.goto(`${ART}?year=${sample.year}&format=${sample.format}&sort=oldest`);
    expect(await shownTitles(page)).toEqual([...expected].reverse());
  });

  test('a combination with no pieces shows the message from the file', async ({ page }) => {
    const pair = years
      .flatMap((y) => formats.map((f) => [y, f] as const))
      .find(([y, f]) => !artworks.some((a) => String(a.year) === y && a.format === f));
    expect(pair, 'the data has a year and format that never go together').toBeTruthy();

    await page.goto(`${ART}?year=${pair![0]}&format=${pair![1]}`);
    expect(await shownTitles(page)).toEqual([]);
    await expect(page.locator('[data-no-results]')).toBeVisible();
    await expect(page.locator('[data-no-results]')).toHaveText(intros.art.no_match!);
    await openFilters(page);
    await expect(status(page)).toHaveText(`Showing 0 of ${total} pieces`);
  });

  test('the Tags group appears only once a piece has a tag, and a piece must have every tag picked', async ({ page }) => {
    await page.goto(ART);
    await openFilters(page);
    const group = page.locator('fieldset', { has: page.locator('input[name="tag"]') });
    if (tags.length === 0) {
      await expect(group).toHaveCount(0); // no empty box while nothing is tagged
      return;
    }
    await expect(group.locator('input[name="tag"]')).toHaveCount(tags.length);

    const newest = await defaultOrder(page);
    await openFilters(page);
    const pick = (tag: string) => page.locator('label.tag-option', { has: page.locator(`input[name="tag"][value="${tag}"]`) }).click();
    await pick(tags[0]);
    expect(await shownTitles(page)).toEqual(inPageOrder(newest, (a) => (a.tags ?? []).includes(tags[0])));
    if (tags.length > 1) {
      await pick(tags[1]);
      expect(await shownTitles(page)).toEqual(inPageOrder(newest, (a) => (a.tags ?? []).includes(tags[0]) && (a.tags ?? []).includes(tags[1])));
    }
  });

  for (const width of [375, 700, 1100, 1600]) {
    test(`cards in a row still end at the same place after filtering and sorting (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ART);
      await openFilters(page);

      const checkRows = async (why: string) => {
        const cards = await page.locator('[data-item]:not([hidden]) .piece').evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { top: Math.round(r.top + window.scrollY), bottom: r.bottom + window.scrollY, title: el.querySelector('strong')?.textContent ?? '' };
          }),
        );
        expect(cards.length, why).toBeGreaterThan(0);
        const rows = new Map<number, typeof cards>();
        for (const c of cards) rows.set(c.top, [...(rows.get(c.top) ?? []), c]);
        for (const [top, row] of rows) {
          const bottoms = row.map((c) => c.bottom);
          expect(Math.max(...bottoms) - Math.min(...bottoms), `${why}: row at ${top}: ${row.map((c) => c.title).join(' | ')}`).toBeLessThanOrEqual(2);
        }
      };

      await control(page, 'format').selectOption(formats[0]);
      await checkRows(`format ${formats[0]}`);
      await control(page, 'sort').selectOption('oldest');
      await checkRows('oldest first');
      await control(page, 'format').selectOption('');
      await control(page, 'year').selectOption(years[0]);
      await checkRows(`year ${years[0]} oldest first`);
    });
  }

  test('the larger view still opens the right picture after the pieces are re-sorted', async ({ page }) => {
    await page.goto(ART);
    await openFilters(page);
    await control(page, 'sort').selectOption('oldest');
    const link = page.locator('[data-item] .piece > a[data-lightbox]').first();
    const alt = await link.locator('img').getAttribute('alt');
    await link.click();
    const dialog = page.locator('dialog.lightbox');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toHaveAttribute('alt', alt!);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
