// A second Sudoku solver, written for the tests and sharing no code with the engine in src/lib/sudoku/. The
// engine says each puzzle has exactly one solution because its logic solver can finish it. This file checks that
// claim another way: it searches for solutions by trial and counts them, so a mistake in one of the engine's
// techniques cannot hide behind the same mistake here.

/** True when the grid has every number from 1 to the side length once in each row, column, and box. */
export function isValidGrid(boxRows: number, boxCols: number, grid: number[]): boolean {
  const side = boxRows * boxCols;
  if (grid.length !== side * side) return false;
  const complete = (values: number[]) => values.length === side && new Set(values).size === side && values.every((v) => Number.isInteger(v) && v >= 1 && v <= side);
  for (let i = 0; i < side; i++) {
    const row = grid.slice(i * side, (i + 1) * side);
    const col = Array.from({ length: side }, (_, r) => grid[r * side + i]);
    const top = Math.floor(i / boxRows) * boxRows;
    const left = (i % boxRows) * boxCols;
    const box: number[] = [];
    for (let r = top; r < top + boxRows; r++) for (let c = left; c < left + boxCols; c++) box.push(grid[r * side + c]);
    if (!complete(row) || !complete(col) || !complete(box)) return false;
  }
  return true;
}

/**
 * Counts the solutions of a puzzle (0 marks an empty cell), stopping at `limit`. So 1 means exactly one solution,
 * and 2 means "more than one".
 *
 * It knows only the two plain rules of Sudoku and applies them as far as they go each time a number is ruled out:
 *   - a cell with one number left takes it, so that number is ruled out of every cell the cell sees;
 *   - a number with one place left in a row, column, or box goes there.
 * When that runs dry it tries things. First it tests every remaining number in every open cell and rules out the
 * ones that lead straight to a dead end, which settles most boards with no real guessing. Then it picks the cell
 * with the fewest numbers left, tries each in turn on a copy of the board, and counts the copies that work out.
 *
 * None of the engine's named techniques (locked candidates, pairs, X-Wing and so on) appear here, on purpose.
 */
export function countSolutions(boxRows: number, boxCols: number, puzzle: number[], limit = 2): number {
  const side = boxRows * boxCols;
  const cells = side * side;
  const boxOf = (r: number, c: number) => Math.floor(r / boxRows) * boxRows + Math.floor(c / boxCols);

  // For each cell: its row, its column, and its box as lists of cells, and every other cell in any of the three.
  const groups: number[][] = Array.from({ length: side * 3 }, () => []);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      groups[r].push(r * side + c);
      groups[side + c].push(r * side + c);
      groups[side * 2 + boxOf(r, c)].push(r * side + c);
    }
  }
  const groupsOf = Array.from({ length: cells }, (_, cell) => groups.filter((g) => g.includes(cell)));
  const others = groupsOf.map((three, cell) => [...new Set(three.flat())].filter((other) => other !== cell));

  // Each cell's remaining numbers as bits of one integer: bit 0 is the number 1.
  const single = (bits: number) => (bits & (bits - 1)) === 0;

  /** Rules a number out of a cell and follows the two rules from there. False means the board cannot be finished. */
  const ruleOut = (left: Int32Array, cell: number, bit: number): boolean => {
    if (!(left[cell] & bit)) return true;
    left[cell] &= ~bit;
    const rest = left[cell];
    if (rest === 0) return false;
    if (single(rest)) for (const other of others[cell]) if (!ruleOut(left, other, rest)) return false;
    for (const group of groupsOf[cell]) {
      let places = 0;
      let last = -1;
      for (const member of group) {
        if (left[member] & bit) {
          places++;
          last = member;
        }
      }
      if (places === 0) return false;
      if (places === 1 && !single(left[last]) && !write(left, last, bit)) return false;
    }
    return true;
  };

  /** Writes a number into a cell, by ruling out every other number there. */
  const write = (left: Int32Array, cell: number, bit: number): boolean => {
    for (let rest = left[cell] & ~bit; rest; rest &= rest - 1) if (!ruleOut(left, cell, rest & -rest)) return false;
    return (left[cell] & bit) !== 0;
  };

  const board = new Int32Array(cells).fill(2 ** side - 1);
  for (let cell = 0; cell < cells; cell++) {
    if (puzzle[cell] && !write(board, cell, 1 << (puzzle[cell] - 1))) return 0; // the clues already clash
  }

  let found = 0;
  const search = (left: Int32Array) => {
    // Test each remaining number on a copy. One that leads straight to a dead end is ruled out for real.
    for (let changed = true; changed; ) {
      changed = false;
      for (let cell = 0; cell < cells; cell++) {
        if (single(left[cell])) continue;
        for (let trying = left[cell]; trying; trying &= trying - 1) {
          const bit = trying & -trying;
          if (!(left[cell] & bit) || write(left.slice(), cell, bit)) continue;
          if (!ruleOut(left, cell, bit)) return;
          changed = true;
        }
      }
    }
    let pick = -1;
    let fewest = side + 1;
    for (let cell = 0; cell < cells; cell++) {
      let n = 0;
      for (let bits = left[cell]; bits; bits &= bits - 1) n++;
      if (n > 1 && n < fewest) {
        fewest = n;
        pick = cell;
      }
    }
    if (pick < 0) {
      found++; // every cell is down to one number
      return;
    }
    for (let trying = left[pick]; trying; trying &= trying - 1) {
      const copy = left.slice();
      if (write(copy, pick, trying & -trying)) search(copy);
      if (found >= limit) return;
    }
  };
  search(board);
  return found;
}
