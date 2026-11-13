// The Sudoku page's settings: what can be chosen, the words shown for each choice, and what is chosen at first.
//
// This list is the one place a setting is written down. The page builds its Settings panel from it, the board
// script reads and saves the choices with it, and the tests read it too. To add a setting, add it here and write
// the CSS that acts on it: each setting becomes an attribute on the game's outer element, such as
// data-emphasis="bolder", and the page's stylesheet keys off that attribute.

export const SETTINGS = [
  {
    // How the candidate marks of the selected number stand out. Bold is weight 700, Bolder is the site font's
    // heaviest weight (800), and Boldest is that weight with a thin outline. See .sdk-note.is-match in sudoku.astro.
    id: 'emphasis',
    label: "How bold the selected number's candidates are",
    first: 'bolder',
    options: [
      { id: 'bold', label: 'Bold' },
      { id: 'bolder', label: 'Bolder' },
      { id: 'boldest', label: 'Boldest' },
    ],
  },
];

/** The name the choices are saved under in the browser's localStorage, apart from saved progress. */
export const SETTINGS_STORE = 'sudoku-settings-v1';

/**
 * The choices to use, given the text read from storage (or null when there is none). Storage can hold anything,
 * so whatever is missing, unknown, or unreadable is replaced by that setting's first choice. Returns an object
 * with one entry per setting, such as { emphasis: 'bolder' }.
 */
export function chosen(savedText) {
  let saved = null;
  try {
    saved = JSON.parse(savedText ?? 'null');
  } catch {
    // Not JSON: use the first choices.
  }
  const usable = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return Object.fromEntries(SETTINGS.map((s) => [s.id, s.options.some((o) => o.id === usable[s.id]) ? usable[s.id] : s.first]));
}
