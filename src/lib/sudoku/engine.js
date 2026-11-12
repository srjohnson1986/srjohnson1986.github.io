// The Sudoku engine: board shapes, a logic solver that grades a puzzle, and a puzzle generator.
//
// It is plain JavaScript with no dependency and no DOM, so the page, its web worker, and the tests all import
// the same file. How a puzzle is made:
//
//   1. Fill a whole valid grid at random (fullGrid).
//   2. Take clues away one at a time. A clue stays out only if the logic solver can still work the puzzle out
//      without it (generate). The solver never guesses, so a puzzle it can finish has exactly one solution.
//   3. The solver's techniques are sorted into four levels. Clues come out in rounds, one level at a time:
//      first every clue the Easy techniques can do without, then every clue the Medium techniques can do
//      without, and so on up to the level asked for. A clue removed in the Hard round is one the Medium
//      techniques could not replace, so the finished puzzle really needs a Hard technique. That is what makes
//      a level "reasonably hard": it is as bare as its techniques allow, and it needs the level it is sold as.
//
// A cell's candidates are kept as bits of one integer (bit 0 is the number 1, bit 24 is the number 25), so
// "which numbers can still go here" for a whole row is a handful of AND and OR operations.

/**
 * The board sizes on offer. A box is `boxRows` cells tall and `boxCols` wide, and the board is boxRows x boxCols
 * cells a side. `levels` lists the levels a board can reach. A 4x4 board is too small for anything above Easy:
 * 200,000 grids were tried on 2026-11-11 and not one puzzle needed more than the Easy techniques.
 */
export const SIZES = [
  { id: '4', boxRows: 2, boxCols: 2, levels: [1] },
  { id: '6', boxRows: 2, boxCols: 3, levels: [1, 2, 3, 4] },
  { id: '9', boxRows: 3, boxCols: 3, levels: [1, 2, 3, 4] },
  { id: '12', boxRows: 3, boxCols: 4, levels: [1, 2, 3, 4] },
  { id: '16', boxRows: 4, boxCols: 4, levels: [1, 2, 3, 4] },
  { id: '20', boxRows: 4, boxCols: 5, levels: [1, 2, 3, 4] },
  { id: '25', boxRows: 5, boxCols: 5, levels: [1, 2, 3, 4] },
].map((s) => ({ ...s, side: s.boxRows * s.boxCols, label: `${s.boxRows * s.boxCols}x${s.boxRows * s.boxCols}` }));

/** The four difficulty levels and the techniques each one adds. A puzzle of a level needs at least one of that level's techniques. */
export const LEVELS = [
  { level: 1, id: 'easy', label: 'Easy', techniques: ['Naked single', 'Hidden single'] },
  { level: 2, id: 'medium', label: 'Medium', techniques: ['Locked candidates'] },
  { level: 3, id: 'hard', label: 'Hard', techniques: ['Naked pair', 'Hidden pair', 'Naked triple', 'Hidden triple', 'Naked quad', 'Hidden quad'] },
  { level: 4, id: 'expert', label: 'Expert', techniques: ['X-Wing', 'Simple coloring', 'XY-Wing', 'XYZ-Wing', 'Swordfish', 'Jellyfish'] },
];

export const sizeById = (id) => SIZES.find((s) => s.id === String(id));
export const levelById = (id) => LEVELS.find((l) => l.id === id || l.level === id);

// ---------------------------------------------------------------------------------------------------------------
// Board shape
// ---------------------------------------------------------------------------------------------------------------

const shapes = new Map();

/**
 * Everything about a board shape that never changes: which cells make up each row, column, and box (the
 * "units"), and which cells each cell shares a unit with (its "peers"). Cells are numbered left to right, top
 * to bottom, from 0. Built once per shape and reused.
 */
