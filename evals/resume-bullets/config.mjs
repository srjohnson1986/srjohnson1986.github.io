// Settings for the resume bullet eval. They are in code, not in the workflow, so a change to the model
// or the size of a run shows up in a pull request that touches evals/.

// The cheapest current model, on purpose: this eval is run often and only needs to show whether drafts
// follow the rules. To compare another model, change this and record a new baseline.
export const MODEL = 'claude-haiku-5-5';

// How many times each prompt is run. The output varies, so one run per prompt would say very little.
export const RUNS_PER_PROMPT = 5;

// A hard cap on API calls in one run. The runner refuses to start if prompts x runs x modes is above this.
// 80 is 8 prompts x 5 runs x 2 modes (retrieval off and on); it was 60 before retrieval existed.
export const MAX_CALLS = 80;

// A bullet is one sentence, so a reply this long means something went wrong. It also caps the cost.
export const MAX_TOKENS = 300;

// How many calls are in flight at once. Small, to stay far from any rate limit.
export const CONCURRENCY = 4;

// Price in US dollars per million tokens for MODEL, used only to print an estimate and the cost of a run.
// Check it against https://platform.claude.com/docs/en/about-claude/pricing when the model changes.
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5 };
