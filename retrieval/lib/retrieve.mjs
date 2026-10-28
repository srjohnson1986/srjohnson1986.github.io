// Retrieval: find the approved bullets closest in meaning to a description of work. Plain functions with
// no model of their own (the caller passes `embed`), so tests can use fixed vectors.

import { DEFAULT_K, MIN_SCORE } from '../config.mjs';

/** Cosine similarity of two vectors. Returns 0 for an empty or mismatched pair instead of NaN. */
export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * The entries closest to a query vector: at most k, each at or above minScore, best first (ties by id so
 * the order never changes between runs). Only entries whose source is in `sources` are considered, so a
 * writing rule is never returned as an example.
 * @param {number[]} vector
 * @param {{ id: string, source: string, text: string, vector: number[] }[]} entries
 */
export function rank(vector, entries, { k = DEFAULT_K, minScore = MIN_SCORE, sources = ['bullet'] } = {}) {
  return entries
    .filter((e) => sources.includes(e.source))
    .map((e) => ({ id: e.id, source: e.source, text: e.text, score: cosine(vector, e.vector) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k);
}

/**
 * Embeds the description and returns the closest approved bullets. It never throws: when retrieval cannot
 * help, it returns no results and a `fallback` reason, and logs it, so drafting can go on from the writing
 * rules alone.
 * @param {{ query: string, index: { items: object[] }, embed: (texts: string[]) => Promise<number[][]>, k?: number, minScore?: number, log?: (s: string) => void }} args
 * @returns {Promise<{ results: { id: string, source: string, text: string, score: number }[], fallback: string | null }>}
 */
export async function retrieve({ query, index, embed, k = DEFAULT_K, minScore = MIN_SCORE, log = console.warn }) {
  const fall = (reason) => {
    log(`retrieval fallback (${reason}): drafting from the writing rules alone`);
    return { results: [], fallback: reason };
  };
  if (!String(query ?? '').trim()) return fall('empty description');
  if (!index?.items?.some((e) => e.source === 'bullet')) return fall('the index has no bullets');

  let vector;
  try {
    [vector] = await embed([String(query).trim()]);
  } catch (error) {
    return fall(`embedding failed: ${error?.message ?? error}`);
  }
  const dimensions = index.items[0].vector.length;
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)) {
    return fall(`the query vector does not match the index (${dimensions} numbers expected)`);
  }

  const results = rank(vector, index.items, { k, minScore });
  return results.length ? { results, fallback: null } : fall(`no bullet scored ${minScore} or higher`);
}

/**
 * Recall at n over the fixed test queries: the share of queries with a known best bullet whose bullet is
 * among the n highest-scoring bullets. Queries with `expected: null` are left out. Needs no model: the
 * query vectors are committed.
 * @param {{ items: object[] }} queryVectors the entries of retrieval/query-vectors.json
 * @param {{ items: object[] }} index the entries of retrieval/embeddings.json
 */
export function recallAt(n, queryVectors, index) {
  const asked = queryVectors.items.filter((q) => q.expected);
  const rows = asked.map((q) => {
    const ranked = rank(q.vector, index.items, { k: Infinity, minScore: -1 });
    const position = ranked.findIndex((r) => r.id === q.expected) + 1;
    return { id: q.id, expected: q.expected, position: position || null, hit: position > 0 && position <= n };
  });
  return { recall: asked.length ? rows.filter((r) => r.hit).length / asked.length : 0, asked: asked.length, hits: rows.filter((r) => r.hit).length, rows };
}
