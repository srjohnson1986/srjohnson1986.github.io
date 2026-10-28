import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { bullets, root, builtPages } from './helpers/data';

// The read-only page that shows which approved bullets retrieval picks for the 13 fixed test queries
// (src/pages/development-qa/this-site/retrieval.astro). The page's scores are checked against a cosine
// similarity written out again here from the committed vectors, so a mistake in the shared retrieval code
// cannot make the page and its test agree on a wrong number.

const URL = '/development-qa/this-site/retrieval/';
const readItems = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).items as { id: string; source: string; text: string; vector: number[]; expected?: string | null }[];
const index = readItems('retrieval/embeddings.json').filter((e) => e.source === 'bullet');
const queries = readItems('retrieval/query-vectors.json');

// Cosine similarity, written out from the definition.
const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};
const ranked = (vector: number[]) => index.map((e) => ({ id: e.id, text: e.text, score: cosine(vector, e.vector) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
const shown = (vector: number[]) => ranked(vector).filter((r) => r.score >= 0.6).slice(0, 5);

// The page lists the queries with a known bullet first, then the off-topic ones.
const onPage = [...queries.filter((q) => q.expected), ...queries.filter((q) => !q.expected)];

test.describe('Retrieval example page', { tag: ['@req-425'] }, () => {
  test('it is a real page of the site: one heading, a main landmark, in the sitemap', async ({ page, request }) => {
    const response = await page.goto(URL);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'How retrieval picks examples' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    expect(builtPages()).toContain(URL);
    const sitemap = await (await request.get('/sitemap-0.xml')).text();
    expect(sitemap).toContain(`${URL}`);
  });

  test('all 13 queries are listed in order, each in a panel that starts collapsed', async ({ page }) => {
    await page.goto(URL);
    const panels = page.locator('details[data-query]');
    await expect(panels).toHaveCount(13);
    expect(await panels.evaluateAll((els) => els.map((e) => (e as HTMLDetailsElement).open))).toEqual(Array(13).fill(false));
    expect(await panels.evaluateAll((els) => els.map((e) => e.getAttribute('data-query')))).toEqual(onPage.map((q) => q.id));
    for (const [i, q] of onPage.entries()) await expect(panels.nth(i).locator('summary .q')).toHaveText(q.text);
  });

  test('a panel opens with a click and with the keyboard, and the list is hidden until it does', async ({ page }) => {
    await page.goto(URL);
    const first = page.locator('details[data-query]').first();
    await expect(first.locator('ol.picks')).toBeHidden();
    await first.locator('summary').click();
    await expect(first).toHaveJSProperty('open', true);
    await expect(first.locator('ol.picks')).toBeVisible();
    await first.locator('summary').click();
    await expect(first).toHaveJSProperty('open', false);

    const second = page.locator('details[data-query]').nth(1);
    await second.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveJSProperty('open', true);
    await page.keyboard.press('Space');
    await expect(second).toHaveJSProperty('open', false);
  });

  test('an opened panel lists the bullets retrieval picks, best first, with their scores, and marks the expected one', async ({ page }) => {
    await page.goto(URL);
    for (const q of onPage.filter((x) => x.expected)) {
      const want = shown(q.vector);
      const panel = page.locator(`details[data-query="${q.id}"]`);
      const items = panel.locator('ol.picks > li');
      await expect(items, q.id).toHaveCount(want.length);
      expect(want.length, q.id).toBeLessThanOrEqual(5);
      expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-bullet'))), q.id).toEqual(want.map((r) => r.id));
      expect(await items.locator('.score').allTextContents(), q.id).toEqual(want.map((r) => r.score.toFixed(2)));
      expect(want.every((r) => r.score >= 0.6), q.id).toBe(true);
      // The expected bullet is marked with words, not only a colour, and only when it is among those shown.
      const marked = await panel.locator('.expected').count();
      expect(marked, q.id).toBe(want.some((r) => r.id === q.expected) ? 1 : 0);
    }
  });

  test('the off-topic queries show that nothing reached the floor and the draft would use the writing rules alone', async ({ page }) => {
    await page.goto(URL);
    const off = onPage.filter((q) => !q.expected);
    expect(off).toHaveLength(3);
    for (const q of off) {
      expect(shown(q.vector), `${q.id} should find nothing`).toEqual([]);
      const panel = page.locator(`details[data-query="${q.id}"]`);
      await panel.locator('summary').click();
      await expect(panel.locator('ol.picks')).toHaveCount(0);
      await expect(panel).toContainText('No bullet scored 0.60 or more');
      await expect(panel).toContainText('writing rules alone');
    }
  });

  test('the recall line and the miss match a calculation made again from the committed vectors', async ({ page }) => {
    await page.goto(URL);
    const asked = queries.filter((q) => q.expected);
    const position = (q: (typeof asked)[number]) => ranked(q.vector).findIndex((r) => r.id === q.expected) + 1;
    const hits = asked.filter((q) => position(q) <= 3).length;
    expect(asked).toHaveLength(10);
    expect(hits / asked.length, 'the page must not show a recall below what the test requires').toBeGreaterThanOrEqual(0.8);
    await expect(page.locator('[data-recall]')).toContainText(`${hits} of ${asked.length} queries (${Math.round((hits / asked.length) * 100)}%)`);
    await expect(page.locator('[data-recall]')).toContainText('at least 8 of 10');

    const misses = asked.filter((q) => position(q) > 3);
    const missParagraphs = page.locator('section p', { hasText: 'The miss:' });
    await expect(missParagraphs).toHaveCount(misses.length);
    for (const q of misses) {
      const n = position(q);
      const ordinal = `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
      await expect(missParagraphs.filter({ hasText: q.text })).toContainText(`ranked ${ordinal}`);
    }
  });

  test('only public bullets and the test queries are on the page', async ({ page }) => {
    await page.goto(URL);
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
    const publicTexts = new Set(bullets.filter((b) => b.public).map((b) => clean(b.text)));
    const texts = (await page.locator('.picks .text').allTextContents()).map((t) => clean(t.replace('Expected match', '')));
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(publicTexts.has(t), t).toBe(true);

    const body = clean(await page.locator('main').innerText());
    for (const b of bullets.filter((x) => !x.public)) expect(body).not.toContain(clean(b.text));
    // The writing rules are never shown as an example.
    expect(body).not.toContain('Use only single hyphens.');
  });

  test('it works without JavaScript and does not scroll sideways on a phone', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.goto(URL);
    const panels = page.locator('details[data-query]');
    await expect(panels).toHaveCount(13);
    await panels.first().locator('summary').click();
    await expect(panels.first().locator('ol.picks')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await context.close();
  });

  test('the This site project page links to it', async ({ page }) => {
    await page.goto('/development-qa/this-site/');
    const link = page.locator('section[aria-labelledby="links"]').getByRole('link', { name: 'How retrieval picks examples' });
    await expect(link).toHaveAttribute('href', URL);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${URL}$`));
  });
});
