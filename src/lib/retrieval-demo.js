// What the retrieval example page (src/pages/development-qa/this-site/retrieval.astro) shows, worked out at
// build time from the committed vectors. It is plain JavaScript with no Astro imports, so the page and
// tests/retrieval-page.spec.ts can run the same code. It reads three files and nothing else:
//   retrieval/embeddings.json      the public bullets (and rules, which are never shown)
//   retrieval/query-vectors.json   the 13 fixed test queries, with the bullet each should find
// No model runs here and nothing is fetched: the scores were fixed when `npm run embeddings` ran.

import fs from 'node:fs';
import path from 'node:path';
import { INDEX_FILE, QUERY_VECTORS_FILE, DEFAULT_K, MIN_SCORE } from '../../retrieval/config.mjs';
import { rank, recallAt } from '../../retrieval/lib/retrieve.mjs';

/** The scores are shown to two decimals, the way the page prints them. */
export const showScore = (/** @type {number} */ score) => score.toFixed(2);

const readEntries = (/** @type {string} */ root, /** @type {string} */ file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).items;

/**
 * @typedef {{ id: string, text: string, score: number, isExpected: boolean }} Pick
 * @typedef {{ id: string, query: string, expected: string | null, expectedText: string | null, expectedPosition: number | null, expectedScore: number | null, picks: Pick[], status: string }} DemoQuery
 */

/**
 * @param {string} [root] the repository root (the build runs from it)
 * @returns {{ k: number, minScore: number, recall: { hits: number, asked: number, rate: number, needed: number }, queries: DemoQuery[], misses: DemoQuery[] }}
 */
export function buildRetrievalDemo(root = process.cwd()) {
  const index = { items: readEntries(root, INDEX_FILE) };
  const queries = readEntries(root, QUERY_VECTORS_FILE);
  const byId = new Map(index.items.map((e) => [e.id, e]));
  const recall = recallAt(3, { items: queries }, index);
  const positions = new Map(recall.rows.map((r) => [r.id, r]));

  const built = queries.map((q) => {
    const picks = rank(q.vector, index.items).map((r) => ({ id: r.id, text: r.text, score: r.score, isExpected: r.id === q.expected }));
    const row = positions.get(q.id);
    const everything = q.expected ? rank(q.vector, index.items, { k: Infinity, minScore: -1 }) : [];
    const expectedScore = q.expected ? (everything.find((r) => r.id === q.expected)?.score ?? null) : null;
    const position = row?.position ?? null;

    let status;
    if (!q.expected) status = picks.length ? `Off topic, but ${picks.length} bullet${picks.length === 1 ? '' : 's'} reached the floor` : 'Off topic: nothing reached the floor, as it should';
    else if (position && position <= 3) status = `Expected bullet found at position ${position}`;
    else status = `Expected bullet missed the top 3: it ranked ${position}`;

    return { id: q.id, query: q.text, expected: q.expected, expectedText: q.expected ? (byId.get(q.expected)?.text ?? null) : null, expectedPosition: position, expectedScore, picks, status };
  });

  return {
    k: DEFAULT_K,
    minScore: MIN_SCORE,
    // The test in tests/retrieval.spec.ts needs recall@3 of at least 80%, which is 8 of 10 queries.
    recall: { hits: recall.hits, asked: recall.asked, rate: recall.recall, needed: Math.ceil(0.8 * recall.asked - 1e-9) },
    queries: built,
    misses: built.filter((q) => q.expected && !(q.expectedPosition && q.expectedPosition <= 3)),
  };
}
