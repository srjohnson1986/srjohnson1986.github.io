// The copy check: a draft that repeats a retrieved bullet word for word has not been written from the
// description. Words are compared, not characters, so a changed comma or capital letter does not hide a copy.

import { COPY_THRESHOLD } from '../config.mjs';

const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []);

/**
 * The share of the shorter text's distinct words that also appear in the other text (0 to 1). Measured
 * against the shorter text, so both a full copy and a copy of a part are caught.
 */
export function overlap(a, b) {
  const wa = words(a);
  const wb = words(b);
  const smaller = Math.min(wa.size, wb.size);
  if (!smaller) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / smaller;
}

/**
 * The retrieved bullets a draft copies: those it shares more than `threshold` of its words with.
 * @param {string} draft
 * @param {{ id: string, text: string }[]} examples
 * @returns {{ id: string, overlap: number }[]}
 */
export function findCopies(draft, examples, threshold = COPY_THRESHOLD) {
  return examples.map((e) => ({ id: e.id, overlap: overlap(draft, e.text) })).filter((r) => r.overlap > threshold);
}
