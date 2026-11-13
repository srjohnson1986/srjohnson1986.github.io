import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './helpers/test';
// @ts-expect-error - plain JavaScript module with no type declarations
import { SIZES, LEVELS, generate } from '../src/lib/sudoku/engine.js';

// The Sudoku page (/sudoku/). The board is drawn in the browser from a puzzle the engine makes for the size, level,
// and seed in the address, so each test opens an address with a fixed seed and asks the same engine what the page
// should show. (That the engine's puzzles are sound is checked in sudoku-engine.spec.ts.) What a square should
// highlight, and which candidates belong where, is worked out again here, apart from the page's own script.

type Puzzle = { boxRows: number; boxCols: number; side: number; level: number; clues: number; puzzle: number[]; solution: number[] };
type Size = { id: string; label: string; boxRows: number; boxCols: number };
type Level = { level: number; id: string; label: string; techniques: string[] };
type Square = { value: number; notes: number[]; bold: number[]; same: boolean; selected: boolean; clash: boolean; invalid: boolean; given: boolean };

const sizes = SIZES as Size[];
const levels = LEVELS as Level[];
const levelNumber = (id: string) => levels.find((l) => l.id === id)!.level;

const root = (page: Page) => page.locator('[data-sudoku]');
const squares = (page: Page) => page.locator('.sdk-cell');
const square = (page: Page, i: number) => page.locator(`.sdk-cell[data-cell="${i}"]`);
const status = (page: Page) => page.locator('[data-status]');
const tool = (page: Page, action: string) => page.locator(`[data-action="${action}"]`);
const padKey = (page: Page, n: number) => page.locator(`.sdk-key[data-number="${n}"]`);

/** Waits until a puzzle is on the board. */
async function ready(page: Page) {
  await expect(page.locator('[data-game]')).toBeVisible();
  await expect(root(page)).not.toHaveAttribute('aria-busy', 'true');
}

/** Opens the page on a fixed puzzle and returns that puzzle, made here by the same engine. */
async function open(page: Page, size = '9', level = 'hard', seed = 'a'): Promise<Puzzle> {
  await page.goto(`/sudoku/?size=${size}&level=${level}&seed=${seed}`);
  await ready(page);
  return generate({ size, level: levelNumber(level), seed }) as Puzzle;
}

/** Everything the tests look at, for every square on the board, read from the page in one go. */
const read = (page: Page): Promise<Square[]> =>
  squares(page).evaluateAll((all) =>
    all.map((cell) => {
      const marks = [...cell.querySelectorAll('.sdk-note')];
      return {
        value: Number((cell as HTMLElement).dataset.value ?? 0),
        notes: marks.map((m) => Number(m.textContent)),
        // Bold as the visitor sees it: the computed weight, not a class name.
        bold: marks.filter((m) => getComputedStyle(m).fontWeight === '700').map((m) => Number(m.textContent)),
        same: cell.classList.contains('is-same'),
        selected: cell.classList.contains('is-selected'),
        clash: cell.classList.contains('is-clash'),
        invalid: cell.getAttribute('aria-invalid') === 'true',
        given: cell.classList.contains('is-given'),
      };
    }),
  );
const values = async (page: Page) => (await read(page)).map((s) => s.value);
const where = (list: Square[], test: (s: Square) => boolean) => list.flatMap((s, i) => (test(s) ? [i] : []));

/** True when two squares share a row, a column, or a box. Written out here, apart from the engine's own tables. */
function sees(p: Puzzle, a: number, b: number): boolean {
  if (a === b) return false;
  const [ra, ca, rb, cb] = [Math.floor(a / p.side), a % p.side, Math.floor(b / p.side), b % p.side];
  return ra === rb || ca === cb || (Math.floor(ra / p.boxRows) === Math.floor(rb / p.boxRows) && Math.floor(ca / p.boxCols) === Math.floor(cb / p.boxCols));
}

/** The candidates each empty square should have: every number not already in its row, column, or box. */
const candidatesFor = (p: Puzzle, board: number[]): number[][] =>
  board.map((v, i) => {
    if (v) return [];
    const used = new Set(board.filter((other, j) => other && sees(p, i, j)));
    return Array.from({ length: p.side }, (_, n) => n + 1).filter((n) => !used.has(n));
  });

const pageScrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const frameScrolls = (page: Page) => page.locator('[data-frame]').evaluate((f) => ({ across: f.scrollWidth > f.clientWidth, down: f.scrollHeight > f.clientHeight }));

// ---------------------------------------------------------------------------------------------------------------

