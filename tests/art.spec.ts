import { test, expect } from './helpers/test';
import { artworks } from './helpers/data';

const withStory = artworks.filter((a) => a.story || a.more);
const withoutStory = artworks.filter((a) => !a.story && !a.more);
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
      .locator('.piece > img')
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

  test('the control says Read more, never "the story behind"', async ({ page }) => {
    await page.goto('/art/');
    await expect(page.getByText(/story behind/i)).toHaveCount(0);
    const storyOnly = withStory.find((a) => a.story && !a.more);
    if (storyOnly) {
      const piece = page.locator('.piece', { has: page.getByText(storyOnly.title, { exact: true }) });
      await expect(piece.locator('summary')).toHaveText('Read more');
    }
    const both = withStory.find((a) => a.story && a.more)!;
    const piece = page.locator('.piece', { has: page.getByText(both.title, { exact: true }) });
    await expect(piece.locator('summary')).toHaveText(`Read more and ${both.more!.length} more image${both.more!.length === 1 ? '' : 's'}`);
  });

  test('the Signals Midwest fliers are their own piece, and the summer collage has no story or extra images', async ({ page }) => {
    await page.goto('/art/');
    const collage = page.locator('.piece', { has: page.getByText("A collage from my summer of '25", { exact: true }) });
    await expect(collage).toHaveCount(1);
    await expect(collage.locator('details')).toHaveCount(0);
    const tour = page.locator('.piece', { has: page.getByText('Alt fliers for the Signals Midwest tour', { exact: true }) });
    await expect(tour.locator('summary')).toHaveText('Read more and 4 more images');
    await expect(tour.locator('details')).toContainText('Signals Midwest');
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
