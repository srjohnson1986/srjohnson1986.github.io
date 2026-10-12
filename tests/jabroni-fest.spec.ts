import { test, expect } from './helpers/test';
import { events } from './helpers/data';

// The Jabroni Fest page is built from src/data/events.yaml. The crawl and the accessibility scans only
// visit it, so these checks are what notice the page losing a section, a fact, or a list item.
// Every expected value is read from the file, so changing the data never needs a test edit.

// Folded YAML text and the page both end up as one line of text, so compare with spaces collapsed.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

test('there is at least one organization to check', () => {
  // Guards against a loader that quietly returns nothing and lets every check below pass for no reason.
  expect(events.length).toBeGreaterThan(0);
});

for (const org of events) {
  test.describe(`Jabroni Fest page: ${org.name}`, () => {
    test('shows the name, summary, and role', async ({ page }) => {
      await page.goto('/jabroni-fest/');
      const section = page.getByRole('region', { name: org.name });
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(org.name);
      await expect(section.locator('p.summary')).toHaveText(oneLine(org.summary));
      await expect(section.getByRole('heading', { name: 'My role' })).toBeVisible();
      await expect(section.getByText(oneLine(org.role), { exact: true })).toBeVisible();
    });

    test('shows every fact with its label', async ({ page }) => {
      await page.goto('/jabroni-fest/');
      const facts = page.getByRole('list', { name: `${org.name} in numbers` }).getByRole('listitem');
      await expect(facts).toHaveCount(org.facts.length);
      for (const [i, fact] of org.facts.entries()) {
        await expect(facts.nth(i).locator('strong')).toHaveText(oneLine(fact.value));
        await expect(facts.nth(i).locator('span')).toHaveText(oneLine(fact.label));
      }
    });

    test('lists every point under "How it runs", in order', async ({ page }) => {
      await page.goto('/jabroni-fest/');
      const section = page.getByRole('region', { name: org.name });
      await expect(section.getByRole('heading', { name: 'How it runs' })).toBeVisible();
      // The list that follows the "How it runs" heading, not the facts strip above it.
      const items = section.locator('h3:has-text("How it runs") + ul > li');
      await expect(items).toHaveText(org.howItRuns.map(oneLine));
    });

    test('names the cause and says what it is', async ({ page }) => {
      await page.goto('/jabroni-fest/');
      const section = page.getByRole('region', { name: org.name });
      await expect(section.getByRole('heading', { name: 'The cause' })).toBeVisible();
      const cause = section.locator('h3:has-text("The cause") + p');
      await expect(cause.locator('strong')).toHaveText(org.cause.name);
      await expect(cause).toContainText(oneLine(org.cause.description));
    });
  });
}
