import { test, expect, type Page } from './helpers/test';
import { PROJECT_TYPE_LABELS, projects, releases } from './helpers/data';
import { bandsOf, bandSlug } from '../src/lib/band';

// The Development & QA and Audio archives share one filter component, so both are tested the same way.
interface Item {
  title: string;
  facets: Record<string, string[]>;
}
interface Archive {
  name: string;
  path: string;
  noun: string;
  items: Item[];
  selects: string[]; // facet names shown as drop-down lists
  tagFacet: string; // facet name shown as tag buttons
}

const archives: Archive[] = [
  {
    name: 'Development & QA',
    path: '/development-qa/',
    noun: 'projects',
    selects: [],
    tagFacet: 'tag',
    items: projects.map((p) => ({
      title: p.title,
      facets: { tag: p.tags },
    })),
  },
  {
    name: 'Audio',
    path: '/audio/',
    noun: 'releases',
    selects: ['year', 'band', 'role'],
    tagFacet: 'tag',
    items: releases.map((r) => ({
      title: r.title,
      facets: { year: [String(r.year)], band: bandsOf(r).map(bandSlug), role: r.roles ?? [], tag: r.tags },
    })),
  },
];

// The filters below compute their expected values with bandsOf and bandSlug from src/lib/band.ts, the same
// functions the page uses, so a mistake in them would be on both sides. These literal examples pin them.
test.describe('the band helpers, with fixed examples', { tag: ['@req-335'] }, () => {
  test('bandSlug makes a short, space-free value', () => {
    expect(bandSlug('Naw X Asbestos Worker')).toBe('naw-x-asbestos-worker');
    expect(bandSlug('Fat Sally')).toBe('fat-sally');
    expect(bandSlug('breaux!')).toBe('breaux');
    expect(bandSlug('Mëdusa')).toBe('medusa'); // accents are dropped
    expect(bandSlug('  Joy   Kills  ')).toBe('joy-kills');
    expect(bandSlug('529')).toBe('529');
  });

  test('bandsOf lists the bands of a split, or just the artist', () => {
    expect(bandsOf({ artist: 'Fat Sally' })).toEqual(['Fat Sally']);
    expect(bandsOf({ artist: 'Seagulls and Karbomb', bands: ['Seagulls', 'Karbomb'] })).toEqual(['Seagulls', 'Karbomb']);
  });
});

// The filters sit in a panel that starts closed.
const openFilters = (page: Page) => page.locator('[data-filter-panel] > summary').click();
const visibleTitles = (page: Page) => page.locator('[data-item]:not([hidden]) h2').allTextContents();
const sorted = (xs: string[]) => [...xs].sort();
const titlesWhere = (items: Item[], predicate: (i: Item) => boolean) => sorted(items.filter(predicate).map((i) => i.title));
const distinct = (items: Item[], facet: string) => [...new Set(items.flatMap((i) => i.facets[facet]))].sort();

