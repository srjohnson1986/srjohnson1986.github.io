// The Sudoku page's script: it asks the engine for a puzzle, draws the board, and handles play. The page
// (src/pages/sudoku.astro) holds the HTML this script fills in and the styles.
//
// What it keeps in memory for the puzzle on screen: the value in each square (0 for empty), which squares are
// clues, and each empty square's candidate marks as bits of one number (bit 0 is the number 1), the same way the
// engine keeps them. Every change goes through one function (change), which redraws the squares it touched,
// repaints the highlights, remembers the move so it can be undone, and saves the board in the browser.
import { SIZES, LEVELS, geometry, generate, sizeById } from './engine.js';

interface Puzzle {
  size: string;
  boxRows: number;
  boxCols: number;
  side: number;
  asked: number;
  level: number;
  clues: number;
  attempts: number;
  puzzle: number[];
  solution: number[];
}
interface Shape {
  cells: number;
  units: number[][];
  peers: number[][];
}
interface Level {
  level: number;
  id: string;
  label: string;
}

/** One square as it was before a move: what Undo puts back. */
interface Before {
  cell: number;
  value: number;
  notes: number;
}
/** One move: the squares it changed, and the square it was made in (-1 for a move on the whole board). */
interface Move {
  at: number;
  squares: Before[];
}
/** A board saved in the browser: every square's number and candidate marks, when, and whether it was finished. */
interface Saved {
  values: number[];
  notes: number[];
  at: number;
  done: boolean;
}
interface Store {
  last?: string;
  games: Record<string, Saved>;
}

const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3];
const levels = LEVELS as Level[];
const SEED = /^[A-Za-z0-9_-]{1,40}$/;

// Saved progress lives in the browser's localStorage, under this one name, and never leaves the browser. It holds
// the last few puzzles played, each under "size/level/seed" (the same three things that are in the address), and
// which of them was played last. Reading and writing are wrapped in try/catch because a browser can refuse both
// (private windows, blocked site data, full storage), and the game must still work without it.
const STORE = 'sudoku-progress-v1';
const KEPT = 12;

function readStore(): Store {
  try {
    const store = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (store && typeof store === 'object' && store.games && typeof store.games === 'object' && !Array.isArray(store.games)) return store as Store;
  } catch {
    // Nothing saved that can be read: start with nothing.
  }
  return { games: {} };
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    // Not saved this time. The game carries on.
  }
}

/** The size, level, and seed a saved board's name stands for, or null if it is not one this page can make. */
function parseKey(key: string | undefined): { size: string; level: string; seed: string } | null {
  const [size, level, seed, ...more] = (typeof key === 'string' ? key : '').split('/');
  const info = sizeById(size);
  const found = levels.find((l) => l.id === level);
  return info && found && info.levels.includes(found.level) && SEED.test(seed ?? '') && more.length === 0 ? { size, level, seed } : null;
}

const root = document.querySelector<HTMLElement>('[data-sudoku]');
if (root) setUp(root);

