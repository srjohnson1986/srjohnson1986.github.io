import { test, expect } from './helpers/test';
import { intros, projects, releases } from './helpers/data';
import { fill, linkParts } from '../src/lib/copy';

// The small pieces of text that live in src/data/intros.yaml: each page's browser title and
// description, the links in the Audio and Contact lines, and the "no results" messages.
const pages: Record<string, string> = {
  home: '/',
  art: '/art/',
  audio: '/audio/',
  contact: '/contact/',
  events: '/events/',
  development: '/development/',
  'not-found': '/this-page-does-not-exist/',
};

test.describe('page titles and descriptions come from the file', () => {
  for (const [id, path] of Object.entries(pages)) {
    test(`${id}: the title and description match`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(fill(intros[id].title));
      const description = await page.locator('meta[name="description"]').getAttribute('content');
      if (id === 'events') expect(description).toBeTruthy(); // taken from the events data when it has a summary
      else expect(description).toBe(fill(intros[id].description));
      // Placeholders never reach a visitor.
      expect(`${await page.title()} ${description}`).not.toMatch(/[{}]/);
    });
  }

  test('the Events and Development leads come from the file', async ({ page }) => {
    for (const id of ['events', 'development']) {
      await page.goto(pages[id]);
      await expect(page.locator('p.lead')).toHaveText(intros[id].lead.replace(/\s+/g, ' ').trim());
    }
  });
});

test.describe('lines with links', () => {
  test('the Audio page links down to the studio rates, in the words from the file', async ({ page }) => {
    await page.goto('/audio/');
    const line = page.locator('p.studio-link');
    await expect(line).toHaveText(linkParts(intros.audio.studio_link!).map((p) => p.text).join(''));
    const link = linkParts(intros.audio.studio_link!).find((p) => p.href)!;
    await expect(line.getByRole('link', { name: link.text })).toHaveAttribute('href', link.href!);
    await expect(page.locator(link.href!)).toBeAttached(); // the section it points to exists
  });

  test('the Contact page ends with its closing line and a working link to the resume', async ({ page, request }) => {
    await page.goto('/contact/');
    const parts = linkParts(intros.contact.closing!);
    const main = page.getByRole('main');
    await expect(main).toContainText(parts.map((p) => p.text).join(''));
    for (const part of parts.filter((p) => p.href)) {
      await expect(main.getByRole('link', { name: part.text, exact: true })).toHaveAttribute('href', part.href!);
      expect((await request.get(part.href!)).status()).toBe(200);
    }
  });
});

test.describe('"no results" messages come from the file', () => {
  // Two tags that never occur together on the same item give an empty result.
  const neverTogether = (lists: string[][]) => {
    const tags = [...new Set(lists.flat())].sort();
    return tags.flatMap((a) => tags.map((b) => [a, b] as const)).find(([a, b]) => a < b && !lists.some((l) => l.includes(a) && l.includes(b)))!;
  };

  for (const [id, lists] of [
    ['audio', releases.map((r) => r.tags)],
    ['development', projects.map((p) => p.tags)],
  ] as const) {
    test(`${id}: no match shows the message from the file`, async ({ page }) => {
      const [a, b] = neverTogether(lists as unknown as string[][]);
      await page.goto(`${pages[id]}?tag=${a}&tag=${b}`);
      await expect(page.locator('[data-no-results]')).toBeVisible();
      await expect(page.locator('[data-no-results]')).toHaveText(intros[id].no_match!);
    });
  }
});