for (const archive of archives) {
  test.describe(`${archive.name} filters`, { tag: ['@req-329'] }, () => {
    const { items } = archive;

    const pickTag = (page: Page, tag: string) =>
      page.locator('label.tag-option', { has: page.locator(`input[name="${archive.tagFacet}"][value="${tag}"]`) }).click();
    const status = (page: Page) => page.locator('.filter-status');

    test('the data has enough variety to test', () => {
      expect(items.length).toBeGreaterThan(1);
    });

    test('with scripts off, the form is hidden and every item is listed', async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(archive.path);
      await expect(page.locator('[data-archive-filters]')).toBeHidden();
      await expect(page.locator('[data-item]:visible')).toHaveCount(items.length);
      await context.close();
    });

    test('with scripts on, the Filters panel starts closed and opens with a click to show the form', async ({ page }) => {
      await page.goto(archive.path);
      const panel = page.locator('[data-filter-panel]');
      await expect(panel.locator('summary')).toBeVisible();
      await expect(panel).not.toHaveAttribute('open', '');
      await expect(page.getByRole('form', { name: `Filter ${archive.noun}` })).toBeHidden();
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(sorted(items.map((i) => i.title))); // every item shows while closed

      await openFilters(page);
      await expect(panel).toHaveAttribute('open', '');
      await expect(page.getByRole('form', { name: `Filter ${archive.noun}` })).toBeVisible();
      await expect(status(page)).toHaveText(`Showing ${items.length} of ${items.length} ${archive.noun}`);

      await openFilters(page); // a second click closes it again
      await expect(page.getByRole('form', { name: `Filter ${archive.noun}` })).toBeHidden();
    });

    test('the closed panel says how many filters are in use, even after a reload or a shared link', async ({ page }) => {
      await page.goto(archive.path);
      const note = page.locator('[data-filter-count]');
      await expect(note).toHaveText('');
      await openFilters(page);
      const tags = distinct(items, archive.tagFacet);
      await pickTag(page, tags[0]);
      await expect(note).toHaveText(' · 1 selected');

      await page.reload(); // reloads closed, with the filter still applied and still announced
      await expect(page.locator('[data-filter-panel]')).not.toHaveAttribute('open', '');
      await expect(note).toHaveText(' · 1 selected');
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(titlesWhere(items, (i) => i.facets[archive.tagFacet].includes(tags[0])));

      await openFilters(page);
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(note).toHaveText('');
    });

    for (const facet of archive.selects) {
      test(`each ${facet} value shows exactly the matching items`, async ({ page }) => {
        await page.goto(archive.path);
      await openFilters(page);
        const select = page.locator(`select[name="${facet}"]`);
        for (const value of distinct(items, facet)) {
          await select.selectOption(value);
          const expected = titlesWhere(items, (i) => i.facets[facet].includes(value));
          await expect.poll(async () => sorted(await visibleTitles(page)), { message: `${facet}=${value}` }).toEqual(expected);
          await expect(status(page)).toHaveText(`Showing ${expected.length} of ${items.length} ${archive.noun}`);
        }
      });
    }

    test('picking tags requires every tag, and an empty result says so', async ({ page }) => {
      await page.goto(archive.path);
      await openFilters(page);
      const tags = distinct(items, archive.tagFacet);

      // One tag: everything that has it.
      const first = tags[0];
      await pickTag(page, first);
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(titlesWhere(items, (i) => i.facets[archive.tagFacet].includes(first)));

      // Two tags that never occur together give an empty result with its message.
      const pair = tags
        .flatMap((a) => tags.map((b) => [a, b] as const))
        .find(([a, b]) => a < b && !items.some((i) => i.facets[archive.tagFacet].includes(a) && i.facets[archive.tagFacet].includes(b)));
      expect(pair, 'the data has no two tags that never occur together').toBeTruthy();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await pickTag(page, pair![0]);
      await pickTag(page, pair![1]);
      await expect.poll(() => visibleTitles(page)).toEqual([]);
      await expect(status(page)).toHaveText(`Showing 0 of ${items.length} ${archive.noun}`);
      await expect(page.locator('[data-no-results]')).toBeVisible();
    });

    test('Clear filters restores the full list and the plain URL', async ({ page }) => {
      await page.goto(archive.path);
      await openFilters(page);
      // Narrow by a drop-down when the page has one, otherwise by a tag.
      if (archive.selects.length) {
        await page.locator(`select[name="${archive.selects[0]}"]`).selectOption(distinct(items, archive.selects[0])[0]);
      } else {
        await pickTag(page, distinct(items, archive.tagFacet)[0]);
      }
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(sorted(items.map((i) => i.title)));
      expect(new URL(page.url()).search).toBe('');
      await expect(page.locator('[data-no-results]')).toBeHidden();
    });

    // Found in an exploratory session: /audio/?year=1999 listed everything but left the Year drop-down
    // blank. A drop-down must always show one of its own options, so a value it does not offer is ignored.
    test('a value in the link that the drop-downs do not offer is ignored, and each shows its first option', async ({ page }) => {
      test.skip(archive.selects.length === 0, 'this page has no drop-downs');
      const query = new URLSearchParams(Object.fromEntries(archive.selects.map((facet) => [facet, 'no-such-value'])));
      await page.goto(`${archive.path}?${query}`);
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(sorted(items.map((i) => i.title)));
      for (const facet of archive.selects) {
        const select = page.locator(`select[name="${facet}"]`);
        // toHaveValue('') would pass on a blank drop-down too, because "nothing selected" also reads as ''.
        await expect(select.locator('option:checked'), `${facet} drop-down has an option selected`).toHaveCount(1);
        await expect(select.locator('option:checked')).toHaveText((await select.locator('option').first().textContent())!);
      }
    });

    test('the selection lives in the URL and survives a reload', async ({ page }) => {
      await page.goto(archive.path);
      await openFilters(page);
      const tags = distinct(items, archive.tagFacet);
      const facet = archive.selects[0]; // undefined on a page with tag buttons only
      const value = facet ? distinct(items, facet)[0] : undefined;
      const tag = facet
        ? tags.find((t) => items.some((i) => i.facets[facet].includes(value!) && i.facets[archive.tagFacet].includes(t)))!
        : tags[0];
      const matches = (i: Item) => (!facet || i.facets[facet].includes(value!)) && i.facets[archive.tagFacet].includes(tag);

      if (facet) await page.locator(`select[name="${facet}"]`).selectOption(value!);
      await pickTag(page, tag);
      const expected = titlesWhere(items, matches);
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(expected);

      const search = new URL(page.url()).searchParams;
      if (facet) expect(search.get(facet)).toBe(value);
      expect(search.getAll(archive.tagFacet)).toEqual([tag]);

      // A reload restores the same view.
      await page.reload();
      if (facet) await expect(page.locator(`select[name="${facet}"]`)).toHaveValue(value!);
      await expect(page.locator(`input[name="${archive.tagFacet}"][value="${tag}"]`)).toBeChecked();
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(expected);

      // So does a link opened directly.
      await page.goto(`${archive.path}?${archive.tagFacet}=${encodeURIComponent(tag)}${facet ? `&${facet}=${encodeURIComponent(value!)}` : ''}`);
      await expect.poll(async () => sorted(await visibleTitles(page))).toEqual(expected);
    });
  });
}

