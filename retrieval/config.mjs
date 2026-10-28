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
