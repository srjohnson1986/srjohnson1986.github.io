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
