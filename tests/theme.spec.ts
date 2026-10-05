import { test, expect } from './helpers/test';

// The header's theme button switches between light and dark and remembers the choice. Until it is
// used, the page follows the visitor's system setting.
const DARK_BG = 'rgb(19, 19, 22)'; // --bg in dark
const LIGHT_BG = 'rgb(251, 250, 247)'; // --bg in light

const toggle = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Switch to (dark|light) theme$/ });
// The button is a small scene of the theme that is on now: an orange sun in a blue sky for light, a
// moon among stars for dark. Its look comes entirely from CSS, so these read the computed styles. The
// checks retry, which covers the short fade between the two.
const SKY_DAY = 'rgb(207, 230, 255)';
const SKY_NIGHT = 'rgb(43, 48, 64)';
const showsDay = async (page: import('@playwright/test').Page) => {
  await expect(toggle(page)).toHaveAttribute('data-mode', 'light');
  await expect(toggle(page).locator('.sky')).toHaveCSS('fill', SKY_DAY);
  await expect(toggle(page).locator('.rays')).toHaveCSS('opacity', '1');
  await expect(toggle(page).locator('.stars')).toHaveCSS('opacity', '0');
};
const showsNight = async (page: import('@playwright/test').Page) => {
  await expect(toggle(page)).toHaveAttribute('data-mode', 'dark');
  await expect(toggle(page).locator('.sky')).toHaveCSS('fill', SKY_NIGHT);
  await expect(toggle(page).locator('.rays')).toHaveCSS('opacity', '0');
  await expect(toggle(page).locator('.stars')).toHaveCSS('opacity', '1');
};
const background = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme button, system set to light', () => {
  test.use({ colorScheme: 'light' });

  test('starts light and offers dark; one click switches, another switches back', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await background(page)).toBe(LIGHT_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to dark theme');
    await showsDay(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to light theme');
    await showsNight(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(LIGHT_BG);
    await showsDay(page);
  });

  test('the choice is remembered on reload and on other pages', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);

    await page.goto('/audio/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to light theme');
  });

  test('works from the keyboard', async ({ page }) => {
    await page.goto('/');
    await toggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('still works when storage is blocked, for the rest of the visit', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await page.goto('/');
    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);
  });
});

test.describe('theme button, system set to dark', () => {
  test.use({ colorScheme: 'dark' });

  test('starts dark and offers light; a click switches to light', async ({ page }) => {
    await page.goto('/');
    expect(await background(page)).toBe(DARK_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to light theme');
    await showsNight(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(LIGHT_BG);
    await showsDay(page);
  });
});

// WCAG relative luminance and contrast ratio, for "rgb(r, g, b)" strings.
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test.describe('theme button scene', () => {
  test.use({ colorScheme: 'dark' });

  test('is already in place on load, with no animation', async ({ page }) => {
    await page.goto('/');
    await toggle(page).waitFor();
    const running = await page.evaluate(() => document.querySelector('.theme-toggle')!.getAnimations({ subtree: true }).length);
    expect(running).toBe(0);
    await showsNight(page);
  });

  test('is a comfortable target: at least 2rem tall and wide', async ({ page }) => {
    await page.goto('/');
    const box = await toggle(page).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(32);
    expect(box!.width).toBeGreaterThanOrEqual(32);
  });

  test('the sun and the moon each keep 3:1 contrast against their sky', async ({ page }) => {
    await page.goto('/');
    const fills = async () =>
      page.evaluate(() => {
        const fill = (selector: string) => getComputedStyle(document.querySelector(selector)!).fill;
        return { sky: fill('.theme-toggle .sky'), body: fill('.theme-toggle .core') };
      });
    await showsNight(page);
    const night = await fills();
    expect(contrast(night.sky, night.body)).toBeGreaterThanOrEqual(3);

    await toggle(page).click();
    await showsDay(page);
    const day = await fills();
    expect(contrast(day.sky, day.body)).toBeGreaterThanOrEqual(3);
  });

  test('animates between the themes when motion is allowed', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    await expect(toggle(page).locator('.knob')).toHaveCSS('transition-duration', '0.45s');
  });
});

test.describe('theme button scene, reduced motion', () => {
  test.use({ colorScheme: 'light', reducedMotion: 'reduce' });

  test('changes at once, with nothing animating', async ({ page }) => {
    await page.goto('/');
    await toggle(page).click();
    const running = await page.evaluate(() => document.querySelector('.theme-toggle')!.getAnimations({ subtree: true }).length);
    expect(running).toBe(0);
    await expect(toggle(page).locator('.knob')).toHaveCSS('transition-duration', '0s');
    await showsNight(page);
  });
});

test('with scripts off there is no button and the page follows the system setting', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.theme-toggle')).toBeHidden();
  await expect(toggle(page)).toHaveCount(0);
  expect(await background(page)).toBe(DARK_BG);
  await context.close();
});

test('the print pages ignore the choice and stay on white paper', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.goto('/resume/print/qa/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.theme-toggle')).toHaveCount(0);
});
