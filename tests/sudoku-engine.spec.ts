import { test, expect } from './helpers/test';
import { countSolutions, isValidGrid } from './helpers/sudoku';
// @ts-expect-error - plain JavaScript module with no type declarations
import { SIZES, LEVELS, generate, solve, geometry, fullGrid, patternGrid, makeRandom } from '../src/lib/sudoku/engine.js';

// The Sudoku engine (src/lib/sudoku/engine.js) makes the puzzles for the Sudoku page. These specs make real
// puzzles for every board size and level and check them two ways: with the engine's own logic solver, and with
// the separate trial-and-error solver in tests/helpers/sudoku.ts, which shares no code with it. They run the
// engine directly, so they need no browser and no build.

type Size = { id: string; label: string; boxRows: number; boxCols: number; side: number; levels: number[] };
type Level = { level: number; id: string; label: string; techniques: string[] };
type Puzzle = { size: string; boxRows: number; boxCols: number; side: number; asked: number; level: number; clues: number; attempts: number; seed: string; puzzle: number[]; solution: number[] };
type Solved = { solved: boolean; broken: boolean; level: number; techniques: string[]; values: number[] };

const sizes = SIZES as Size[];
const levels = LEVELS as Level[];
const make = (options: { size: string; level: number; seed: string; tries?: number }) => generate(options) as Puzzle;
const run = (p: { boxRows: number; boxCols: number }, puzzle: number[], maxLevel = 4) => solve(geometry(p.boxRows, p.boxCols), puzzle, maxLevel) as Solved;
const labelOf = (level: number) => levels.find((l) => l.level === level)!.label;
const nine = sizes.find((s) => s.id === '9')!;