test.describe('Sudoku page: the puzzle on the board', { tag: ['@req-457'] }, () => {
  test('starts with a 9x9 Hard puzzle, in 3x3 boxes of 9 squares, and puts it in the address', async ({ page }) => {
    await page.goto('/sudoku/');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sudoku');

    const address = new URL(page.url()).searchParams;
    expect(address.get('size')).toBe('9');
    expect(address.get('level')).toBe('hard');
    expect(address.get('seed')).toMatch(/^[a-z0-9]{1,10}$/);
    await expect(page.locator('select[name="size"]')).toHaveValue('9');
    await expect(page.locator('select[name="level"]')).toHaveValue('hard');

    const expected = generate({ size: '9', level: 3, seed: address.get('seed')! }) as Puzzle;
    await expect(page.locator('.sdk-row')).toHaveCount(9);
    await expect(squares(page)).toHaveCount(81);
    expect(await values(page)).toEqual(expected.puzzle);
    await expect(status(page)).toHaveText(`9x9 Hard puzzle: ${expected.clues} clues, ${81 - expected.clues} squares to fill.`);

    // Heavier lines after every third column and row, except at the edge: 2 per row and 2 per column.
    const lines = await squares(page).evaluateAll((all) => all.map((c) => [c.classList.contains('box-right'), c.classList.contains('box-bottom')]));
    expect(lines.flatMap(([right], i) => (right ? [i % 9] : [])).every((c) => c === 2 || c === 5)).toBe(true);
    expect(lines.filter(([right]) => right)).toHaveLength(18);
    expect(lines.flatMap(([, bottom], i) => (bottom ? [Math.floor(i / 9)] : [])).every((r) => r === 2 || r === 5)).toBe(true);
    expect(lines.filter(([, bottom]) => bottom)).toHaveLength(18);
    // The heavier line is really heavier.
    const widths = await square(page, 2).evaluate((c) => [getComputedStyle(c).borderRightWidth, getComputedStyle(c.previousElementSibling!).borderRightWidth]);
    expect(widths).toEqual(['2px', '1px']);
  });

  test('the pickers offer every board and level the engine has', async ({ page }) => {
    await open(page);
    await expect(page.locator('select[name="size"] option')).toHaveText(sizes.map((s) => `${s.label} (${s.boxRows}x${s.boxCols} boxes)`));
    expect(await page.locator('select[name="size"] option').evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value))).toEqual(['4', '6', '9', '12', '16', '20', '25']);
    await expect(page.locator('select[name="level"] option')).toHaveText(['Easy', 'Medium', 'Hard', 'Expert']);
    // The explanation of the levels lists the engine's techniques.
    await expect(page.locator('dl.levels dt')).toHaveText(levels.map((l) => l.label));
    await expect(page.locator('dl.levels dd')).toHaveText(levels.map((l) => l.techniques.join(', ')));
  });

  test('the address picks the puzzle, and a reload shows the same one', async ({ page }) => {
    const expected = await open(page, '6', 'medium', 'b');
    await expect(squares(page)).toHaveCount(36);
    expect(await values(page)).toEqual(expected.puzzle);
    await expect(page.locator('select[name="size"]')).toHaveValue('6');
    await expect(page.locator('select[name="level"]')).toHaveValue('medium');
    await expect(page.getByRole('grid')).toHaveAccessibleName('Sudoku board, 6 by 6');
    await expect(page.locator('.sdk-key')).toHaveText(['1', '2', '3', '4', '5', '6']);

    // 6x6 boxes are 2 rows by 3 columns: a heavier line after column 3, and after rows 2 and 4.
    const lines = await squares(page).evaluateAll((all) => all.map((c) => [c.classList.contains('box-right'), c.classList.contains('box-bottom')]));
    expect(lines.flatMap(([right], i) => (right ? [i] : []))).toEqual([2, 8, 14, 20, 26, 32]);
    expect(lines.flatMap(([, bottom], i) => (bottom ? [i] : []))).toEqual([6, 7, 8, 9, 10, 11, 18, 19, 20, 21, 22, 23]);

    await page.reload();
    await ready(page);
    expect(await values(page)).toEqual(expected.puzzle);
    expect(new URL(page.url()).search).toBe('?size=6&level=medium&seed=b');
  });

  test('New puzzle makes another puzzle for the chosen board and level, with its seed in the address', async ({ page }) => {
    const first = await open(page);
    await page.locator('select[name="size"]').selectOption('16');
    await page.locator('select[name="level"]').selectOption('easy');
    // Choosing does nothing by itself: the board changes when New puzzle is pressed.
    expect(await values(page)).toEqual(first.puzzle);
    await page.getByRole('button', { name: 'New puzzle' }).click();
    await expect(root(page)).toHaveAttribute('data-size', '16');
    await ready(page);

    const address = new URL(page.url()).searchParams;
    expect([address.get('size'), address.get('level')]).toEqual(['16', 'easy']);
    expect(address.get('seed')).not.toBe('a');
    const expected = generate({ size: '16', level: 1, seed: address.get('seed')! }) as Puzzle;
    await expect(squares(page)).toHaveCount(256);
    expect(await values(page)).toEqual(expected.puzzle);
    await expect(page.locator('.sdk-key')).toHaveCount(16);
    await expect(status(page)).toHaveText(`16x16 Easy puzzle: ${expected.clues} clues, ${256 - expected.clues} squares to fill.`);

    // And again on the same board: another seed, another puzzle.
    await page.getByRole('button', { name: 'New puzzle' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('seed')).not.toBe(address.get('seed'));
    await ready(page);
    expect(await values(page)).not.toEqual(expected.puzzle);
  });

  test('a 4x4 board offers Easy only, and says why', async ({ page }) => {
    await open(page);
    const note = page.locator('[data-level-note]');
    await expect(note).toBeHidden();
    await page.locator('select[name="size"]').selectOption('4');
    await expect(page.locator('select[name="level"]')).toHaveValue('easy');
    expect(await page.locator('select[name="level"] option').evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).disabled))).toEqual([false, true, true, true]);
    await expect(note).toHaveText('A 4x4 board is too small for anything above Easy.');

    await page.getByRole('button', { name: 'New puzzle' }).click();
    await expect(root(page)).toHaveAttribute('data-size', '4');
    await ready(page);
    await expect(squares(page)).toHaveCount(16);
    expect(new URL(page.url()).searchParams.get('level')).toBe('easy');

    await page.locator('select[name="size"]').selectOption('9');
    await expect(note).toBeHidden();
    expect(await page.locator('select[name="level"] option').evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).disabled))).toEqual([false, false, false, false]);
  });

  test('an address the page cannot use falls back to a board it can make', async ({ page }) => {
    await page.goto('/sudoku/?size=10&level=silly&seed=' + encodeURIComponent('<b>no</b>'));
    await ready(page);
    let address = new URL(page.url()).searchParams;
    expect([address.get('size'), address.get('level')]).toEqual(['9', 'hard']);
    expect(address.get('seed')).toMatch(/^[a-z0-9]{1,10}$/);
    await expect(squares(page)).toHaveCount(81);

    // A level the board cannot reach becomes the hardest it can.
    await page.goto('/sudoku/?size=4&level=expert&seed=a');
    await ready(page);
    address = new URL(page.url()).searchParams;
    expect([address.get('size'), address.get('level'), address.get('seed')]).toEqual(['4', 'easy', 'a']);
    expect(await values(page)).toEqual((generate({ size: '4', level: 1, seed: 'a' }) as Puzzle).puzzle);
  });

  test('a 25x25 Expert puzzle is made and shown with no error on the page', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto('/sudoku/?size=25&level=expert&seed=a');
    await expect(page.locator('[data-game]')).toBeVisible({ timeout: 90_000 });
    const expected = generate({ size: '25', level: 4, seed: 'a' }) as Puzzle;
    expect(expected.level).toBe(4);
    await expect(squares(page)).toHaveCount(625);
    expect(await values(page)).toEqual(expected.puzzle);
    await expect(status(page)).toHaveText(`25x25 Expert puzzle: ${expected.clues} clues, ${625 - expected.clues} squares to fill.`);
    await expect(page.locator('.sdk-key')).toHaveCount(25);
    expect(errors).toEqual([]);
  });

  test('Larger and Smaller change the size of the squares, and a zoomed board scrolls inside its frame', async ({ page }) => {
    await open(page, '25', 'medium', 'a');
    const height = () => square(page, 0).evaluate((c) => c.getBoundingClientRect().height);
    const start = await height();
    await expect(tool(page, 'smaller')).toBeDisabled();
    expect(await frameScrolls(page)).toEqual({ across: false, down: false });

    await tool(page, 'larger').click();
    expect(await height()).toBeCloseTo(start * 1.25, 0);
    await tool(page, 'larger').click();
    await tool(page, 'larger').click();
    expect(await height()).toBeCloseTo(start * 2, 0);
    expect(await frameScrolls(page)).toEqual({ across: true, down: true });
    expect(await pageScrollsSideways(page), 'the page itself scrolls sideways').toBe(false);
    // A square off to the right can still be reached: selecting it scrolls it into the frame.
    await square(page, 24).focus();
    await expect(square(page, 24)).toBeInViewport();

    await tool(page, 'larger').click();
    await tool(page, 'larger').click();
    await expect(tool(page, 'larger')).toBeDisabled();
    expect(await height()).toBeCloseTo(start * 3, 0);
    for (let i = 0; i < 5; i++) await tool(page, 'smaller').click();
    await expect(tool(page, 'smaller')).toBeDisabled();
    expect(await height()).toBeCloseTo(start, 1);
  });

  test.describe('at phone width', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('a 9x9 board fits, a 25x25 board scrolls inside its frame, and the page never scrolls sideways', async ({ page }) => {
      await open(page);
      expect(await frameScrolls(page)).toEqual({ across: false, down: false });
      expect(await pageScrollsSideways(page)).toBe(false);
      const box = await page.locator('[data-board]').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);

      await open(page, '25', 'easy', 'a');
      expect((await frameScrolls(page)).across).toBe(true);
      expect(await pageScrollsSideways(page)).toBe(false);
    });
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the page says the board needs it', async ({ page }) => {
      await page.goto('/sudoku/');
      await expect(status(page)).toHaveText('The board is drawn by a script, so this page needs JavaScript turned on.');
      await expect(status(page)).toBeVisible();
      await expect(page.locator('[data-game]')).toBeHidden();
      await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

