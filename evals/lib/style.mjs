// Style signals for the bullet eval. They describe how drafts read next to the approved bullets. They are
// reported next to the pass rates and never decide pass or fail: a higher or lower number is not
// automatically better, it is something for a person to read.

/** The first word of a bullet, lowercased ("Built a thing" gives "built"). */
export const openingWord = (text) => (String(text).trim().match(/^[A-Za-z]+/)?.[0] ?? '').toLowerCase();

export const wordCount = (text) => (String(text).match(/\S+/g) ?? []).length;

export const mean = (numbers) => (numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null);

/** The set of opening words used by the approved bullets. */
export const openersOf = (bulletTexts) => new Set(bulletTexts.map(openingWord).filter(Boolean));

/**
 * @param {string[]} outputs every draft of one mode
 * @param {Set<string>} openers the opening words of the approved bullets
 * @returns {{ drafts: number, verbReuse: number | null, distinctVerbs: number, avgWords: number | null }}
 *   verbReuse is the share of drafts whose opening word already opens an approved bullet
 */
export function styleSignals(outputs, openers) {
  const verbs = outputs.map(openingWord).filter(Boolean);
  return {
    drafts: outputs.length,
    verbReuse: verbs.length ? verbs.filter((v) => openers.has(v)).length / verbs.length : null,
    distinctVerbs: new Set(verbs).size,
    avgWords: mean(outputs.map(wordCount)),
  };
}
