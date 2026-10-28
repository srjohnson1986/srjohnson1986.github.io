// The real embedder: a small model that runs locally in Node. It is loaded only when something needs
// to be embedded, so `--check` and the tests never load it (or download it).

import { MODEL, DTYPE, BATCH_SIZE } from '../config.mjs';

/** Returns an `embed(texts)` function that gives one normalized vector per text. */
export async function createEmbedder() {
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  return async (texts) => {
    const vectors = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      // CLS pooling plus normalizing is what the bge models are trained for. Normalized vectors make
      // cosine similarity a plain dot product later.
      const out = await extractor(texts.slice(i, i + BATCH_SIZE), { pooling: 'cls', normalize: true });
      vectors.push(...out.tolist());
    }
    return vectors;
  };
}