test('Development & QA filters by tag only, and each card still shows its year and type', { tag: ['@req-329'] }, async ({ page }) => {
  await page.goto('/development-qa/');
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('fieldset input[type="checkbox"]').first()).toBeAttached();
  await expect(page.locator('fieldset legend')).toHaveText('Tags');
  for (const project of projects) {
    const card = page.locator('[data-item]', { has: page.getByRole('heading', { name: project.title, exact: true }) });
    await expect(card.getByRole('link', { name: project.title, exact: true })).toHaveAttribute('href', `/development-qa/${project.slug}/`);
    // The Featured badge sits in the same line; CSS spaces it, so the text may or may not have a space before it.
    await expect(card.locator('.meta')).toHaveText(new RegExp(`^${project.year} · ${PROJECT_TYPE_LABELS[project.type]}[ ]*${project.featured ? 'Featured' : ''}$`));
    await expect(card.locator('.featured')).toHaveCount(project.featured ? 1 : 0);
    await expect(card.locator(':scope > p:not(.meta)')).toHaveText(project.summary.replace(/\s+/g, ' ').trim());
    // A chip reads like its tag, with a few special spellings (ci/cd, ai-assisted), so compare only the letters and digits.
    const chips = (await card.locator('.chips .chip').allTextContents()).map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    expect(chips, project.title).toEqual(project.tags.map((tag) => tag.replace(/[^a-z0-9]/gi, '').toLowerCase()));
  }
});