test.describe('Sudoku engine', { tag: ['@req-453'] }, () => {
  test('offers boards from 4x4 to 25x25, and the levels each can reach', () => {
    expect(sizes.map((s) => s.label)).toEqual(['4x4', '6x6', '9x9', '12x12', '16x16', '20x20', '25x25']);
    expect(sizes.map((s) => `${s.boxRows}x${s.boxCols}`)).toEqual(['2x2', '2x3', '3x3', '3x4', '4x4', '4x5', '5x5']);
    expect(levels.map((l) => l.label)).toEqual(['Easy', 'Medium', 'Hard', 'Expert']);
    expect(Object.fromEntries(sizes.map((s) => [s.label, s.levels.map(labelOf)]))).toEqual({
      '4x4': ['Easy'],
      '6x6': ['Easy', 'Medium', 'Hard', 'Expert'],
      '9x9': ['Easy', 'Medium', 'Hard', 'Expert'],
      '12x12': ['Easy', 'Medium', 'Hard', 'Expert'],
      '16x16': ['Easy', 'Medium', 'Hard', 'Expert'],
      '20x20': ['Easy', 'Medium', 'Hard', 'Expert'],
      '25x25': ['Easy', 'Medium', 'Hard', 'Expert'],
    });
  });

  for (const size of sizes) {
    test(`${size.label}: every cell sits in one row, one column, and one box, and sees the right cells`, () => {
      const shape = geometry(size.boxRows, size.boxCols) as { cells: number; side: number; units: number[][]; peers: number[][]; rows: number[][]; cols: number[][]; boxes: number[][] };
      expect(shape.cells).toBe(size.side * size.side);
      expect(shape.units).toHaveLength(size.side * 3);
      for (const group of [shape.rows, shape.cols, shape.boxes]) {
        // Each kind of unit covers the whole board once.
        expect(group.flat().sort((a, b) => a - b)).toEqual([...Array(shape.cells).keys()]);
        for (const unit of group) expect(unit).toHaveLength(size.side);
      }
      // The top left box is the first boxRows rows of the first boxCols columns.
      const corner = [];
      for (let r = 0; r < size.boxRows; r++) for (let c = 0; c < size.boxCols; c++) corner.push(r * size.side + c);
      expect(shape.boxes[0]).toEqual(corner);
      // A cell sees the rest of its row and column, plus the cells of its box that are in neither.
      const seen = (size.side - 1) * 2 + (size.boxRows - 1) * (size.boxCols - 1);
      for (const peers of shape.peers) expect(new Set(peers).size).toBe(seen);
    });

    test(`${size.label}: a random grid and the fallback pattern grid are both valid`, () => {
      const shape = geometry(size.boxRows, size.boxCols);
      for (const seed of ['one', 'two', 'three']) {
        expect(isValidGrid(size.boxRows, size.boxCols, fullGrid(shape, makeRandom(seed)))).toBe(true);
        expect(isValidGrid(size.boxRows, size.boxCols, patternGrid(shape, makeRandom(seed)))).toBe(true);
      }
      expect(fullGrid(shape, makeRandom('one'))).not.toEqual(fullGrid(shape, makeRandom('two')));
    });

    for (const level of size.levels) {
      for (const seed of ['a', 'b']) {
        test(`${size.label} ${labelOf(level)}, seed ${seed}: one solution, the level on the label, and no clue to spare`, () => {
          test.setTimeout(180_000); // the biggest boards take a few seconds each, and longer on a busy CI machine
          const p = make({ size: size.id, level, seed });

          expect(p.level, 'the puzzle reaches the level asked for').toBe(level);
          expect(p.puzzle).toHaveLength(size.side * size.side);
          expect(isValidGrid(size.boxRows, size.boxCols, p.solution), 'the solution is a valid grid').toBe(true);
          expect(p.puzzle.every((v, i) => v === 0 || v === p.solution[i]), 'every clue agrees with the solution').toBe(true);
          expect(p.puzzle.filter((v) => v !== 0)).toHaveLength(p.clues);
          expect(p.clues).toBeLessThan(size.side * size.side);

          // The independent solver: exactly one solution.
          expect(countSolutions(size.boxRows, size.boxCols, p.puzzle), 'solutions found by the separate solver').toBe(1);

          // The engine's logic solver finishes it at its level, reaches the same solution, and says the same level.
          const atLevel = run(p, p.puzzle, level);
          expect(atLevel.solved).toBe(true);
          expect(atLevel.values).toEqual(p.solution);
          expect(atLevel.level).toBe(level);
          const named = levels.filter((l) => l.level > 1 && l.level <= level).flatMap((l) => l.techniques);
          for (const technique of atLevel.techniques) expect(named).toContain(technique);
          if (level > 1) {
            expect(atLevel.techniques.some((t) => levels.find((l) => l.level === level)!.techniques.includes(t)), `uses a ${labelOf(level)} technique`).toBe(true);
            // One level down, it gets stuck. So the label is earned, not just allowed.
            const below = run(p, p.puzzle, level - 1);
            expect(below.solved, `solved with the techniques below ${labelOf(level)}`).toBe(false);
            expect(below.broken).toBe(false);
          }

          // No clue to spare: without any one clue, the level's techniques can no longer finish it.
          const spare = p.puzzle.flatMap((v, cell) => {
            if (!v) return [];
            const fewer = p.puzzle.slice();
            fewer[cell] = 0;
            return run(p, fewer, level).solved ? [cell] : [];
          });
          expect(spare, 'clues that could have been removed').toEqual([]);
        });
      }
    }
  }

  test('the same size, level, and seed give the same puzzle, and another seed gives another', () => {
    const first = make({ size: '9', level: 3, seed: 'repeat' });
    expect(make({ size: '9', level: 3, seed: 'repeat' })).toEqual(first);
    const other = make({ size: '9', level: 3, seed: 'another' });
    expect(other.puzzle).not.toEqual(first.puzzle);
    expect(other.solution).not.toEqual(first.solution);
    // The level is part of the recipe too: the same seed at another level is another puzzle.
    expect(make({ size: '9', level: 1, seed: 'repeat' }).puzzle).not.toEqual(first.puzzle);
  });

  test('when the level is out of reach, the hardest puzzle found is returned, and it says which level it is', () => {
    // A 4x4 board never needs more than the Easy techniques.
    const tiny = make({ size: '4', level: 4, seed: 'a' });
    expect(tiny).toMatchObject({ asked: 4, level: 1, attempts: 1 });
    expect(countSolutions(2, 2, tiny.puzzle)).toBe(1);
    expect(run(tiny, tiny.puzzle, 1).solved).toBe(true);

    // A 9x9 board can reach Expert, but not from every grid. Allowed one grid only, this seed falls short.
    const short = make({ size: '9', level: 4, seed: 'b', tries: 1 });
    expect(short).toMatchObject({ asked: 4, attempts: 1 });
    expect(short.level).toBeLessThan(4);
    expect(countSolutions(3, 3, short.puzzle)).toBe(1);
    expect(run(short, short.puzzle).level).toBe(short.level);
    // Given its usual number of tries, the same seed gets there.
    expect(make({ size: '9', level: 4, seed: 'b' }).level).toBe(4);
  });

  test('the solver never guesses: too few clues are left unsolved, and clashing clues are reported as broken', () => {
    const empty = run(nine, new Array(81).fill(0));
    expect(empty).toMatchObject({ solved: false, broken: false, level: 1 });
    expect(empty.values.every((v) => v === 0)).toBe(true);

    // Two solutions: clear a rectangle whose corners can swap. The four cells hold a,b / b,a in two rows of one band.
    const p = make({ size: '9', level: 1, seed: 'swap' });
    const twoWays = swappableCorners(p.solution);
    expect(twoWays, 'this seed has a swappable rectangle to test with').not.toBeNull();
    const open = p.solution.slice();
    for (const cell of twoWays!) open[cell] = 0;
    expect(countSolutions(3, 3, open)).toBe(2);
    const stuck = run(nine, open);
    expect(stuck).toMatchObject({ solved: false, broken: false });
    expect(stuck.values.filter((v) => v === 0)).toHaveLength(4);

    // Two equal clues in one row.
    const clash = p.puzzle.slice();
    const [a, b] = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => clash[c] === 0);
    clash[a] = clash[b] = p.solution[a];
    expect(run(nine, clash)).toMatchObject({ solved: false, broken: true });
    expect(countSolutions(3, 3, clash)).toBe(0);
  });

  test('unknown sizes and levels are refused with a message that says what to use', () => {
    expect(() => generate({ size: '10', level: 1, seed: 'a' })).toThrow(/Unknown Sudoku size "10".*4, 6, 9, 12, 16, 20, 25/);
    expect(() => generate({ size: '9', level: 5, seed: 'a' })).toThrow(/Unknown Sudoku level "5"/);
  });

  test('progress is reported while a puzzle is made', () => {
    const calls: { attempt: number; round: number; part: number }[] = [];
    const p = generate({ size: '9', level: 2, seed: 'a', onProgress: (step: { attempt: number; round: number; part: number }) => calls.push({ ...step }) }) as Puzzle;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ attempt: 1, round: 1, part: 0 });
    expect(Math.max(...calls.map((c) => c.attempt))).toBe(p.attempts);
    for (const c of calls) {
      expect([1, 2]).toContain(c.round);
      expect(c.part).toBeGreaterThanOrEqual(0);
      expect(c.part).toBeLessThan(1);
    }
    // Watching the work does not change the result.
    expect(make({ size: '9', level: 2, seed: 'a' }).puzzle).toEqual(p.puzzle);
  });
});

/**
 * Four cells of a solved 9x9 grid that can swap: two rows in one band of boxes and two columns, with the same two
 * numbers at the corners the other way round (a b over b a). Clearing them leaves exactly two solutions.
 */
function swappableCorners(solution: number[]): number[] | null {
  for (let r1 = 0; r1 < 9; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      if (Math.floor(r1 / 3) !== Math.floor(r2 / 3)) continue;
      for (let c1 = 0; c1 < 9; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          if (Math.floor(c1 / 3) === Math.floor(c2 / 3)) continue;
          if (solution[r1 * 9 + c1] === solution[r2 * 9 + c2] && solution[r1 * 9 + c2] === solution[r2 * 9 + c1]) return [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        }
      }
    }
  }
  return null;
}
