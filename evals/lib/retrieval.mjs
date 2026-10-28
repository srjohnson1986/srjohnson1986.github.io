// Retrieval for the bullet eval. The reference examples for each fixed prompt come from committed vectors
// (retrieval/eval-vectors.json), so the eval needs no embedding model and no network besides the API.

import path from 'node:path';
import { createHash } from 'node:crypto';
import { INDEX_FILE, QUERY_VECTORS_FILE, EVAL_VECTORS_FILE, DEFAULT_K, MIN_SCORE, COPY_THRESHOLD, MODEL as EMBEDDING_MODEL } from '../../retrieval/config.mjs';
import { readIndex } from '../../retrieval/lib/index.mjs';
import { rank, recallAt } from '../../retrieval/lib/retrieve.mjs';
import { EXAMPLES_INSTRUCTION } from '../../retrieval/lib/grounding.mjs';
import { mean } from './style.mjs';

/** The three committed files the retrieval side of the eval reads. */
export function loadRetrieval(root) {
  return {
    index: readIndex(path.join(root, INDEX_FILE)),
    queryVectors: readIndex(path.join(root, QUERY_VECTORS_FILE)),
    evalVectors: readIndex(path.join(root, EVAL_VECTORS_FILE)),
  };
}

/**
 * The reference examples for each prompt, by prompt id: up to k approved bullets at the minimum score or
 * higher. A prompt may get none. A prompt with no stored vector is an error, because it means
 * `npm run embeddings` was not run after the prompts changed.
 * @returns {Record<string, { id: string, text: string, score: number }[]>}
 */
export function sourcesFor(prompts, { index, evalVectors }) {
  const byId = new Map(evalVectors.items.map((e) => [e.id, e]));
  return Object.fromEntries(
    prompts.map((p) => {
      const entry = byId.get(p.id);
      if (!entry) throw new Error(`There is no stored vector for the eval prompt "${p.id}". Run npm run embeddings.`);
      return [p.id, rank(entry.vector, index.items).map(({ id, text, score }) => ({ id, text, score }))];
    }),
  );
}

/**
 * The retrieval figures recorded with a run.
 * @param {Record<string, { score: number }[]>} sources what each prompt was given
 */
export function retrievalFigures(sources, { index, queryVectors }) {
  const lists = Object.values(sources);
  const recall = recallAt(3, queryVectors, index);
  return {
    recallAt3: recall.recall,
    recallHits: recall.hits,
    recallAsked: recall.asked,
    avgSimilarity: mean(lists.flat().map((s) => s.score)),
    avgExamples: mean(lists.map((l) => l.length)),
    promptsWithoutExamples: lists.filter((l) => l.length === 0).length,
    prompts: lists.length,
  };
}

/**
 * A short fingerprint of everything that decides what the retrieval-on side asks: the instruction in the
 * message, how many examples, the minimum score, the copy threshold, and the embedding model. It is stored
 * with the baseline, and a test fails when it no longer matches. The index itself is not part of it: it
 * changes whenever a bullet is added, and that is expected.
 */
export const retrievalFingerprint = () =>
  createHash('sha256')
    .update(JSON.stringify({ instruction: EXAMPLES_INSTRUCTION, k: DEFAULT_K, minScore: MIN_SCORE, copy: COPY_THRESHOLD, model: EMBEDDING_MODEL }))
    .digest('hex')
    .slice(0, 16);