export function geometry(boxRows, boxCols) {
  const key = `${boxRows}x${boxCols}`;
  if (shapes.has(key)) return shapes.get(key);

  const side = boxRows * boxCols;
  const cells = side * side;
  const boxOf = (r, c) => Math.floor(r / boxRows) * boxRows + Math.floor(c / boxCols);
  const rows = Array.from({ length: side }, () => []);
  const cols = Array.from({ length: side }, () => []);
  const boxes = Array.from({ length: side }, () => []);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const cell = r * side + c;
      rows[r].push(cell);
      cols[c].push(cell);
      boxes[boxOf(r, c)].push(cell);
    }
  }
  const units = [...rows, ...cols, ...boxes];

  // sees[a * cells + b] is 1 when cells a and b share a row, column, or box.
  const sees = new Uint8Array(cells * cells);
  const peers = Array.from({ length: cells }, () => []);
  for (const unit of units) for (const a of unit) for (const b of unit) if (a !== b) sees[a * cells + b] = 1;
  for (let a = 0; a < cells; a++) for (let b = 0; b < cells; b++) if (sees[a * cells + b]) peers[a].push(b);

  // Where a box and a line (a row or a column) overlap: the shared cells, the rest of the box, and the rest of
  // the line. The locked candidates technique works on exactly these three groups.
  const overlaps = [];
  for (const box of boxes) {
    for (const line of [...rows, ...cols]) {
      const shared = line.filter((cell) => box.includes(cell));
      if (shared.length === 0) continue;
      overlaps.push({ shared, boxRest: box.filter((cell) => !line.includes(cell)), lineRest: line.filter((cell) => !box.includes(cell)) });
    }
  }

  const shape = { boxRows, boxCols, side, cells, rows, cols, boxes, units, peers, sees, overlaps, all: (1 << side) - 1 };
  shapes.set(key, shape);
  return shape;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

