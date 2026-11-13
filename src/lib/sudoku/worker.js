// Makes a Sudoku puzzle off the page's main thread. A web worker is a second script that runs alongside the page,
// so a 25x25 Expert puzzle that takes several seconds to make never freezes the board, the buttons, or scrolling.
//
// The page sends { size, level, seed }. This sends back { type: 'progress', attempt, round, part } a few times a
// second while it works, then { type: 'done', result } with the puzzle.
import { generate } from './engine.js';

self.onmessage = (event) => {
  const { size, level, seed } = event.data;
  let last = 0;
  const result = generate({
    size,
    level,
    seed,
    onProgress: (step) => {
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      self.postMessage({ type: 'progress', ...step });
    },
  });
  self.postMessage({ type: 'done', result });
};
