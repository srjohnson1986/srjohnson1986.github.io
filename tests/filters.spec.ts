import { test, expect, type Page } from './helpers/test';
import { projects, releases } from './helpers/data';
import { bandsOf, bandSlug } from '../src/lib/band';

// The Development and Audio archives share one filter component, so both are tested the same way.
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
    name: 'Development',
    path: '/development/',
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

// The filters sit in a panel that starts closed.
const openFilters = (page: Page) => page.locator('[data-filter-panel] > summary').click();
const visibleTitles = (page: Page) => page.locator('[data-item]:not([hidden]) h2').allTextContents();
const sorted = (xs: string[]) => [...xs].sort();
const titlesWhere = (items: Item[], predicate: (i: Item) => boolean) => sorted(items.filter(predicate).map((i) => i.title));
const distinct = (items: Item[], facet: string) => [...new Set(items.flatMap((i) => i.facets[facet]))].sort();

for (const archive of archives) {
  test.describe(`${archive.name} filters`, () => {
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
      expect(sorted(await visibleTitles(page))).toEqual(sorted(items.map((i) => i.title))); // every item shows while closed

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
      expect(sorted(await visibleTitles(page))).toEqual(titlesWhere(items, (i) => i.facets[archive.tagFacet].includes(tags[0])));

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
          expect(sorted(await visibleTitles(page)), `${facet}=${value}`).toEqual(expected);
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
      expect(sorted(await visibleTitles(page))).toEqual(titlesWhere(items, (i) => i.facets[archive.tagFacet].includes(first)));

      // Two tags that never occur together give an empty result with its message.
      const pair = tags
        .flatMap((a) => tags.map((b) => [a, b] as const))
        .find(([a, b]) => a < b && !items.some((i) => i.facets[archive.tagFacet].includes(a) && i.facets[archive.tagFacet].includes(b)));
      expect(pair, 'the data has no two tags that never occur together').toBeTruthy();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await pickTag(page, pair![0]);
      await pickTag(page, pair![1]);
      expect(await visibleTitles(page)).toEqual([]);
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
      expect(sorted(await visibleTitles(page))).toEqual(sorted(items.map((i) => i.title)));
      expect(new URL(page.url()).search).toBe('');
      await expect(page.locator('[data-no-results]')).toBeHidden();
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
      expect(sorted(await visibleTitles(page))).toEqual(expected);

      const search = new URL(page.url()).searchParams;
      if (facet) expect(search.get(facet)).toBe(value);
      expect(search.getAll(archive.tagFacet)).toEqual([tag]);

      // A reload restores the same view.
      await page.reload();
      if (facet) await expect(page.locator(`select[name="${facet}"]`)).toHaveValue(value!);
      await expect(page.locator(`input[name="${archive.tagFacet}"][value="${tag}"]`)).toBeChecked();
      expect(sorted(await visibleTitles(page))).toEqual(expected);

      // So does a link opened directly.
      await page.goto(`${archive.path}?${archive.tagFacet}=${encodeURIComponent(tag)}${facet ? `&${facet}=${encodeURIComponent(value!)}` : ''}`);
      expect(sorted(await visibleTitles(page))).toEqual(expected);
    });
  });
}

test('Development filters by tag only, and each card still shows its year and type', async ({ page }) => {
  await page.goto('/development/');
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('fieldset input[type="checkbox"]').first()).toBeAttached();
  for (const project of projects) {
    const card = page.locator('[data-item]', { has: page.getByRole('heading', { name: project.title, exact: true }) });
    await expect(card).toContainText(`${project.year} ·`);
  }
});