function setUp(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-setup]')!;
  const sizeSelect = form.querySelector<HTMLSelectElement>('select[name="size"]')!;
  const levelSelect = form.querySelector<HTMLSelectElement>('select[name="level"]')!;
  const levelNote = root.querySelector<HTMLElement>('[data-level-note]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const progress = root.querySelector<HTMLElement>('[data-progress]')!;
  const game = root.querySelector<HTMLElement>('[data-game]')!;
  const board = root.querySelector<HTMLElement>('[data-board]')!;
  const pad = root.querySelector<HTMLElement>('[data-pad]')!;
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;

  let shape: Shape = geometry(3, 3);
  let side = 9;
  let boxCols = 3;
  let values: number[] = [];
  let notes: number[] = [];
  let given: boolean[] = [];
  let cells: HTMLElement[] = [];
  let selected = -1; // the square that is selected, or -1
  let tabStop = 0; // the one square the Tab key lands on (the others are reached with the arrow keys)
  let noteMode = false;
  let zoom = 0;
  let worker: Worker | null = null;
  let current: Puzzle | null = null;
  let key = ''; // the name the puzzle on screen is saved under: "size/level/seed"
  let madeLine = ''; // the line that describes the puzzle on screen, shown again when a solved board is reopened
  let undoStack: Move[] = [];
  // The first digit of a two-digit number, kept for a moment while the second may still be typed.
  let pending = 0;
  let pendingTimer = 0;

  const say = (text: string) => {
    status.textContent = text;
  };
  const labelOf = (level: number) => levels.find((l) => l.level === level)!.label;

  // ---------------------------------------------------------------------------------------------------------
  // Choosing and making a puzzle
  // ---------------------------------------------------------------------------------------------------------

  /** Greys out the levels the chosen board cannot reach (a 4x4 board is Easy only) and says why. */
  function syncLevels() {
    const info = sizeById(sizeSelect.value);
    for (const option of levelSelect.options) option.disabled = !info.levels.includes(levels.find((l) => l.id === option.value)!.level);
    if (levelSelect.selectedOptions[0]?.disabled) levelSelect.value = levels.filter((l) => info.levels.includes(l.level)).at(-1)!.id;
    levelNote.hidden = info.levels.length === levels.length;
    levelNote.textContent = levelNote.hidden ? '' : `A ${info.label} board is too small for anything above ${labelOf(Math.max(...info.levels))}.`;
  }

  const newSeed = () => Math.random().toString(36).slice(2, 10) || 'sudoku';

  /**
   * Makes a puzzle in a web worker and shows it. The size, level, and seed go into the address first, so a reload
   * or a shared link brings back the same puzzle. If the browser cannot start the worker, the puzzle is made
   * here on the page instead, which freezes the page for a moment on a big board but still works.
   */
  function make(sizeId: string, levelId: string, seed: string) {
    worker?.terminate();
    worker = null;
    const info = sizeById(sizeId);
    const level = levels.find((l) => l.id === levelId)!;
    const address = new URL(location.href);
    address.search = new URLSearchParams({ size: sizeId, level: levelId, seed }).toString();
    history.replaceState(null, '', address);
    key = `${sizeId}/${levelId}/${seed}`;

    root.setAttribute('aria-busy', 'true');
    progress.textContent = '';
    say(`Making a ${info.label} ${level.label} puzzle.`);
    const request = { size: sizeId, level: level.level, seed };
    const onThisPage = () => window.setTimeout(() => show(generate(request) as Puzzle), 30);
    try {
      const started = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker = started;
      started.onmessage = (event) => {
        if (worker !== started) return; // an older request that a newer one replaced
        if (event.data.type === 'progress') {
          progress.textContent = `Try ${event.data.attempt}, round ${event.data.round} of ${level.level}.`;
          return;
        }
        started.terminate();
        worker = null;
        show(event.data.result as Puzzle);
      };
      started.onerror = () => {
        if (worker !== started) return;
        started.terminate();
        worker = null;
        onThisPage();
      };
      started.postMessage(request);
    } catch {
      onThisPage();
    }
  }

  /** Puts a finished puzzle on the page. */
  function show(puzzle: Puzzle) {
    current = puzzle;
    shape = geometry(puzzle.boxRows, puzzle.boxCols);
    side = puzzle.side;
    boxCols = puzzle.boxCols;
    values = puzzle.puzzle.slice();
    given = values.map((v) => v !== 0);
    notes = new Array(shape.cells).fill(0);
    selected = -1;
    tabStop = 0;
    pending = 0;
    undoStack = [];
    const saved = savedBoard(puzzle);
    if (saved) {
      values = saved.values.slice();
      notes = saved.notes.slice();
    }

    root.style.setProperty('--side', String(side));
    root.style.setProperty('--box-rows', String(puzzle.boxRows));
    root.style.setProperty('--box-cols', String(puzzle.boxCols));
    // How big a candidate mark is, as a share of its square: small enough for the box's longer side to fit, and
    // smaller again when the numbers have two digits.
    root.style.setProperty('--note-scale', String(1 / (Math.max(puzzle.boxRows, puzzle.boxCols) * (side > 9 ? 1.5 : 1.2))));
    root.classList.toggle('sdk-two-digit', side > 9);
    root.classList.remove('is-solved');
    root.dataset.size = puzzle.size;
    root.dataset.level = levels.find((l) => l.level === puzzle.level)!.id;

    board.setAttribute('aria-label', `Sudoku board, ${side} by ${side}`);
    cells = [];
    const rows = document.createDocumentFragment();
    for (let r = 0; r < side; r++) {
      const row = document.createElement('div');
      row.className = 'sdk-row';
      row.setAttribute('role', 'row');
      for (let c = 0; c < side; c++) {
        const cell = document.createElement('div');
        cell.className = 'sdk-cell';
        cell.setAttribute('role', 'gridcell');
        cell.dataset.cell = String(cells.length);
        cell.tabIndex = cells.length === 0 ? 0 : -1;
        if ((c + 1) % puzzle.boxCols === 0 && c + 1 < side) cell.classList.add('box-right');
        if ((r + 1) % puzzle.boxRows === 0 && r + 1 < side) cell.classList.add('box-bottom');
        cells.push(cell);
        row.append(cell);
      }
      rows.append(row);
    }
    board.replaceChildren(rows);
    for (let i = 0; i < cells.length; i++) draw(i);

    pad.replaceChildren(
      ...Array.from({ length: side }, (_, i) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'sdk-key';
        key.dataset.number = String(i + 1);
        key.textContent = String(i + 1);
        return key;
      }),
    );

    paint();
    game.hidden = false;
    root.removeAttribute('aria-busy');
    progress.textContent = '';
    syncTools();
    const solvedAlready = root.classList.contains('is-solved'); // a finished board that was saved: paint has said so
    madeLine = `${sizeById(puzzle.size).label} ${labelOf(puzzle.level)} puzzle: ${puzzle.clues} clues, ${shape.cells - puzzle.clues} squares to fill.`;
    if (solvedAlready) return;
    say(
      puzzle.level < puzzle.asked
        ? `No ${labelOf(puzzle.asked)} puzzle turned up in ${puzzle.attempts} tries, so this one is ${labelOf(puzzle.level)}. New puzzle tries again. ${madeLine}`
        : saved
          ? `${madeLine} Picked up where you left off.`
          : madeLine,
    );
  }

  // ---------------------------------------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------------------------------------

  /**
   * The saved board for a puzzle, if there is one and it can be trusted. It is checked against the puzzle before
   * it is used, because storage can hold anything: an older version's data, a hand-edited value, or a board from
   * a puzzle that this seed no longer makes. Every clue must be in place and every number and mark must fit.
   */
  function savedBoard(puzzle: Puzzle): Saved | null {
    const saved = readStore().games[key];
    const count = puzzle.side * puzzle.side;
    const whole = (list: unknown): list is number[] => Array.isArray(list) && list.length === count && list.every((n) => Number.isInteger(n) && n >= 0);
    if (!saved || typeof saved !== 'object' || !whole(saved.values) || !whole(saved.notes)) return null;
    const fits = puzzle.puzzle.every((clue, i) => {
      if (clue) return saved.values[i] === clue && saved.notes[i] === 0;
      return saved.values[i] <= puzzle.side && saved.notes[i] < 2 ** puzzle.side && (saved.values[i] === 0 || saved.notes[i] === 0);
    });
    return fits ? saved : null;
  }

  /**
   * Saves the board on screen. A board with nothing entered is not kept (there is nothing to pick up), and only
   * the most recently played puzzles are kept, so the storage cannot grow without limit.
   */
  function save() {
    if (!current) return;
    const store = readStore();
    const touched = values.some((v, i) => v !== 0 && !given[i]) || notes.some((n) => n !== 0);
    if (touched) {
      store.games[key] = { values: values.slice(), notes: notes.slice(), at: Date.now(), done: root.classList.contains('is-solved') };
      store.last = key;
    } else {
      delete store.games[key];
      if (store.last === key) delete store.last;
    }
    const newestFirst = Object.entries(store.games).sort((a, b) => (Number(b[1]?.at) || 0) - (Number(a[1]?.at) || 0));
    store.games = Object.fromEntries(newestFirst.slice(0, KEPT));
    writeStore(store);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------------------------------------

  /** Redraws one square: its number, or its candidate marks, and the words a screen reader says for it. */
  function draw(i: number) {
    const cell = cells[i];
    const v = values[i];
    let label = `Row ${Math.floor(i / side) + 1}, column ${(i % side) + 1}: `;
    cell.replaceChildren();
    cell.classList.toggle('is-given', given[i]);
    cell.classList.toggle('is-entry', !given[i] && v !== 0);
    if (given[i]) cell.setAttribute('aria-readonly', 'true');
    if (v) {
      const value = document.createElement('span');
      value.className = 'sdk-value';
      value.textContent = String(v);
      cell.append(value);
      cell.dataset.value = String(v);
      label += given[i] ? `${v}, a clue` : String(v);
    } else {
      delete cell.dataset.value;
      const marked: number[] = [];
      for (let n = 1; n <= side; n++) if (notes[i] & (1 << (n - 1))) marked.push(n);
      if (marked.length) {
        // Each mark sits where its number would be if the square were a tiny copy of a box: 1 top left, and so on.
        const wrap = document.createElement('span');
        wrap.className = 'sdk-notes';
        wrap.setAttribute('aria-hidden', 'true');
        for (const n of marked) {
          const mark = document.createElement('span');
          mark.className = 'sdk-note';
          mark.dataset.note = String(n);
          mark.textContent = String(n);
          mark.style.gridRow = String(Math.floor((n - 1) / boxCols) + 1);
          mark.style.gridColumn = String(((n - 1) % boxCols) + 1);
          // The space keeps the marks apart as text ("3 7", not "37"). It takes no room in the layout.
          wrap.append(mark, ' ');
        }
        cell.append(wrap);
        // The label lists the marks exactly as they read on screen. Voice control software matches what a person
        // says against the label, so the visible text has to be part of it (the accessibility scan checks this).
        label += `empty, candidates ${marked.join(' ')}`;
      } else label += 'empty';
    }
    cell.setAttribute('aria-label', label);
  }

  /** The squares whose number appears twice in a row, column, or box. */
  function clashes(): Set<number> {
    const found = new Set<number>();
    for (const unit of shape.units) {
      const first = new Map<number, number>();
      for (const cell of unit) {
        const v = values[cell];
        if (!v) continue;
        const earlier = first.get(v);
        if (earlier === undefined) first.set(v, cell);
        else found.add(earlier).add(cell);
      }
    }
    return found;
  }

  /**
   * Repaints the highlights after any change. When the selected square holds a number, every other square with
   * that number is highlighted and that number is made bold wherever it is marked as a candidate.
   */
  function paint() {
    const match = selected >= 0 ? values[selected] : 0;
    const clash = clashes();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      cell.classList.toggle('is-selected', i === selected);
      cell.classList.toggle('is-same', match !== 0 && values[i] === match && i !== selected);
      cell.classList.toggle('is-clash', clash.has(i));
      cell.setAttribute('aria-selected', String(i === selected));
      if (clash.has(i)) cell.setAttribute('aria-invalid', 'true');
      else cell.removeAttribute('aria-invalid');
      for (const mark of cell.querySelectorAll<HTMLElement>('.sdk-note')) mark.classList.toggle('is-match', match !== 0 && Number(mark.dataset.note) === match);
    }
    const solved = clash.size === 0 && values.every((v) => v !== 0);
    const was = root.classList.contains('is-solved');
    if (solved && !was && current) say(`Solved. That was a ${sizeById(current.size).label} ${labelOf(current.level)} puzzle. Well done.`);
    if (!solved && was) say(madeLine); // a move was taken back, so it is a puzzle again
    root.classList.toggle('is-solved', solved);
  }

  /** Undo is only on offer when there is a move to take back. */
  function syncTools() {
    button('undo').disabled = undoStack.length === 0;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------------------------------------------

  function select(i: number, focus = true) {
    commitPending();
    cells[tabStop].tabIndex = -1;
    selected = tabStop = i;
    cells[i].tabIndex = 0;
    if (focus) cells[i].focus();
    cells[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    paint();
  }

  /**
   * Every move goes through here. `squares` lists the squares the move may touch and `apply` makes the move. The
   * squares that really changed are redrawn and remembered as one step for Undo, and the board is saved. `at` is
   * the square the move was made in, which Undo selects again (-1 for a move on the whole board).
   */
  function change(at: number, squares: number[], apply: () => void) {
    const before: Before[] = squares.map((cell) => ({ cell, value: values[cell], notes: notes[cell] }));
    apply();
    const changed = before.filter((b) => values[b.cell] !== b.value || notes[b.cell] !== b.notes);
    if (changed.length === 0) return;
    undoStack.push({ at, squares: changed });
    for (const b of changed) draw(b.cell);
    paint();
    syncTools();
    save();
  }

  /** Puts a number in the selected square, or in Candidates mode marks or unmarks it there. Clues never change. */
  function enter(n: number) {
    if (selected < 0) {
      say('Pick a square first, then a number.');
      return;
    }
    if (given[selected] || n < 1 || n > side) return;
    const at = selected;
    const bit = 1 << (n - 1);
    if (noteMode) {
      if (!values[at]) change(at, [at], () => (notes[at] ^= bit));
    } else if (values[at] === n) {
      change(at, [at], () => (values[at] = 0)); // the same number again takes it back out
    } else {
      change(at, [at, ...shape.peers[at]], () => {
        values[at] = n;
        notes[at] = 0;
        // The number is now used in this row, column, and box, so its marks there are out of date.
        for (const peer of shape.peers[at]) notes[peer] &= ~bit;
      });
    }
  }

  function erase() {
    if (selected < 0 || given[selected]) return;
    const at = selected;
    change(at, [at], () => {
      values[at] = 0;
      notes[at] = 0;
    });
  }

  const everySquare = () => [...cells.keys()];

  /** Marks, in every empty square, each number not already placed in its row, column, or box. */
  function fillCandidates() {
    const all = 2 ** side - 1;
    change(-1, everySquare(), () => {
      for (let i = 0; i < cells.length; i++) {
        if (values[i]) continue;
        let open = all;
        for (const peer of shape.peers[i]) if (values[peer]) open &= ~(1 << (values[peer] - 1));
        notes[i] = open;
      }
    });
  }

  /** Clears every number and mark the visitor entered, leaving the clues. It is a move like any other, so Undo brings it all back. */
  function startOver() {
    commitPending();
    change(-1, everySquare(), () => {
      for (let i = 0; i < cells.length; i++) {
        if (!given[i]) values[i] = 0;
        notes[i] = 0;
      }
    });
  }

  /** Takes back the newest move: puts its squares back as they were, and selects the square it was made in. */
  function undo() {
    commitPending();
    const move = undoStack.pop();
    if (!move) return;
    for (const b of move.squares) {
      values[b.cell] = b.value;
      notes[b.cell] = b.notes;
      draw(b.cell);
    }
    syncTools();
    // Keep the keyboard on the board if it was there, and leave it on the button if that was pressed.
    if (move.at >= 0) select(move.at, board.contains(document.activeElement));
    else paint();
    save();
  }

  function setNoteMode(on: boolean) {
    noteMode = on;
    button('candidates').setAttribute('aria-pressed', String(on));
    root.classList.toggle('is-noting', on);
  }

  function setZoom(index: number) {
    zoom = Math.max(0, Math.min(ZOOMS.length - 1, index));
    root.style.setProperty('--zoom', String(ZOOMS[zoom]));
    root.classList.toggle('is-zoomed', zoom > 0);
    button('smaller').disabled = zoom === 0;
    button('larger').disabled = zoom === ZOOMS.length - 1;
    if (selected >= 0) cells[selected].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * A typed digit. On boards above 9x9 a number can have two digits, so a digit that could start one (the 1 of
   * 12) waits a moment for a second digit before it counts on its own.
   */
  function typeDigit(d: number) {
    if (pending) {
      const both = pending * 10 + d;
      const first = pending;
      window.clearTimeout(pendingTimer);
      pending = 0;
      if (both <= side) {
        enter(both);
        return;
      }
      enter(first);
    }
    if (d === 0) return;
    if (side > 9 && d * 10 <= side) {
      pending = d;
      pendingTimer = window.setTimeout(commitPending, 700);
      return;
    }
    enter(d);
  }

  function commitPending() {
    if (!pending) return;
    const first = pending;
    window.clearTimeout(pendingTimer);
    pending = 0;
    enter(first);
  }

  const cellOf = (target: EventTarget | null) => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('.sdk-cell');
    return cell ? Number(cell.dataset.cell) : -1;
  };

  board.addEventListener('click', (event) => {
    const i = cellOf(event.target);
    if (i >= 0) select(i);
  });
  // Tabbing into the board selects the square the focus lands on, so the highlights follow the keyboard too.
  board.addEventListener('focusin', (event) => {
    const i = cellOf(event.target);
    if (i >= 0 && i !== selected) select(i, false);
  });
  board.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const at = selected >= 0 ? selected : tabStop;
    const r = Math.floor(at / side);
    const c = at % side;
    const moves: Record<string, number> = {
      ArrowUp: r > 0 ? at - side : at,
      ArrowDown: r < side - 1 ? at + side : at,
      ArrowLeft: c > 0 ? at - 1 : at,
      ArrowRight: c < side - 1 ? at + 1 : at,
      Home: at - c,
      End: at - c + side - 1,
    };
    if (event.key in moves) select(moves[event.key]);
    else if (/^[0-9]$/.test(event.key)) typeDigit(Number(event.key));
    else if (event.key === 'Backspace' || event.key === 'Delete') erase();
    else if (event.key === 'c' || event.key === 'C') setNoteMode(!noteMode);
    else if (event.key === 'Escape') {
      commitPending();
      selected = -1;
      paint();
    } else return;
    event.preventDefault();
  });

  pad.addEventListener('click', (event) => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('.sdk-key');
    if (!key) return;
    commitPending();
    enter(Number(key.dataset.number));
  });
  button('candidates').addEventListener('click', () => setNoteMode(!noteMode));
  button('fill').addEventListener('click', fillCandidates);
  button('erase').addEventListener('click', () => {
    commitPending();
    erase();
  });
  button('undo').addEventListener('click', undo);
  button('start-over').addEventListener('click', startOver);
  // Ctrl+Z, or Cmd+Z on a Mac, anywhere in the game: on the board, the number pad, or the buttons.
  root.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    undo();
  });
  button('smaller').addEventListener('click', () => setZoom(zoom - 1));
  button('larger').addEventListener('click', () => setZoom(zoom + 1));

  sizeSelect.addEventListener('change', syncLevels);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    make(sizeSelect.value, levelSelect.value, newSeed());
  });

  // The first puzzle. An address that names one wins. With nothing in the address, go back to the puzzle played
  // last, or, if that one was finished, start a new one of the same board and level. Failing all that, a 9x9
  // Hard puzzle with a fresh seed.
  const asked = new URLSearchParams(location.search);
  const store = readStore();
  const last = ['size', 'level', 'seed'].some((name) => asked.has(name)) ? null : parseKey(store.last);
  const lastDone = Boolean(last && store.games[store.last!]?.done);
  const wantedSize = last?.size ?? asked.get('size');
  const wantedLevel = last?.level ?? asked.get('level');
  const size = (SIZES as { id: string }[]).some((s) => s.id === wantedSize) ? wantedSize! : '9';
  sizeSelect.value = size;
  if (levels.some((l) => l.id === wantedLevel)) levelSelect.value = wantedLevel!;
  syncLevels();
  setZoom(0);
  const seed = (last && !lastDone ? last.seed : asked.get('seed')) ?? '';
  make(size, levelSelect.value, SEED.test(seed) ? seed : newSeed());
}
