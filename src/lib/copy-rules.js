// The copy rules that the content schema (src/content.config.ts) enforces on public text. They live
// here, in plain JavaScript, so the schema and the add-resume-bullet skill's check script
// (.claude/skills/add-resume-bullet/check-bullet.mjs) run the very same code and cannot disagree.

const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

/** No em dashes, en dashes, or double hyphens. */
export const noDashes = (/** @type {string} */ s) => !s.includes(EN_DASH) && !s.includes(EM_DASH) && !s.includes('--');

/** No US-style phone numbers. */
export const noPhone = (/** @type {string} */ s) => !/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(s);

// Resume bullets start with a past-tense verb ("Built", "Led"...). Regular verbs end in
// "ed"; the short list below covers the irregular ones. Add to it if a valid verb is rejected.
export const IRREGULAR_PAST = new Set([
  'Built', 'Led', 'Wrote', 'Set', 'Kept', 'Split', 'Ran', 'Held', 'Made', 'Taught', 'Drove', 'Won', 'Sent', 'Brought', 'Caught',
]);

export const startsWithPastTenseVerb = (/** @type {string} */ s) => {
  const word = s.match(/^[A-Za-z]+/)?.[0] ?? '';
  return /^[A-Z][a-z]+ed$/.test(word) || IRREGULAR_PAST.has(word);
};

// ---- Rules added for the add-resume-bullet skill and the AI bullet eval ---------------------------
// The content schema does not enforce these (yet). They live here, with the rules above, so the skill
// and the eval (evals/) judge a bullet by the same code.

// Past-tense verbs that pass the shape check above but are not strong action verbs.
export const WEAK_VERBS = ['reviewed', 'asked', 'helped', 'worked'];

/** The opening verb is not on the weak list. */
export const notWeakVerb = (/** @type {string} */ s) => !WEAK_VERBS.includes((s.match(/^[A-Za-z]+/)?.[0] ?? '').toLowerCase());

// Things a project accumulates over time. A count of these is a floor ("152+ issues"), not an exact figure.
export const COUNT_NOUNS = ['issues', 'pull requests', 'PRs', 'commits', 'releases', 'tests', 'test cases', 'merges', 'updates', 'changes', 'defects', 'tickets'];

/**
 * Counts of project things that are written as an exact figure ("152 issues") instead of a floor
 * ("152+ issues"). Returns one entry per count: the whole phrase, the number, any words between the
 * number and the noun, and the noun.
 * @param {string} text
 * @returns {{ phrase: string, number: string, between: string, noun: string }[]}
 */
export const unflooredCounts = (text) => {
  // String.raw keeps the backslashes, so the pattern reads exactly as it is written.
  const pattern = new RegExp(String.raw`(?<![\w$.,])(\d[\d,]*)(?![\d,+])((?:\s+[\w-]+){0,2}?)\s+(${COUNT_NOUNS.join('|')})\b`, 'gi');
  return [...text.matchAll(pattern)].map((m) => ({ phrase: m[0], number: m[1], between: m[2], noun: m[3] }));
};

/** Every project count is written as a floor with a plus sign. */
export const countsAreFloors = (/** @type {string} */ s) => unflooredCounts(s).length === 0;

/**
 * Bare, single-sentence text: one line, one sentence, no list marker, wrapping quotes, markdown bold,
 * or lead-in such as "Here is a bullet". This is what an AI draft must be so it can be pasted in as is.
 */
export const isBareOneSentence = (/** @type {string} */ s) => {
  const t = s.trim();
  if (!t || /[\r\n]/.test(t)) return false;
  if (/^([-*\u2022]|\d+[.)])\s/.test(t)) return false;
  if (/^["'\u201c\u2018`]/.test(t) || /["'\u201d\u2019`]$/.test(t)) return false;
  if (t.includes('**')) return false;
  if (/^(here|sure|certainly|of course|okay|ok)\b/i.test(t)) return false;
  if (/[?!]/.test(t)) return false;
  // A full stop followed by more text is a second sentence. One closing full stop is fine.
  return !/\.\s+\S/.test(t);
};