test.describe('Sudoku page: placing numbers', { tag: ['@req-458'] }, () => {
  test('a typed number goes in the selected square, the same number again takes it out, and clues never change', async ({ page }) => {
    const p = await open(page);
    const empty = p.puzzle.indexOf(0);
    const clue = p.puzzle.findIndex((v) => v !== 0);
    const n = p.solution[empty];

    await square(page, empty).click();
    await page.keyboard.press(String(n));
    await expect(square(page, empty)).toHaveAttribute('data-value', String(n));
    await expect(square(page, empty)).toHaveClass(/is-entry/);
    await expect(square(page, empty).locator('.sdk-value')).toHaveText(String(n));
    await page.keyboard.press(String(n));
    await expect(square(page, empty)).not.toHaveAttribute('data-value');

    await page.keyboard.press(String(n));
    await page.keyboard.press('Backspace');
    await expect(square(page, empty)).not.toHaveAttribute('data-value');
    await page.keyboard.press(String(n));
    await page.keyboard.press('Delete');
    await expect(square(page, empty)).not.toHaveAttribute('data-value');
    // A number too big for the board is ignored.
    await open(page, '4', 'easy', 'a');
    const small = generate({ size: '4', level: 1, seed: 'a' }) as Puzzle;
    await square(page, small.puzzle.indexOf(0)).click();
    await page.keyboard.press('7');
    await expect(square(page, small.puzzle.indexOf(0))).not.toHaveAttribute('data-value');

    // Clues: typing, the pad, Backspace, and Erase all leave them alone.
    await open(page);
    const other = p.puzzle[clue] === 1 ? 2 : 1;
    await square(page, clue).click();
    await page.keyboard.press(String(other));
    await page.keyboard.press('Backspace');
    await padKey(page, other).click();
    await tool(page, 'erase').click();
    await expect(square(page, clue)).toHaveAttribute('aria-readonly', 'true');
    expect(await values(page)).toEqual(p.puzzle);
  });

  test('the number pad places and clears numbers, and asks for a square when none is selected', async ({ page }) => {
    const p = await open(page);
    const empty = p.puzzle.indexOf(0);
    await padKey(page, 5).click();
    await expect(status(page)).toHaveText('Pick a square first, then a number.');
    expect(await values(page)).toEqual(p.puzzle);

    await square(page, empty).click();
    await padKey(page, 5).click();
    await expect(square(page, empty)).toHaveAttribute('data-value', '5');
    await padKey(page, 8).click();
    await expect(square(page, empty)).toHaveAttribute('data-value', '8');
    await tool(page, 'erase').click();
    await expect(square(page, empty)).not.toHaveAttribute('data-value');
  });

  test('on a board above 9x9, two digits typed in turn make one number', async ({ page }) => {
    const p = await open(page, '16', 'easy', 'a');
    const [first, second, third, fourth] = p.puzzle.flatMap((v, i) => (v ? [] : [i]));

    await square(page, first).click();
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await expect(square(page, first)).toHaveAttribute('data-value', '12');

    // A digit that could start a two-digit number waits a moment, then counts on its own.
    await square(page, second).click();
    await page.keyboard.press('1');
    await expect(square(page, second)).not.toHaveAttribute('data-value');
    await expect(square(page, second)).toHaveAttribute('data-value', '1');

    // 2 cannot start a number on a 16x16 board, so it counts at once. 19 is too big, so it is 1 and then 9.
    await square(page, third).click();
    await page.keyboard.press('2');
    await expect(square(page, third)).toHaveAttribute('data-value', '2');
    await page.keyboard.press('1');
    await page.keyboard.press('9');
    await expect(square(page, third)).toHaveAttribute('data-value', '9');

    // Moving on before the wait is over keeps the digit in the square it was typed in.
    await square(page, fourth).click();
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowRight');
    await expect(square(page, fourth)).toHaveAttribute('data-value', '1');
    // 1 then 0 is ten.
    await square(page, fourth).click();
    await page.keyboard.press('1');
    await page.keyboard.press('0');
    await expect(square(page, fourth)).toHaveAttribute('data-value', '10');
  });

  test('the arrow keys, Home, and End move the selection and stop at the edges, and Escape clears it', async ({ page }) => {
    await open(page);
    const selected = () => page.locator('.sdk-cell.is-selected');
    await square(page, 40).click();
    for (const [key, to] of [['ArrowUp', 31], ['ArrowLeft', 30], ['ArrowDown', 39], ['ArrowRight', 40], ['Home', 36], ['ArrowLeft', 36], ['End', 44], ['ArrowRight', 44]] as const) {
      await page.keyboard.press(key);
      await expect(selected()).toHaveAttribute('data-cell', String(to));
      await expect(square(page, to)).toBeFocused();
      await expect(square(page, to)).toHaveAttribute('aria-selected', 'true');
    }
    await square(page, 0).click();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(selected()).toHaveAttribute('data-cell', '0');
    await square(page, 80).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(selected()).toHaveAttribute('data-cell', '80');
    // One square at a time is the Tab stop, and it follows the selection.
    await expect(page.locator('.sdk-cell[tabindex="0"]')).toHaveCount(1);
    await expect(square(page, 80)).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.sdk-cell[aria-selected="true"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(selected()).toHaveCount(0);
    await expect(page.locator('.sdk-cell[aria-selected="true"]')).toHaveCount(0);
  });

  test('tabbing into the board selects the square the focus lands on', async ({ page }) => {
    await open(page);
    await tool(page, 'larger').focus();
    await page.keyboard.press('Tab');
    await expect(square(page, 0)).toBeFocused();
    await expect(square(page, 0)).toHaveClass(/is-selected/);
    // The next Tab leaves the board for the number pad: the board is one stop, not 81.
    await page.keyboard.press('Tab');
    await expect(padKey(page, 1)).toBeFocused();
  });

  test('two equal numbers in a row, column, or box are both marked, and the mark goes when one is cleared', async ({ page }) => {
    const p = await open(page);
    const empty = p.puzzle.indexOf(0);
    // A clue the empty square sees, and so a number it must not repeat.
    const clue = p.puzzle.findIndex((v, i) => v !== 0 && sees(p, empty, i));
    await square(page, empty).click();
    await page.keyboard.press(String(p.puzzle[clue]));
    let board = await read(page);
    expect(where(board, (s) => s.clash)).toEqual([empty, clue].sort((a, b) => a - b));
    expect(where(board, (s) => s.invalid)).toEqual([empty, clue].sort((a, b) => a - b));
    // The clash color is its own color, not the usual one.
    const colors = await page.evaluate(
      ([a, b]) => [a, b].map((i) => getComputedStyle(document.querySelector(`.sdk-cell[data-cell="${i}"] .sdk-value`)!).color),
      [clue, p.puzzle.findIndex((v, i) => v !== 0 && i !== clue)],
    );
    expect(colors[0]).not.toBe(colors[1]);

    await page.keyboard.press('Backspace');
    board = await read(page);
    expect(where(board, (s) => s.clash || s.invalid)).toEqual([]);

    // The right number is no clash.
    await page.keyboard.press(String(p.solution[empty]));
    expect(where(await read(page), (s) => s.clash)).toEqual([]);
  });

  test('filling every square correctly shows the solved message, and a wrong number does not', async ({ page }) => {
    const p = await open(page);
    const empties = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
    const last = empties.pop()!;
    for (const i of empties) {
      await square(page, i).click();
      await page.keyboard.press(String(p.solution[i]));
    }
    await expect(root(page)).not.toHaveClass(/is-solved/);

    const wrong = (p.solution[last] % 9) + 1;
    await square(page, last).click();
    await page.keyboard.press(String(wrong));
    expect(await values(page)).not.toContain(0);
    await expect(root(page)).not.toHaveClass(/is-solved/);
    await expect(status(page)).not.toContainText('Solved');

    await page.keyboard.press(String(p.solution[last]));
    expect(await values(page)).toEqual(p.solution);
    await expect(root(page)).toHaveClass(/is-solved/);
    await expect(status(page)).toHaveText('Solved. That was a 9x9 Hard puzzle. Well done.');
    await expect(status(page)).toHaveAttribute('role', 'status');
  });

  test('the board is a grid for screen readers, and each square says its row, column, and contents', async ({ page }) => {
    const p = await open(page);
    const grid = page.getByRole('grid');
    await expect(grid).toHaveAccessibleName('Sudoku board, 9 by 9');
    await expect(grid.getByRole('row')).toHaveCount(9);
    await expect(grid.getByRole('gridcell')).toHaveCount(81);

    const empty = p.puzzle.indexOf(0);
    const clue = p.puzzle.findIndex((v) => v !== 0);
    const at = (i: number) => `Row ${Math.floor(i / 9) + 1}, column ${(i % 9) + 1}: `;
    await expect(square(page, clue)).toHaveAttribute('aria-label', `${at(clue)}${p.puzzle[clue]}, a clue`);
    await expect(square(page, empty)).toHaveAttribute('aria-label', `${at(empty)}empty`);
    await expect(square(page, empty)).not.toHaveAttribute('aria-readonly');
    await expect(square(page, 80)).toHaveAttribute('aria-label', /^Row 9, column 9: /);

    await square(page, empty).click();
    await page.keyboard.press('5');
    await expect(square(page, empty)).toHaveAttribute('aria-label', `${at(empty)}5`);
    await page.keyboard.press('Backspace');
    await tool(page, 'candidates').click();
    await padKey(page, 7).click();
    await padKey(page, 3).click();
    await expect(square(page, empty)).toHaveAttribute('aria-label', `${at(empty)}empty, candidates 3 7`);
  });
});

// ---------------------------------------------------------------------------------------------------------------

test.describe('Sudoku page: highlighting the selected number', { tag: ['@req-459'] }, () => {
  test('selecting a number highlights every other square with it and makes its candidate marks bold', async ({ page }) => {
    const p = await open(page);
    await tool(page, 'fill').click();
    const marks = candidatesFor(p, p.puzzle);
    // Nothing is highlighted or bold until a square is selected.
    let board = await read(page);
    expect(where(board, (s) => s.same || s.selected)).toEqual([]);
    expect(board.flatMap((s) => s.bold)).toEqual([]);

    for (const picked of [p.puzzle.findIndex((v) => v !== 0), p.puzzle.findLastIndex((v) => v !== 0 && v !== p.puzzle.find((x) => x !== 0))]) {
      const n = p.puzzle[picked];
      await square(page, picked).click();
      board = await read(page);
      expect(where(board, (s) => s.selected), 'the selected square').toEqual([picked]);
      expect(where(board, (s) => s.same), `squares highlighted for ${n}`).toEqual(p.puzzle.flatMap((v, i) => (v === n && i !== picked ? [i] : [])));
      // Bold: this number wherever it is a candidate, and nothing else.
      expect(board.map((s) => s.bold), `bold candidate marks for ${n}`).toEqual(marks.map((m) => (m.includes(n) ? [n] : [])));
      expect(board.flatMap((s) => s.bold).length, 'there are candidates of this number to see').toBeGreaterThan(0);
    }

    // The highlight is a real change of color, and the selected square has its own.
    const picked = p.puzzle.findIndex((v) => v !== 0);
    await square(page, picked).click();
    const twin = p.puzzle.findIndex((v, i) => v === p.puzzle[picked] && i !== picked);
    const plain = p.puzzle.findIndex((v) => v !== 0 && v !== p.puzzle[picked]);
    const backgrounds = await page.evaluate((list) => list.map((i) => getComputedStyle(document.querySelector(`.sdk-cell[data-cell="${i}"]`)!).backgroundColor), [picked, twin, plain]);
    expect(new Set(backgrounds).size).toBe(3);
  });

  test('selecting an empty square highlights nothing and bolds nothing', async ({ page }) => {
    const p = await open(page);
    await tool(page, 'fill').click();
    await square(page, p.puzzle.findIndex((v) => v !== 0)).click();
    expect(where(await read(page), (s) => s.same).length).toBeGreaterThan(0);

    const empty = p.puzzle.indexOf(0);
    await square(page, empty).click();
    const board = await read(page);
    expect(where(board, (s) => s.selected)).toEqual([empty]);
    expect(where(board, (s) => s.same)).toEqual([]);
    expect(board.flatMap((s) => s.bold)).toEqual([]);
  });

  test('the highlights follow the selection when it moves by keyboard, and placed numbers count like clues', async ({ page }) => {
    const p = await open(page);
    await tool(page, 'fill').click();
    // Two clues side by side with different numbers.
    const left = p.puzzle.findIndex((v, i) => v !== 0 && i % 9 < 8 && p.puzzle[i + 1] !== 0 && p.puzzle[i + 1] !== v);
    expect(left).toBeGreaterThanOrEqual(0);
    await square(page, left).click();
    await page.keyboard.press('ArrowRight');
    let board = await read(page);
    const n = p.puzzle[left + 1];
    expect(where(board, (s) => s.same)).toEqual(p.puzzle.flatMap((v, i) => (v === n && i !== left + 1 ? [i] : [])));
    expect(board.every((s) => s.bold.every((b) => b === n))).toBe(true);

    // Place a number: its matches light up at once, and the board's other candidates of it turn bold.
    const empty = p.puzzle.indexOf(0);
    const placed = p.solution[empty];
    await square(page, empty).click();
    await page.keyboard.press(String(placed));
    board = await read(page);
    expect(where(board, (s) => s.same)).toEqual(p.puzzle.flatMap((v, i) => (v === placed ? [i] : [])));
    const now = p.puzzle.slice();
    now[empty] = placed;
    expect(board.map((s) => s.bold)).toEqual(candidatesFor(p, now).map((m) => (m.includes(placed) ? [placed] : [])));
    // Selecting a clue of that number highlights the placed one too.
    const clue = p.puzzle.indexOf(placed);
    await square(page, clue).click();
    expect(where(await read(page), (s) => s.same)).toContain(empty);
    // Clearing the selection clears the highlights.
    await page.keyboard.press('Escape');
    board = await read(page);
    expect(where(board, (s) => s.same || s.selected)).toEqual([]);
    expect(board.flatMap((s) => s.bold)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

test.describe('Sudoku page: candidates', { tag: ['@req-460'] }, () => {
  test('the Candidates button and the C key turn the mode on and off', async ({ page }) => {
    const p = await open(page);
    const button = tool(page, 'candidates');
    await expect(button).toHaveText('Candidates');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');

    await square(page, p.puzzle.indexOf(0)).click();
    await page.keyboard.press('c');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('C');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('in Candidates mode a number marks or unmarks a candidate and places nothing', async ({ page }) => {
    const p = await open(page);
    const empty = p.puzzle.indexOf(0);
    await square(page, empty).click();
    await tool(page, 'candidates').click();
    await square(page, empty).click();
    await page.keyboard.press('7');
    await page.keyboard.press('3');
    await padKey(page, 9).click();
    let board = await read(page);
    expect(board[empty]).toMatchObject({ value: 0, notes: [3, 7, 9] });
    await square(page, empty).click();
    await page.keyboard.press('7');
    board = await read(page);
    expect(board[empty]).toMatchObject({ value: 0, notes: [3, 9] });
    expect(board.map((s) => s.value)).toEqual(p.puzzle);
    // No other square was touched.
    expect(where(board, (s) => s.notes.length > 0)).toEqual([empty]);

    // A clue takes no marks.
    const clue = p.puzzle.findIndex((v) => v !== 0);
    await square(page, clue).click();
    await page.keyboard.press('4');
    await padKey(page, 6).click();
    // Nor does a square that holds a number.
    const second = p.puzzle.indexOf(0, empty + 1);
    await tool(page, 'candidates').click();
    await square(page, second).click();
    await page.keyboard.press('5');
    await tool(page, 'candidates').click();
    await page.keyboard.press('2');
    board = await read(page);
    expect(board[clue]).toMatchObject({ value: p.puzzle[clue], notes: [] });
    expect(board[second]).toMatchObject({ value: 5, notes: [] });

    // Back out of the mode, a number is placed again, and it replaces the square's marks.
    await tool(page, 'candidates').click();
    await square(page, empty).click();
    await page.keyboard.press('3');
    expect((await read(page))[empty]).toMatchObject({ value: 3, notes: [] });
    // Erase clears marks as well as numbers.
    const third = p.puzzle.indexOf(0, second + 1);
    await tool(page, 'candidates').click();
    await square(page, third).click();
    await page.keyboard.press('8');
    expect((await read(page))[third].notes).toEqual([8]);
    await tool(page, 'erase').click();
    expect((await read(page))[third].notes).toEqual([]);
  });

  for (const [size, level] of [['9', 'hard'], ['6', 'easy'], ['12', 'medium']] as const) {
    test(`${size}x${size}: Fill in candidates marks exactly the numbers each empty square can still hold, each in its place`, async ({ page }) => {
      const p = await open(page, size, level, 'a');
      await tool(page, 'fill').click();
      const board = await read(page);
      expect(board.map((s) => s.notes)).toEqual(candidatesFor(p, p.puzzle));
      expect(board.map((s) => s.value)).toEqual(p.puzzle);

      // Each mark sits where its number sits in a box: across by column of the box, then down by row.
      const places = await page.locator('.sdk-note').evaluateAll((all) =>
        all.map((m) => {
          const cell = m.closest('.sdk-cell')!.getBoundingClientRect();
          const box = m.getBoundingClientRect();
          return { n: Number(m.textContent), x: (box.left + box.width / 2 - cell.left) / cell.width, y: (box.top + box.height / 2 - cell.top) / cell.height };
        }),
      );
      expect(places.length).toBeGreaterThan(0);
      for (const { n, x, y } of places) {
        expect(Math.floor(x * p.boxCols), `${n} across`).toBe((n - 1) % p.boxCols);
        expect(Math.floor(y * p.boxRows), `${n} down`).toBe(Math.floor((n - 1) / p.boxCols));
      }
    });
  }

  test('placing a number clears its marks from the same row, column, and box, and from nowhere else', async ({ page }) => {
    const p = await open(page);
    await tool(page, 'fill').click();
    const before = (await read(page)).map((s) => s.notes);
    const empty = p.puzzle.indexOf(0);
    const n = p.solution[empty];
    // The test needs marks of this number both inside and outside the square's row, column, and box.
    expect(before.some((notes, i) => notes.includes(n) && sees(p, empty, i))).toBe(true);
    expect(before.some((notes, i) => notes.includes(n) && i !== empty && !sees(p, empty, i))).toBe(true);

    await square(page, empty).click();
    await page.keyboard.press(String(n));
    const after = await read(page);
    expect(after[empty]).toMatchObject({ value: n, notes: [] });
    expect(after.map((s) => s.notes)).toEqual(before.map((notes, i) => (i === empty ? [] : sees(p, empty, i) ? notes.filter((x) => x !== n) : notes)));

    // Taking the number back out does not bring marks back, and Fill in candidates works them out again.
    await page.keyboard.press(String(n));
    expect((await read(page))[empty]).toMatchObject({ value: 0, notes: [] });
    await tool(page, 'fill').click();
    expect((await read(page)).map((s) => s.notes)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** The numbers and candidate marks of every square: what Undo and a reload must bring back exactly. */
const snapshot = async (page: Page) => (await read(page)).map((s) => ({ value: s.value, notes: s.notes }));
const cleanBoard = (p: Puzzle) => p.puzzle.map((value) => ({ value, notes: [] as number[] }));
const madeLine = (p: Puzzle, label: string) => `${label} puzzle: ${p.clues} clues, ${p.side * p.side - p.clues} squares to fill.`;

test.describe('Sudoku page: undo and start over', { tag: ['@req-463'] }, () => {
  test('Undo takes back every kind of move, newest first, and restores the board exactly each time', async ({ page }) => {
    const p = await open(page);
    const undo = tool(page, 'undo');
    await expect(undo).toHaveText('Undo');
    await expect(undo).toBeDisabled();
    const [first, second, third] = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
    const marks = candidatesFor(p, p.puzzle);

    const moves: [string, () => Promise<void>][] = [
      ['Fill in candidates', () => tool(page, 'fill').click()],
      ['place a number, which also clears its marks nearby', async () => {
        await square(page, first).click();
        await page.keyboard.press(String(p.solution[first]));
      }],
      ['unmark a candidate', async () => {
        await tool(page, 'candidates').click();
        await square(page, second).click();
        await page.keyboard.press(String(marks[second][0]));
      }],
      ['mark it again from the number pad', () => padKey(page, marks[second][0]).click()],
      ['erase a number', async () => {
        await square(page, first).click();
        await tool(page, 'erase').click();
      }],
      ['place a number from the number pad', async () => {
        await tool(page, 'candidates').click();
        await square(page, third).click();
        await padKey(page, p.solution[third]).click();
      }],
      ['take it out by entering it again', () => padKey(page, p.solution[third]).click()],
      ['erase a square that only has marks', async () => {
        await square(page, second).click();
        await page.keyboard.press('Backspace');
      }],
    ];
    const states = [await snapshot(page)];
    expect(states[0]).toEqual(cleanBoard(p));
    for (const [name, move] of moves) {
      await move();
      states.push(await snapshot(page));
      expect(states.at(-1), `"${name}" changes the board`).not.toEqual(states.at(-2));
      await expect(undo).toBeEnabled();
    }
    for (let i = moves.length - 1; i >= 0; i--) {
      await undo.click();
      expect(await snapshot(page), `the board after undoing "${moves[i][0]}"`).toEqual(states[i]);
    }
    await expect(undo).toBeDisabled();
    expect(await values(page)).toEqual(p.puzzle);
  });

  test('undoing a placed number brings back the candidate marks it cleared', async ({ page }) => {
    const p = await open(page);
    await tool(page, 'fill').click();
    const empty = p.puzzle.indexOf(0);
    const n = p.solution[empty];
    const marks = candidatesFor(p, p.puzzle);
    expect(marks.some((m, i) => m.includes(n) && sees(p, empty, i)), 'a mark for the placed number to clear').toBe(true);
    await square(page, empty).click();
    await page.keyboard.press(String(n));
    expect((await read(page)).map((s) => s.notes)).not.toEqual(marks);
    await tool(page, 'undo').click();
    expect((await read(page)).map((s) => s.notes)).toEqual(marks);
    // One Undo for one move: the next takes back Fill in candidates, not half a move.
    await tool(page, 'undo').click();
    expect(await snapshot(page)).toEqual(cleanBoard(p));
  });

  test('Ctrl+Z undoes too, and the square of the undone move becomes the selected one', async ({ page }) => {
    const p = await open(page);
    const [first, second] = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
    const clue = p.puzzle.findLastIndex((v) => v !== 0);
    // With nothing to undo, it does nothing.
    await square(page, clue).click();
    await page.keyboard.press('Control+z');
    expect(await snapshot(page)).toEqual(cleanBoard(p));

    await square(page, first).click();
    await page.keyboard.press('5');
    await square(page, second).click();
    await page.keyboard.press('6');
    await square(page, clue).click();

    await page.keyboard.press('Control+z');
    await expect(square(page, second)).not.toHaveAttribute('data-value');
    await expect(square(page, second)).toHaveClass(/is-selected/);
    await expect(square(page, second)).toBeFocused();
    await expect(square(page, first)).toHaveAttribute('data-value', '5');

    // From the number pad the move is undone and its square selected, and the keyboard stays where it was.
    await padKey(page, 9).focus();
    await page.keyboard.press('Meta+z');
    await expect(square(page, first)).not.toHaveAttribute('data-value');
    await expect(square(page, first)).toHaveClass(/is-selected/);
    await expect(padKey(page, 9)).toBeFocused();
    await expect(tool(page, 'undo')).toBeDisabled();
    // Ctrl+Shift+Z is not Undo.
    await padKey(page, 4).click();
    await page.keyboard.press('Control+Shift+z');
    await expect(square(page, first)).toHaveAttribute('data-value', '4');
  });

  test('undoing the last number of a solved puzzle takes the solved message away', async ({ page }) => {
    const p = await open(page, '4', 'easy', 'a');
    for (const i of p.puzzle.flatMap((v, at) => (v ? [] : [at]))) {
      await square(page, i).click();
      await page.keyboard.press(String(p.solution[i]));
    }
    await expect(root(page)).toHaveClass(/is-solved/);
    await expect(status(page)).toHaveText('Solved. That was a 4x4 Easy puzzle. Well done.');
    await tool(page, 'undo').click();
    await expect(root(page)).not.toHaveClass(/is-solved/);
    await expect(status(page)).toHaveText(madeLine(p, '4x4 Easy'));
    expect((await values(page)).filter((v) => v === 0)).toHaveLength(1);
  });

  test('Start over clears every number and mark the visitor entered, leaves the clues, and can be undone', async ({ page }) => {
    const p = await open(page);
    const startOver = tool(page, 'start-over');
    await expect(startOver).toHaveText('Start over');
    // On an untouched board it is not a move.
    await startOver.click();
    await expect(tool(page, 'undo')).toBeDisabled();

    const [first, second] = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
    await tool(page, 'fill').click();
    await square(page, first).click();
    await page.keyboard.press(String(p.solution[first]));
    await square(page, second).click();
    await page.keyboard.press(String(p.solution[second]));
    const played = await snapshot(page);

    await startOver.click();
    expect(await snapshot(page)).toEqual(cleanBoard(p));
    expect(where(await read(page), (s) => s.given)).toEqual(p.puzzle.flatMap((v, i) => (v ? [i] : [])));
    await tool(page, 'undo').click();
    expect(await snapshot(page)).toEqual(played);
  });

  test('a new puzzle starts with nothing to undo', async ({ page }) => {
    const p = await open(page);
    await square(page, p.puzzle.indexOf(0)).click();
    await page.keyboard.press('5');
    await expect(tool(page, 'undo')).toBeEnabled();
    await page.getByRole('button', { name: 'New puzzle' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('seed')).not.toBe('a');
    await ready(page);
    await expect(tool(page, 'undo')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------------------------------------------

const STORE = 'sudoku-progress-v1';
type Stored = { last?: string; games: Record<string, { values: number[]; notes: number[]; at: number; done: boolean }> } | null;
const stored = (page: Page): Promise<Stored> => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? 'null'), STORE);
const store = (page: Page, value: string) => page.evaluate(([name, text]) => localStorage.setItem(name, text), [STORE, value]);
/** A few moves that leave numbers and candidate marks on the board. */
async function play(page: Page, p: Puzzle) {
  const [first, second] = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
  await tool(page, 'fill').click();
  await square(page, first).click();
  await page.keyboard.press(String(p.solution[first]));
  await tool(page, 'candidates').click();
  await square(page, second).click();
  await page.keyboard.press(String(candidatesFor(p, p.puzzle)[second][0]));
  await tool(page, 'candidates').click();
}

test.describe('Sudoku page: saved progress', { tag: ['@req-464'] }, () => {
  test('after a reload the board shows the same numbers and candidate marks, and says so', async ({ page }) => {
    const p = await open(page);
    await expect(status(page)).toHaveText(madeLine(p, '9x9 Hard'));
    await play(page, p);
    const left = await snapshot(page);
    expect(left).not.toEqual(cleanBoard(p));

    await page.reload();
    await ready(page);
    expect(await snapshot(page)).toEqual(left);
    await expect(status(page)).toHaveText(`${madeLine(p, '9x9 Hard')} Picked up where you left off.`);
    // Clues are still clues, and the visitor's numbers are still theirs to change.
    const board = await read(page);
    expect(where(board, (s) => s.given)).toEqual(p.puzzle.flatMap((v, i) => (v ? [i] : [])));
    const first = p.puzzle.indexOf(0);
    await expect(square(page, first)).toHaveClass(/is-entry/);
    await square(page, first).click();
    await page.keyboard.press('Backspace');
    await expect(square(page, first)).not.toHaveAttribute('data-value');
    // The undo history is not kept between visits: Undo starts again from the board as it was picked up.
    await tool(page, 'undo').click();
    expect(await snapshot(page)).toEqual(left);
    await expect(tool(page, 'undo')).toBeDisabled();
  });

  test('progress is kept per puzzle', async ({ page }) => {
    const a = await open(page, '9', 'hard', 'a');
    await play(page, a);
    const leftA = await snapshot(page);

    const b = await open(page, '9', 'hard', 'b');
    expect(await snapshot(page)).toEqual(cleanBoard(b));
    await expect(status(page)).toHaveText(madeLine(b, '9x9 Hard'));
    await square(page, b.puzzle.indexOf(0)).click();
    await page.keyboard.press('1');
    const leftB = await snapshot(page);

    await open(page, '9', 'hard', 'a');
    expect(await snapshot(page)).toEqual(leftA);
    await open(page, '9', 'hard', 'b');
    expect(await snapshot(page)).toEqual(leftB);
    // The same seed at another level is another puzzle, with its own progress.
    const easy = await open(page, '9', 'easy', 'a');
    expect(await snapshot(page)).toEqual(cleanBoard(easy));
  });

  test('with nothing in the address, the page opens the last unfinished puzzle the visitor touched', async ({ page }) => {
    const p = await open(page, '6', 'medium', 'b');
    await play(page, p);
    const left = await snapshot(page);
    // Looking at another puzzle without touching it does not make it the last one played.
    await open(page, '9', 'hard', 'a');

    await page.goto('/sudoku/');
    await ready(page);
    expect(new URL(page.url()).search).toBe('?size=6&level=medium&seed=b');
    await expect(page.locator('select[name="size"]')).toHaveValue('6');
    await expect(page.locator('select[name="level"]')).toHaveValue('medium');
    expect(await snapshot(page)).toEqual(left);
    await expect(status(page)).toContainText('Picked up where you left off.');
  });

  test('if the last puzzle was finished, the page starts a new one of the same board and level', async ({ page }) => {
    const p = await open(page, '4', 'easy', 'a');
    for (const i of p.puzzle.flatMap((v, at) => (v ? [] : [at]))) {
      await square(page, i).click();
      await page.keyboard.press(String(p.solution[i]));
    }
    await expect(root(page)).toHaveClass(/is-solved/);
    expect((await stored(page))!.games['4/easy/a'].done).toBe(true);

    await page.goto('/sudoku/');
    await ready(page);
    const address = new URL(page.url()).searchParams;
    expect([address.get('size'), address.get('level')]).toEqual(['4', 'easy']);
    expect(address.get('seed')).not.toBe('a');
    await expect(root(page)).not.toHaveClass(/is-solved/);
    expect(await values(page)).toEqual((generate({ size: '4', level: 1, seed: address.get('seed')! }) as Puzzle).puzzle);

    // The finished one is still there at its own address, shown as solved.
    await open(page, '4', 'easy', 'a');
    expect(await values(page)).toEqual(p.solution);
    await expect(root(page)).toHaveClass(/is-solved/);
    await expect(status(page)).toHaveText('Solved. That was a 4x4 Easy puzzle. Well done.');
  });

  test('Start over removes the saved progress, and Undo saves it again', async ({ page }) => {
    const p = await open(page);
    await play(page, p);
    const left = await snapshot(page);
    expect(Object.keys((await stored(page))!.games)).toEqual(['9/hard/a']);

    await tool(page, 'start-over').click();
    expect(await stored(page)).toEqual({ games: {} });
    await page.reload();
    await ready(page);
    expect(await snapshot(page)).toEqual(cleanBoard(p));
    await expect(status(page)).toHaveText(madeLine(p, '9x9 Hard'));

    // Undoing a move saves the board it brings back.
    await play(page, p);
    await tool(page, 'start-over').click();
    await tool(page, 'undo').click();
    await page.reload();
    await ready(page);
    expect(await snapshot(page)).toEqual(left);
  });

  test('a save that cannot be read, has the wrong shape, or is at odds with the puzzle is ignored', async ({ page }) => {
    const p = generate({ size: '9', level: 3, seed: 'a' }) as Puzzle;
    const empty = p.puzzle.indexOf(0);
    const clue = p.puzzle.findIndex((v) => v !== 0);
    const zeros = new Array(81).fill(0);
    const game = (change: (values: number[], notes: number[]) => void) => {
      const [boardValues, notes] = [p.puzzle.slice(), zeros.slice()];
      change(boardValues, notes);
      return JSON.stringify({ last: '9/hard/a', games: { '9/hard/a': { values: boardValues, notes, at: 1, done: false } } });
    };
    const bad: Record<string, string> = {
      'not JSON': '{oops',
      'a list': '[1, 2, 3]',
      'games as a list': '{"games": []}',
      'a game that is not an object': '{"games": {"9/hard/a": "yes"}}',
      'values that are not a list': '{"games": {"9/hard/a": {"values": "x", "notes": []}}}',
      'a board of the wrong size': JSON.stringify({ games: { '9/hard/a': { values: new Array(16).fill(0), notes: new Array(16).fill(0), at: 1, done: false } } }),
      'a clue changed': game((v) => (v[clue] = (v[clue] % 9) + 1)),
      'a clue removed': game((v) => (v[clue] = 0)),
      'a number too big for the board': game((v) => (v[empty] = 10)),
      'a number that is not whole': game((v) => (v[empty] = 2.5)),
      'a negative number': game((v) => (v[empty] = -1)),
      'candidate marks on a clue': game((_, n) => (n[clue] = 3)),
      'marks for numbers the board does not have': game((_, n) => (n[empty] = 2 ** 9)),
      'a number and marks in one square': game((v, n) => ((v[empty] = 5), (n[empty] = 3))),
    };
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page);
    for (const [name, text] of Object.entries(bad)) {
      await store(page, text);
      await page.reload();
      await ready(page);
      expect(await snapshot(page), name).toEqual(cleanBoard(p));
      await expect(status(page), name).toHaveText(madeLine(p, '9x9 Hard'));
    }
    // A sound save in the same form is used, so the cases above were refused for their fault and not their form.
    await store(page, game((v, n) => ((v[empty] = 5), (n[p.puzzle.indexOf(0, empty + 1)] = 3))));
    await page.reload();
    await ready(page);
    expect((await snapshot(page))[empty]).toEqual({ value: 5, notes: [] });
    expect((await snapshot(page))[p.puzzle.indexOf(0, empty + 1)]).toEqual({ value: 0, notes: [1, 2] });

    // And after a bad save the page saves over it as usual.
    await store(page, '{oops');
    await page.reload();
    await ready(page);
    await square(page, empty).click();
    await page.keyboard.press('7');
    expect((await stored(page))!.games['9/hard/a'].values[empty]).toBe(7);
    expect(errors).toEqual([]);
  });

  test('a last puzzle the page cannot make is ignored', async ({ page }) => {
    await open(page);
    for (const last of ['nonsense', '10/hard/a', '4/expert/a', '9/hard/<b>', '9/hard/a/b', 42]) {
      await store(page, JSON.stringify({ last, games: {} }));
      await page.goto('/sudoku/');
      await ready(page);
      const address = new URL(page.url()).searchParams;
      expect([address.get('size'), address.get('level')], String(last)).toEqual(['9', 'hard']);
      expect(address.get('seed'), String(last)).toMatch(/^[a-z0-9]{1,10}$/);
    }
  });

  test('with storage unavailable the page still works, with no error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.addInitScript(() => {
      const refuse = () => {
        throw new DOMException('Storage is turned off', 'SecurityError');
      };
      Storage.prototype.getItem = refuse;
      Storage.prototype.setItem = refuse;
    });
    const p = await open(page);
    await play(page, p);
    const first = p.puzzle.indexOf(0);
    await expect(square(page, first)).toHaveAttribute('data-value', String(p.solution[first]));
    await tool(page, 'undo').click();
    await tool(page, 'start-over').click();
    expect(await snapshot(page)).toEqual(cleanBoard(p));
    await page.reload();
    await ready(page);
    expect(await snapshot(page)).toEqual(cleanBoard(p));
    expect(errors).toEqual([]);
  });

  test('only the 12 most recently played puzzles are kept', async ({ page }) => {
    const p = await open(page);
    const older = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`9/easy/s${i + 1}`, { values: [], notes: [], at: i + 1, done: false }]));
    await store(page, JSON.stringify({ last: '9/easy/s12', games: older }));
    await square(page, p.puzzle.indexOf(0)).click();
    await page.keyboard.press('5');
    const after = (await stored(page))!;
    expect(Object.keys(after.games).sort()).toEqual(['9/hard/a', ...Array.from({ length: 11 }, (_, i) => `9/easy/s${i + 2}`)].sort());
    expect(after.last).toBe('9/hard/a');
  });

  test('the save holds only board state, and playing sends nothing over the network', async ({ page }) => {
    const p = await open(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    const before = Date.now();
    await play(page, p);
    await tool(page, 'undo').click();
    await tool(page, 'start-over').click();
    await tool(page, 'undo').click();

    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([STORE]);
    const saved = (await stored(page))!;
    expect(Object.keys(saved).sort()).toEqual(['games', 'last']);
    expect(saved.last).toBe('9/hard/a');
    expect(Object.keys(saved.games)).toEqual(['9/hard/a']);
    const game = saved.games['9/hard/a'];
    expect(Object.keys(game).sort()).toEqual(['at', 'done', 'notes', 'values']);
    const board = await read(page);
    expect(game.values).toEqual(board.map((s) => s.value));
    // Marks are saved as one number per square, a bit for each candidate.
    expect(game.notes).toEqual(board.map((s) => s.notes.reduce((bits, n) => bits + 2 ** (n - 1), 0)));
    expect(game.done).toBe(false);
    expect(game.at).toBeGreaterThanOrEqual(before);
    expect(game.at).toBeLessThanOrEqual(Date.now());
    expect(requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

// The accessibility scan of every page (accessibility.spec.ts) sees this page as it loads. These scans cover what
// play adds: a selection, highlights, bold candidates, a clash, placed numbers, and a zoomed board.
test.describe('Sudoku page: axe scan while playing', { tag: ['@req-341'] }, () => {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      for (const size of ['9', '16'] as const) {
        test(`${size}x${size} with a selection, candidates, placed numbers, a clash, and zoom`, async ({ page }) => {
          const p = await open(page, size, 'hard', 'a');
          const empties = p.puzzle.flatMap((v, i) => (v ? [] : [i]));
          await tool(page, 'fill').click();
          await square(page, empties[0]).click();
          await padKey(page, p.solution[empties[0]]).click();
          // A clash with a clue in the same row, column, or box.
          const clue = p.puzzle.findIndex((v, i) => v !== 0 && sees(p, empties[1], i));
          await square(page, empties[1]).click();
          await padKey(page, p.puzzle[clue]).click();
          await tool(page, 'candidates').click();
          await tool(page, 'larger').click();
          // Select a clue whose number is still a candidate somewhere, so bold marks and highlights are on screen.
          const board = await read(page);
          const shown = p.puzzle.findIndex((v) => v !== 0 && board.some((s) => s.notes.includes(v)));
          await square(page, shown).click();
          const state = await read(page);
          expect(state.some((s) => s.same) && state.some((s) => s.bold.length > 0) && state.some((s) => s.clash)).toBe(true);

          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
          const found = results.violations.map((v) => `${v.id} [${v.impact}] ${v.help}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
          expect(found, found.join('\n')).toEqual([]);
        });
      }
    });
  }
});
