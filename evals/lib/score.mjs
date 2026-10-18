// The scorer for the resume bullet eval (evals/resume-bullets/).
//
// It judges ONE piece of model output against the rules this site already enforces on resume bullets.
// The dash, phone, verb, weak-verb, count, and one-sentence rules come from src/lib/copy-rules.js, the
// same file the content schema and the add-resume-bullet skill use, so the rules live in one place.
// Two rules are specific to judging an AI draft: no invented numbers, and no leaked forbidden strings.
//
// This file is plain code with no network and no randomness. tests/bullet-eval-scorer.spec.ts proves
// it with fixed sample outputs, including bad outputs that must fail every rule.

import {
  noDashes,
  noPhone,
  startsWithPastTenseVerb,
  notWeakVerb,
  isBareOneSentence,
  countsAreFloors,
  COUNT_NOUNS,
} from '../../src/lib/copy-rules.js';

/** Numbers written with digits, with commas removed ("1,200" becomes "1200"). A trailing "+" is ignored. */
export const numbersIn = (/** @type {string} */ text) =>
  (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.$/, ''));

/** True when the text holds a count of a project thing, floored ("152+ issues") or not ("152 issues"). */
const hasProjectCount = (/** @type {string} */ text) =>
  new RegExp(String.raw`\d[\d,]*\+?(?:\s+[\w-]+){0,2}?\s+(?:${COUNT_NOUNS.join('|')})\b`, 'i').test(text);

/**
 * The rules checked in code. Each has an id (used in reports and tests), a short name, an `applies`
 * test (a rule that does not apply to an output is left out of that rule's pass rate, not counted as a
 * pass), and a `check` that returns { ok, detail }. `prompt` is the eval prompt the output answers:
 * { input: string, forbidden?: string[] }.
 */
export const RULES = [
  {
    id: 'single-hyphens',
    name: 'Single hyphens only (no em dash, en dash, or double hyphen)',
    applies: () => true,
    check: (output) => ({ ok: noDashes(output), detail: 'contains an em dash, an en dash, or a double hyphen' }),
  },
  {
    id: 'past-tense-verb',
    name: 'Opens with a past-tense verb',
    applies: () => true,
    check: (output) => ({ ok: startsWithPastTenseVerb(output.trim()), detail: `opens with "${output.trim().match(/^\S+/)?.[0] ?? ''}", not a past-tense verb` }),
  },
  {
    id: 'strong-verb',
    name: 'Opening verb is not a weak one (Reviewed, Asked, Helped, Worked)',
    applies: () => true,
    check: (output) => ({ ok: notWeakVerb(output.trim()), detail: `opens with the weak verb "${output.trim().match(/^[A-Za-z]+/)?.[0] ?? ''}"` }),
  },
  {
    id: 'bare-one-sentence',
    name: 'Bare text: one line, one sentence, no list marker, quotes, or lead-in',
    applies: () => true,
    check: (output) => ({ ok: isBareOneSentence(output), detail: 'is not a single bare sentence (several lines or sentences, a list marker, quotes, or a lead-in)' }),
  },
  {
    id: 'count-floor',
    name: 'Project counts are written as a floor with a plus sign ("152+ issues")',
    applies: (output) => hasProjectCount(output),
    check: (output) => ({ ok: countsAreFloors(output), detail: 'writes a project count as an exact figure instead of a floor' }),
  },
  {
    id: 'no-phone',
    name: 'No phone numbers',
    applies: () => true,
    check: (output) => ({ ok: noPhone(output), detail: 'contains a phone number' }),
  },
  {
    id: 'no-invented-numbers',
    name: 'No invented numbers: every number appears in the description it was given',
    applies: () => true,
    check: (output, prompt) => {
      const given = new Set(numbersIn(prompt.input));
      const invented = [...new Set(numbersIn(output).filter((n) => !given.has(n)))];
      return { ok: invented.length === 0, detail: `uses numbers that were not in the description: ${invented.join(', ')}` };
    },
  },
  {
    id: 'no-leaked-strings',
    name: 'Does not repeat strings it was told to keep out (a street address, a city)',
    applies: (_output, prompt) => (prompt.forbidden ?? []).length > 0,
    check: (output, prompt) => {
      const found = (prompt.forbidden ?? []).filter((f) => output.toLowerCase().includes(f.toLowerCase()));
      return { ok: found.length === 0, detail: `repeats "${found.join('", "')}"` };
    },
  },
];

/**
 * Rules that cannot be checked in code. They are listed in every report so nobody mistakes a clean
 * score for a fully reviewed bullet. A person reads a sample of the outputs for these.
 */
export const MANUAL_REVIEW = [
  'Faithful to the description: no tools, scope, or claims the description did not give.',
  'States an outcome only when the description gave one (a bullet for work with no result should not invent a result).',
  'Strong and clear: says what was changed or delivered, reads naturally, and would hold up in an interview.',
  'No confidential employer detail, and location only as "Atlanta area".',
  'Numbers written as words ("twelve", "two") match the description; only digits are checked in code.',
];

/**
 * Scores one output. `passed` is true when no rule that applies failed.
 * @param {string} output the model's reply
 * @param {{ input: string, forbidden?: string[] }} prompt
 * @returns {{ passed: boolean, results: { rule: string, status: 'pass' | 'fail' | 'n/a', detail?: string }[] }}
 */
export function scoreOutput(output, prompt) {
  const text = typeof output === 'string' ? output : '';
  const results = RULES.map((rule) => {
    if (!rule.applies(text, prompt)) return { rule: rule.id, status: 'n/a' };
    const { ok, detail } = rule.check(text, prompt);
    return ok ? { rule: rule.id, status: 'pass' } : { rule: rule.id, status: 'fail', detail };
  });
  // An empty reply is a failure of every rule that cares about the text, not a pass by default.
  if (!text.trim()) {
    return {
      passed: false,
      results: RULES.map((rule) => ({ rule: rule.id, status: rule.applies(text, prompt) ? 'fail' : 'n/a', detail: 'the reply is empty' })),
    };
  }
  return { passed: results.every((r) => r.status !== 'fail'), results };
}
