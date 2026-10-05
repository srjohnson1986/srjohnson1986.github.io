import { test, expect } from './helpers/test';

// The header's theme button switches between light and dark and remembers the choice. Until it is
// used, the page follows the visitor's system setting.
const DARK_BG = 'rgb(19, 19, 22)'; // --bg in dark
const LIGHT_BG = 'rgb(251, 250, 247)'; // --bg in light

const toggle = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Switch to (dark|light) theme$/ });
// The icon shows the theme a click switches to: the moon while the page is light, the sun while dark.
const showsMoon = async (page: import('@playwright/test').Page) => {
  await expect(toggle(page).locator('.icon-moon')).toBeVisible();
  await expect(toggle(page).locator('.icon-sun')).toBeHidden();
};
const showsSun = async (page: import('@playwright/test').Page) => {
  await expect(toggle(page).locator('.icon-sun')).toBeVisible();
  await expect(toggle(page).locator('.icon-moon')).toBeHidden();
};
const background = (page: import('@playwright/test').Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme button, system set to light', () => {
  test.use({ colorScheme: 'light' });

  test('starts light and offers dark; one click switches, another switches back', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await background(page)).toBe(LIGHT_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to dark theme');
    await showsMoon(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe(DARK_BG);
    await expect(toggle(page)).toHaveAccessibleName('Switch to light theme');
    await showsSun(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(LIGHT_BG);
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
    await showsSun(page);

    await toggle(page).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background(page)).toBe(LIGHT_BG);
    await showsMoon(page);
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
