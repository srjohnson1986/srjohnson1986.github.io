import { test, expect, type Page } from './helpers/test';
import AxeBuilder from '@axe-core/playwright';
import { builtPages, redirectPages } from './helpers/data';

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

// /resume/ and /events/ are one-line pages that redirect at once, so the browser navigates away
// while a scan is running. The pages they lead to are scanned like any other.
// The friendly 404 page is built as /404.html, which the page list (index.html files) does not include.
const pages = [...builtPages().filter((p) => !redirectPages.includes(p)), '/404.html'];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe scan, ${scheme} theme`, { tag: ['@req-341'] }, () => {
    test.use({ colorScheme: scheme });
    for (const url of pages) {
      test(`${url}`, async ({ page }) => {
        await page.goto(url);
        await expectClean(page, `${url} (${scheme})`);
      });
    }
  });
}

test.describe('axe scan, phone width', { tag: ['@req-341'] }, () => {
  test.use({ viewport: { width: 375, height: 812 } });
  for (const url of pages) {
    test(`${url}`, async ({ page }) => {
      await page.goto(url);
      await expectClean(page, `${url} (375px wide)`);
    });
  }
});

test.describe('axe scan, states that change the page', { tag: ['@req-341'] }, () => {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test('Art with every story and series open', async ({ page }) => {
        await page.goto('/art/');
        await page.locator('details').evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
        await expectClean(page, `/art/ with everything open (${scheme})`);
      });

      test('Development & QA with filters applied', async ({ page }) => {
        await page.goto('/development-qa/');
        await page.locator('[data-filter-panel] > summary').click();
        await page.locator('label.tag-option').first().click();
        await expectClean(page, `/development-qa/ filtered (${scheme})`);
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

      for (const section of ['Creative', 'Development & QA']) {
        test(`the ${section} list in the header, open`, async ({ page }) => {
          await page.goto('/');
          const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: section, exact: true });
          await link.hover();
          await expect(page.locator('.has-menu', { has: page.getByRole('link', { name: section, exact: true }) }).locator('.submenu')).toBeVisible();
          await expectClean(page, `${section} list open (${scheme})`);
        });
      }

      test('the phone menu, open', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/');
        await page.locator('summary', { hasText: 'Menu' }).click();
        await expectClean(page, `phone menu open (${scheme})`);
      });
    });
  }
});

test.describe('keyboard', { tag: ['@req-342'] }, () => {
  test('the skip link is the first stop, is visible when focused, and jumps to the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('focused links and controls have a visible outline, all the way down the page', async ({ page }) => {
    await page.goto('/development-qa/');
    const problems: string[] = [];
    const stops: { area: string; tag: string; label: string }[] = [];
    // Walk every tab stop until focus leaves the page (the cap only stops a runaway loop).
    for (let i = 0; i < 100; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        // Tag filter checkboxes are hidden on purpose and drawn as a pill beside them; the pill carries the focus ring.
        const pill = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
        const own = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
        const viaPill = pill ? pill.outlineStyle !== 'none' && parseFloat(pill.outlineWidth) > 0 : false;
        const area = el.closest('header') ? 'header' : el.closest('main') ? 'main' : el.closest('footer') ? 'footer' : 'other';
        const label = (el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 30);
        // A checkbox that is itself invisible (opacity 0) shows nothing to the visitor, however it is outlined,
        // so only the pill beside it counts.
        const invisible = style.opacity === '0';
        return { area, tag: el.tagName, label, visible: invisible ? viaPill : own || viaPill };
      });
      if (!info) break;
      stops.push(info);
      if (!info.visible) problems.push(`${info.area}: ${info.label}`);
      // The tag options only become tab stops once the panel is open, so open it from the keyboard.
      if (info.tag === 'SUMMARY' && info.label === 'Filters') await page.keyboard.press('Enter');
    }
    expect(problems, `focused with no visible outline: ${problems.join(', ')}`).toEqual([]);

    // Without these the loop could pass by only ever looking at the header again.
    const reached = (area: string, tag: string) => stops.some((s) => s.area === area && s.tag === tag);
    expect(reached('header', 'BUTTON'), 'the theme button was reached').toBe(true);
    expect(stops.some((s) => s.tag === 'SUMMARY' && s.label === 'Filters'), 'the Filters control was reached').toBe(true);
    expect(reached('main', 'INPUT'), 'a tag option was reached').toBe(true);
    expect(reached('main', 'A'), 'a project link was reached').toBe(true);
    expect(reached('footer', 'A'), 'a footer link was reached').toBe(true);
  });

  test('every page has exactly one skip link, and it targets the main landmark', async ({ page }) => {
    for (const url of pages.filter((p) => !p.startsWith('/resume/print/'))) {
      await page.goto(url);
      await expect(page.getByRole('link', { name: 'Skip to content' }), url).toHaveAttribute('href', '#main');
      await expect(page.locator('main#main'), url).toHaveCount(1);
    }
  });
});
