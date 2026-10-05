import { test, expect, type Page } from './helpers/test';
import AxeBuilder from '@axe-core/playwright';
import { builtPages } from './helpers/data';

// WCAG 2.0 and 2.1, levels A and AA, plus axe's own best-practice rules (heading order, landmarks).
const RULE_SETS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

// The Bandcamp players on the Audio page are third-party content that this site cannot fix, so the
// scans leave the iframes out. The player frame itself still needs a title, which the audio tests
// check, and Bandcamp is stubbed below so a scan never uses the network.
test.beforeEach(async ({ page }) => {
  await page.route('https://bandcamp.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>stub player</p>' }));
});

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(RULE_SETS).exclude('iframe').analyze();
  return results.violations.map((v) => {
    const nodes = v.nodes
      .slice(0, 3)
      .map((n) => `      ${n.target.join(' ')}\n        ${(n.failureSummary ?? '').split('\n').slice(0, 3).join(' ').trim()}`)
      .join('\n');
    return `${v.id} [${v.impact}] ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})\n${nodes}`;
  });
}

const expectClean = async (page: Page, where: string) => {
  const found = await violations(page);
  expect(found, `${where}\n${found.join('\n')}`).toEqual([]);
};

// /resume/ is a one-line page that redirects at once to the first version, so the browser
// navigates away while a scan is running. The page it leads to is scanned like any other.
// The friendly 404 page is built as /404.html, which the page list (index.html files) does not include.
const pages = [...builtPages().filter((p) => p !== '/resume/'), '/404.html'];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe scan, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });
    for (const url of pages) {
      test(`${url}`, async ({ page }) => {
        await page.goto(url);
        await expectClean(page, `${url} (${scheme})`);
      });
    }
  });
}

test.describe('axe scan, phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const url of pages) {
    test(`${url}`, async ({ page }) => {
      await page.goto(url);
      await expectClean(page, `${url} (375px wide)`);
    });
  }
});

test.describe('axe scan, states that change the page', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test('Art with every story and series open', async ({ page }) => {
        await page.goto('/art/');
        await page.locator('details').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
        await expectClean(page, `/art/ with everything open (${scheme})`);
      });

      test('Development with filters applied', async ({ page }) => {
        await page.goto('/development/');
        await page.locator('[data-filter-panel] > summary').click();
        await page.locator('label.tag-option').first().click();
        await expectClean(page, `/development/ filtered (${scheme})`);
      });

      test('Art with the filters open, sorted oldest first and narrowed by year', async ({ page }) => {
        await page.goto('/art/');
        await page.locator('[data-filter-panel] > summary').click();
        await page.locator('select[name="sort"]').selectOption('oldest');
        await page.locator('select[name="year"]').selectOption({ index: 1 });
        await expectClean(page, `/art/ filtered and sorted (${scheme})`);
      });

      test('Audio with a filter applied and the players in place', async ({ page }) => {
        await page.goto('/audio/');
        await page.locator('[data-filter-panel] > summary').click();
        await page.locator('select[name="year"]').selectOption({ index: 1 });
        await expectClean(page, `/audio/ filtered with players (${scheme})`);
      });

      test('after switching the theme with the header button', async ({ page }) => {
        await page.goto('/');
        await page.getByRole('button', { name: /^Switch to (dark|light) theme$/ }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', scheme === 'light' ? 'dark' : 'light');
        await expectClean(page, `home after switching away from ${scheme}`);
      });

      test('Art with the larger view open', async ({ page }) => {
        await page.goto('/art/');
        await page.locator('a[data-lightbox]').first().click();
        await expect(page.locator('dialog.lightbox')).toBeVisible();
        await expectClean(page, `/art/ larger view (${scheme})`);
      });

      test('the phone menu, open', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/');
        await page.locator('summary', { hasText: 'Menu' }).click();
        await expectClean(page, `phone menu open (${scheme})`);
      });
    });
  }
});

test.describe('keyboard', () => {
  test('the skip link is the first stop, is visible when focused, and jumps to the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('focused links and controls have a visible outline', async ({ page }) => {
    await page.goto('/development/');
    const problems: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        // Tag filter checkboxes are hidden on purpose and drawn as a pill beside them; the pill carries the focus ring.
        const pill = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
        const own = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const viaPill = pill ? pill.outlineStyle !== 'none' && parseFloat(pill.outlineWidth) > 0 : false;
        return { label: (el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 30), visible: own || viaPill };
      });
      if (info && !info.visible) problems.push(info.label);
    }
    expect(problems, `focused with no visible outline: ${problems.join(', ')}`).toEqual([]);
  });

  test('every page has exactly one skip link, and it targets the main landmark', async ({ page }) => {
    for (const url of pages.filter((p) => !p.startsWith('/resume/print/'))) {
      await page.goto(url);
      await expect(page.getByRole('link', { name: 'Skip to content' }), url).toHaveAttribute('href', '#main');
      await expect(page.locator('main#main'), url).toHaveCount(1);
    }
  });
});