/** How many bits are set: the number of candidates in a candidate mask. */
function count(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** The position of a single set bit: turns the mask of one candidate back into its place, counted from 0. */
const place = (bit) => 31 - Math.clz32(bit);

/**
 * A random number generator that always gives the same numbers for the same seed, so a puzzle can be made
 * again from its seed (Math.random cannot do that). The seed text is hashed to a number (FNV-1a), which
 * starts a small, well known generator (mulberry32). Returns a function that gives a number from 0 up to 1.
 */
export function makeRandom(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffles a list in place (Fisher-Yates) with the given random function. */
function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------------------------------------------------------------------------------------------------------------
// The logic solver
// ---------------------------------------------------------------------------------------------------------------

/** A solver's working state: the value in each cell (0 for empty) and each empty cell's candidate mask. */
function start(shape, puzzle) {
  const state = { shape, value: new Uint8Array(shape.cells), cand: new Int32Array(shape.cells).fill(shape.all), left: shape.cells, broken: false };
  for (let cell = 0; cell < shape.cells; cell++) {
    const v = puzzle[cell];
    if (!v) continue;
    if (!(state.cand[cell] & (1 << (v - 1)))) state.broken = true; // two equal clues see each other
    put(state, cell, v);
  }
  return state;
}

/** Writes a value into a cell and strikes that number from every cell that shares a row, column, or box with it. */
function put(state, cell, v) {
  const off = ~(1 << (v - 1));
  state.value[cell] = v;
  state.cand[cell] = 0;
  state.left--;
  const peers = state.shape.peers[cell];
  for (let i = 0; i < peers.length; i++) state.cand[peers[i]] &= off;
}

/**
 * Level 1 (Easy). A naked single is an empty cell with one candidate left. A hidden single is a number that fits in only
 * one cell of a row, column, or box. Both are repeated until neither finds anything. Stops early once `target`
 * (a cell number, or -1 for none) has a value.
 */
function singles(state, target) {
  const { shape, value, cand } = state;
  let progress = false;
  let again = true;
  while (again && !state.broken) {
    again = false;
    for (let cell = 0; cell < shape.cells; cell++) {
      if (value[cell]) continue;
      const c = cand[cell];
      if (c === 0) {
        state.broken = true; // an empty cell with nothing left to put in it
        return progress;
      }
      if ((c & (c - 1)) === 0) {
        put(state, cell, place(c) + 1);
        again = progress = true;
      }
    }
    if (target >= 0 && value[target]) return progress;
    for (const unit of shape.units) {
      // `once` collects numbers seen in at least one cell, `twice` those seen in at least two.
      let once = 0;
      let twice = 0;
      for (let i = 0; i < unit.length; i++) {
        const c = cand[unit[i]];
        twice |= once & c;
        once |= c;
      }
      let only = once & ~twice;
      while (only) {
        const bit = only & -only;
        only ^= bit;
        for (let i = 0; i < unit.length; i++) {
          if (cand[unit[i]] & bit) {
            put(state, unit[i], place(bit) + 1);
            again = progress = true;
            break;
          }
        }
      }
    }
    if (target >= 0 && value[target]) return progress;
  }
  return progress;
}

/**
 * Level 2 (Medium). Locked candidates: where a box and a line overlap, a number that fits nowhere else in the box must
 * sit in the overlap, so it can be struck from the rest of the line ("pointing"). The same holds the other way
 * round: a number that fits nowhere else in the line can be struck from the rest of the box ("claiming").
 */
function lockedCandidates(state) {
  const { cand } = state;
  let progress = false;
  for (const { shared, boxRest, lineRest } of state.shape.overlaps) {
    let inShared = 0;
    for (let i = 0; i < shared.length; i++) inShared |= cand[shared[i]];
    if (!inShared) continue;
    let inBox = 0;
    let inLine = 0;
    for (let i = 0; i < boxRest.length; i++) inBox |= cand[boxRest[i]];
    for (let i = 0; i < lineRest.length; i++) inLine |= cand[lineRest[i]];
    const pointing = inShared & ~inBox & inLine;
    if (pointing) {
      for (let i = 0; i < lineRest.length; i++) cand[lineRest[i]] &= ~pointing;
      progress = true;
    }
    const claiming = inShared & ~inLine & inBox;
    if (claiming) {
      for (let i = 0; i < boxRest.length; i++) cand[boxRest[i]] &= ~claiming;
      progress = true;
    }
  }
  return progress;
}

/**
 * Level 3 (Hard). Naked pair, triple, and quad (size 2, 3, 4). When `size` cells of a unit hold only `size` different numbers
 * between them, those numbers must go in those cells, so they can be struck from the rest of the unit.
 */
function nakedSets(state, size) {
  const { cand, value } = state;
  let progress = false;
  const chosen = [];
  for (const unit of state.shape.units) {
    const pool = [];
    let open = 0;
    for (let i = 0; i < unit.length; i++) {
      if (value[unit[i]]) continue;
      open++;
      if (count(cand[unit[i]]) <= size) pool.push(unit[i]);
    }
    if (open <= size || pool.length < size) continue;
    const pick = (from, union) => {
      if (chosen.length === size) {
        for (let i = 0; i < unit.length; i++) {
          const cell = unit[i];
          if (value[cell] || chosen.includes(cell) || !(cand[cell] & union)) continue;
          cand[cell] &= ~union;
          progress = true;
        }
        return;
      }
      for (let i = from; i <= pool.length - (size - chosen.length); i++) {
        const next = union | cand[pool[i]];
        if (count(next) > size) continue;
        chosen.push(pool[i]);
        pick(i + 1, next);
        chosen.pop();
      }
    };
    pick(0, 0);
  }
  return progress;
}

/**
 * Level 3 (Hard). Hidden pair, triple, and quad. When `size` numbers of a unit fit in only `size` cells between them, those cells
 * must hold those numbers, so every other candidate can be struck from those cells.
 */
function hiddenSets(state, size) {
  const { cand, value } = state;
  const { side } = state.shape;
  let progress = false;
  const where = new Int32Array(side); // where[n]: which cells of the unit (as bits) the number n + 1 fits in
  for (const unit of state.shape.units) {
    where.fill(0);
    let open = 0;
    for (let i = 0; i < unit.length; i++) {
      if (value[unit[i]]) continue;
      open++;
      for (let c = cand[unit[i]]; c; c &= c - 1) where[place(c & -c)] |= 1 << i;
    }
    if (open <= size) continue;
    const pool = [];
    for (let n = 0; n < side; n++) if (where[n] && count(where[n]) <= size) pool.push(n);
    if (pool.length < size) continue;
    const pick = (from, taken, spots, numbers) => {
      if (taken === size) {
        for (let s = spots; s; s &= s - 1) {
          const cell = unit[place(s & -s)];
          if (cand[cell] & ~numbers) {
            cand[cell] &= numbers;
            progress = true;
          }
        }
        return;
      }
      for (let i = from; i <= pool.length - (size - taken); i++) {
        const next = spots | where[pool[i]];
        if (count(next) > size) continue;
        pick(i + 1, taken + 1, next, numbers | (1 << pool[i]));
      }
    };
    pick(0, 0, 0, 0);
  }
  return progress;
}

/**
 * Level 4 (Expert). X-Wing, Swordfish, and Jellyfish (size 2, 3, 4). Take one number. When it fits in `size` rows only inside the
 * same `size` columns, each of those columns gets its copy from one of those rows, so the number can be struck
 * from those columns in every other row. The same holds with rows and columns swapped.
 */
function fish(state, size) {
  const { cand, value } = state;
  const { side } = state.shape;
  let progress = false;
  const byRow = new Int32Array(side); // byRow[r]: the columns (as bits) of row r where the number fits
  const byCol = new Int32Array(side);
  for (let n = 0; n < side; n++) {
    const bit = 1 << n;
    byRow.fill(0);
    byCol.fill(0);
    for (let cell = 0; cell < state.shape.cells; cell++) {
      if (value[cell] || !(cand[cell] & bit)) continue;
      const r = Math.floor(cell / side);
      const c = cell % side;
      byRow[r] |= 1 << c;
      byCol[c] |= 1 << r;
    }
    for (const rowsAreBase of [true, false]) {
      const lines = rowsAreBase ? byRow : byCol;
      const pool = [];
      for (let i = 0; i < side; i++) if (lines[i] && count(lines[i]) >= 2 && count(lines[i]) <= size) pool.push(i);
      if (pool.length < size) continue;
      const pick = (from, taken, cover, base) => {
        if (taken === size) {
          for (let across = cover; across; across &= across - 1) {
            const j = place(across & -across);
            for (let i = 0; i < side; i++) {
              if (base & (1 << i)) continue;
              const cell = rowsAreBase ? i * side + j : j * side + i;
              if (!value[cell] && cand[cell] & bit) {
                cand[cell] &= ~bit;
                progress = true;
              }
            }
          }
          return;
        }
        for (let i = from; i <= pool.length - (size - taken); i++) {
          const next = cover | lines[pool[i]];
          if (count(next) > size) continue;
          pick(i + 1, taken + 1, next, base | (1 << pool[i]));
        }
      };
      pick(0, 0, 0, 0);
    }
  }
  return progress;
}

/**
 * Level 4 (Expert). XY-Wing and XYZ-Wing. A "pivot" cell and two "pincer" cells it sees, each pincer holding two numbers. In an
 * XY-Wing the pivot holds x and y and the pincers hold x,z and y,z: whichever number the pivot takes, one pincer
 * becomes z, so z can be struck from every cell that sees both pincers. An XYZ-Wing is the same with a pivot that
 * also holds z, so the cell must see the pivot as well.
 */
function wings(state, withZ) {
  const { cand, value } = state;
  const { cells, peers, sees } = state.shape;
  let progress = false;
  for (let pivot = 0; pivot < cells; pivot++) {
    if (value[pivot]) continue;
    const p = cand[pivot];
    if (count(p) !== (withZ ? 3 : 2)) continue;
    const pincers = peers[pivot].filter((cell) => {
      if (value[cell] || count(cand[cell]) !== 2) return false;
      return withZ ? (cand[cell] & ~p) === 0 : count(cand[cell] & p) === 1;
    });
    for (let i = 0; i < pincers.length; i++) {
      for (let j = i + 1; j < pincers.length; j++) {
        const a = cand[pincers[i]];
        const b = cand[pincers[j]];
        const z = a & b;
        if (count(z) !== 1) continue;
        // XY: the pincers share z, which the pivot does not hold. XYZ: the pincers together make up the pivot.
        if (withZ ? (a | b) !== p : (z & p) !== 0 || ((a | b) & ~z) !== p) continue;
        for (const cell of peers[pincers[i]]) {
          if (value[cell] || !(cand[cell] & z) || cell === pivot || cell === pincers[j]) continue;
          if (!sees[cell * cells + pincers[j]] || (withZ && !sees[cell * cells + pivot])) continue;
          cand[cell] &= ~z;
          progress = true;
        }
      }
    }
  }
  return progress;
}

/**
 * Level 4 (Expert). Simple coloring. Take one number. Where it fits in exactly two cells of a unit, one of the two must hold it, so
 * the two cells are opposites. Follow those links from cell to cell, painting the cells in two colors turn about:
 * all the cells of one color hold the number, or all the cells of the other do. Then:
 *  - if two cells of one color see each other, that color is the wrong one, and the number is struck from it;
 *  - a cell outside the chain that sees both colors cannot hold the number either way.
 */
function coloring(state) {
  const { cand, value } = state;
  const { cells, units, side, sees } = state.shape;
  let progress = false;
  const links = Array.from({ length: cells }, () => []);
  const color = new Int8Array(cells);
  for (let n = 0; n < side; n++) {
    const bit = 1 << n;
    for (let cell = 0; cell < cells; cell++) links[cell].length = 0;
    color.fill(0);
    for (const unit of units) {
      let a = -1;
      let b = -1;
      let found = 0;
      for (let i = 0; i < unit.length && found < 3; i++) {
        if (value[unit[i]] || !(cand[unit[i]] & bit)) continue;
        if (found === 0) a = unit[i];
        else b = unit[i];
        found++;
      }
      if (found === 2) {
        links[a].push(b);
        links[b].push(a);
      }
    }
    for (let first = 0; first < cells; first++) {
      if (color[first] || links[first].length === 0) continue;
      const groups = [[], []];
      const queue = [first];
      color[first] = 1;
      while (queue.length) {
        const cell = queue.pop();
        groups[color[cell] - 1].push(cell);
        for (const next of links[cell]) {
          if (color[next]) continue;
          color[next] = 3 - color[cell];
          queue.push(next);
        }
      }
      if (groups[0].length + groups[1].length < 4) continue; // a lone pair is the locked candidates case
      const clash = groups.findIndex((group) => group.some((a, i) => group.some((b, j) => j > i && sees[a * cells + b])));
      if (clash >= 0) {
        for (const cell of groups[clash]) cand[cell] &= ~bit;
        progress = true;
        continue;
      }
      for (let cell = 0; cell < cells; cell++) {
        if (value[cell] || color[cell] || !(cand[cell] & bit)) continue;
        if (groups[0].some((g) => sees[cell * cells + g]) && groups[1].some((g) => sees[cell * cells + g])) {
          cand[cell] &= ~bit;
          progress = true;
        }
      }
    }
  }
  return progress;
}

// The techniques above Easy, cheapest first within each level. The solver tries them in this order and goes back
// to the singles as soon as one of them strikes a candidate.
const TECHNIQUES = [
  { level: 2, name: 'Locked candidates', run: lockedCandidates },
  { level: 3, name: 'Naked pair', run: (s) => nakedSets(s, 2) },
  { level: 3, name: 'Hidden pair', run: (s) => hiddenSets(s, 2) },
  { level: 3, name: 'Naked triple', run: (s) => nakedSets(s, 3) },
  { level: 3, name: 'Hidden triple', run: (s) => hiddenSets(s, 3) },
  { level: 3, name: 'Naked quad', run: (s) => nakedSets(s, 4) },
  { level: 3, name: 'Hidden quad', run: (s) => hiddenSets(s, 4) },
  { level: 4, name: 'X-Wing', run: (s) => fish(s, 2) },
  { level: 4, name: 'Simple coloring', run: coloring },
  { level: 4, name: 'XY-Wing', run: (s) => wings(s, false) },
  { level: 4, name: 'XYZ-Wing', run: (s) => wings(s, true) },
  { level: 4, name: 'Swordfish', run: (s) => fish(s, 3) },
  { level: 4, name: 'Jellyfish', run: (s) => fish(s, 4) },
];

/**
 * Works a puzzle out by logic alone, using the techniques up to `maxLevel` (1 Easy to 4 Expert). `puzzle` is a
 * list of the board's cells, 0 for empty. Returns whether it was solved, the hardest level it had to use, and the
 * values it reached, and the names of the techniques above Easy that it used. A harder technique is only tried when
 * every easier one is stuck, so `level` is the level the puzzle needs, not just one it happened to use.
 *
 * `target` is for the generator: stop as soon as that cell has a value (`solved` is then true even if other
 * cells are still empty).
 */
export function solve(shape, puzzle, maxLevel = 4, target = -1) {
  const state = start(shape, puzzle);
  let level = 1;
  const used = new Set();
  const done = () => (target >= 0 ? state.value[target] !== 0 : state.left === 0);
  while (!state.broken) {
    singles(state, target);
    if (state.broken || done()) break;
    let moved = false;
    for (const technique of TECHNIQUES) {
      if (technique.level > maxLevel) break;
      if (technique.run(state)) {
        if (technique.level > level) level = technique.level;
        used.add(technique.name);
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return { solved: !state.broken && done(), broken: state.broken, level, techniques: TECHNIQUES.filter((t) => used.has(t.name)).map((t) => t.name), values: Array.from(state.value) };
}

// ---------------------------------------------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------------------------------------------

/**
 * A whole valid grid, filled at random. It fills the cell with the fewest numbers left to choose from first and
 * backs up when a cell has none, which is quick on small boards. A big board can send that search down a long
 * dead end, so each try is capped; after a few capped tries it falls back to `patternGrid`, which cannot fail.
 */
export function fullGrid(shape, random) {
  const { side, cells } = shape;
  const boxOf = (cell) => Math.floor(Math.floor(cell / side) / shape.boxRows) * shape.boxRows + Math.floor((cell % side) / shape.boxCols);
  for (let attempt = 0; attempt < 8; attempt++) {
    const grid = new Array(cells).fill(0);
    const rowUsed = new Int32Array(side);
    const colUsed = new Int32Array(side);
    const boxUsed = new Int32Array(side);
    let budget = cells * 40;
    const fill = (filled) => {
      if (filled === cells) return true;
      let best = -1;
      let bestOptions = 0;
      let fewest = side + 1;
      for (let cell = 0; cell < cells; cell++) {
        if (grid[cell]) continue;
        const options = shape.all & ~(rowUsed[Math.floor(cell / side)] | colUsed[cell % side] | boxUsed[boxOf(cell)]);
        const n = count(options);
        if (n < fewest) {
          fewest = n;
          best = cell;
          bestOptions = options;
          if (n <= 1) break;
        }
      }
      if (fewest === 0) return false;
      const r = Math.floor(best / side);
      const c = best % side;
      const b = boxOf(best);
      const order = [];
      for (let o = bestOptions; o; o &= o - 1) order.push(o & -o);
      shuffle(order, random);
      for (const bit of order) {
        if (budget-- <= 0) return false;
        grid[best] = place(bit) + 1;
        rowUsed[r] |= bit;
        colUsed[c] |= bit;
        boxUsed[b] |= bit;
        if (fill(filled + 1)) return true;
        grid[best] = 0;
        rowUsed[r] &= ~bit;
        colUsed[c] &= ~bit;
        boxUsed[b] &= ~bit;
      }
      return false;
    };
    if (fill(0)) return grid;
  }
  return patternGrid(shape, random);
}

/**
 * A valid grid made without any search: start from the grid where each row is the one above shifted along, then
 * shuffle it in the ways that keep it valid (rename the numbers, reorder rows inside a band of boxes, reorder the
 * bands, and the same for columns). Used only when the random fill above gives up on a big board.
 */
export function patternGrid(shape, random) {
  const { side, boxRows, boxCols } = shape;
  const order = (group, groups) =>
    shuffle([...Array(groups).keys()], random).flatMap((g) => shuffle([...Array(group).keys()], random).map((i) => g * group + i));
  const rowOrder = order(boxRows, side / boxRows);
  const colOrder = order(boxCols, side / boxCols);
  const names = shuffle([...Array(side).keys()], random);
  const grid = [];
  for (const r of rowOrder) for (const c of colOrder) grid.push(names[(boxCols * (r % boxRows) + Math.floor(r / boxRows) + c) % side] + 1);
  return grid;
}

/**
 * Makes a puzzle. `size` is a size id from SIZES ('9'), `level` is 1 to 4, and `seed` is any text or number: the
 * same three always give the same puzzle.
 *
 * Returns the puzzle and its solution (lists of cell values, 0 for an empty cell), the number of clues, and
 * `level`, the level the puzzle really needs. That is the level asked for whenever the board can reach it (see
 * `levels` in SIZES). Not every grid can: about 1 grid in 10 can be dug down to a puzzle that needs an Expert
 * technique, so the generator keeps trying new grids, up to `tries` of them. If none reaches the level, as with
 * anything above Easy on a 4x4 board, the hardest puzzle found is returned and `level` says what it is.
 *
 * `onProgress` is called as the work goes on with { attempt, round, part }: which grid this is (from 1), which
 * round of clue removal (1 to `level`), and how far through that round (0 to 1). The page shows it on big boards.
 */
export function generate({ size = '9', level = 3, seed = Date.now(), tries, onProgress } = {}) {
  const info = sizeById(size);
  if (!info) throw new Error(`Unknown Sudoku size "${size}". Use one of: ${SIZES.map((s) => s.id).join(', ')}.`);
  if (!LEVELS.some((l) => l.level === level)) throw new Error(`Unknown Sudoku level "${level}". Use 1 (Easy) to 4 (Expert).`);
  const shape = geometry(info.boxRows, info.boxCols);
  const random = makeRandom(`${size}/${level}/${seed}`);
  const maxTries = tries ?? TRIES[info.id];

  let best = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const solution = fullGrid(shape, random);
    const puzzle = solution.slice();
    const order = shuffle([...Array(shape.cells).keys()], random);
    let reached = 1;
    for (let round = 1; round <= level; round++) {
      let removed = 0;
      for (let i = 0; i < order.length; i++) {
        const cell = order[i];
        if (!puzzle[cell]) continue;
        puzzle[cell] = 0;
        // If the solver can work this one cell out again, it is back where it was, and it finishes as before.
        if (solve(shape, puzzle, round, cell).solved) removed++;
        else puzzle[cell] = solution[cell];
        if (onProgress && i % 16 === 0) onProgress({ attempt, round, part: i / order.length });
      }
      // A round that removed a clue leaves a puzzle the round before could not finish, so it needs this level.
      if (removed > 0) reached = round;
    }
    const clues = puzzle.reduce((n, v) => n + (v ? 1 : 0), 0);
    if (!best || reached > best.level || (reached === best.level && clues < best.clues)) best = { puzzle, solution, level: reached, clues, attempts: attempt };
    if (reached === level) break;
  }
  return { size: info.id, boxRows: info.boxRows, boxCols: info.boxCols, side: shape.side, asked: level, seed: String(seed), ...best };
}

// How many grids `generate` tries before it settles for the hardest puzzle it found. Measured on 2026-11-11: about
// 1 try in 10 reaches Expert at every size from 9x9 up, and a try takes about 5 ms on 9x9, 70 ms on 16x16, and
// 700 ms on 25x25. These caps put the chance of falling short of Expert under 3 in 100 and keep the longest wait
// on the biggest board near half a minute. The 6x6 board is the odd one: a try takes a third of a millisecond,
// but only about 1 in 5,000 can be dug down to a puzzle that needs a Hard technique (the most it took in twelve
// runs was 13,222 tries, about three and a half seconds), so it gets a very high cap.
const TRIES = { 4: 20, 6: 40000, 9: 200, 12: 150, 16: 100, 20: 60, 25: 50 };
