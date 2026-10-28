// Settings for the embedding index (see scripts/build-embeddings.mjs and the README section
// "Retrieval index"). They live in code so a change of model shows up in a pull request.

// A small embedding model that runs on this computer through @huggingface/transformers. It needs no
// API key, costs nothing, and gives the same vectors for the same text, so tests and CI never depend
// on a paid service. The files are downloaded from Hugging Face once and kept in a local cache.
export const MODEL = 'Xenova/bge-small-en-v1.5';

// The 8-bit version of the model: about a quarter of the download and fast on a CPU, with little
// loss in quality for a few hundred short sentences.
export const DTYPE = 'q8';

// How many texts are embedded in one model call.
export const BATCH_SIZE = 16;

// Vectors are stored with this many decimal places. Six is far finer than the model's own noise and
// keeps the committed file small and its diffs readable.
export const VECTOR_DECIMALS = 6;

// Where the committed index lives, relative to the repository root.
export const INDEX_FILE = 'retrieval/embeddings.json';

// The fixed test queries (written by hand) and their vectors (written by `npm run embeddings`).
export const QUERIES_FILE = 'retrieval/queries.yaml';
export const QUERY_VECTORS_FILE = 'retrieval/query-vectors.json';

// The vectors of the 8 fixed prompts of the bullet eval (evals/resume-bullets/prompts.mjs), written by
// `npm run embeddings`. The eval uses them to find reference examples, so it needs no embedding model.
export const EVAL_VECTORS_FILE = 'retrieval/eval-vectors.json';

// How many approved bullets a draft is shown as reference examples.
export const DEFAULT_K = 5;

// The lowest cosine similarity a bullet may have and still be shown. On the 13 test queries the best
// match for an off-topic query scored at most 0.56 and every on-topic best match scored at least 0.70,
// so 0.60 sits between them. It was set from those few queries, not tuned on a large set: revisit it if
// the bullets or the model change, and re-measure with `tests/retrieval.spec.ts`.
export const MIN_SCORE = 0.6;

// A draft that shares more than this share of its words with a retrieved bullet counts as a copy.
export const COPY_THRESHOLD = 0.8;
