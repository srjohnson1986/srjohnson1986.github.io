#!/usr/bin/env node
// Drafts one resume bullet from a description of the work, grounded in the approved bullets that are
// closest in meaning. A developer tool: the site never runs it and visitors never see it.
//
//   npm run draft -- "I set up nightly backups for the file server"      draft with retrieval
//   npm run draft -- --dry-run "..."                                     show the sources and the prompt; no API call, no key
//   npm run draft -- --no-retrieval "..."                                draft from the writing rules alone
//   options: --k N (examples, default 5)  --min-score 0.6
//
// The live path needs ANTHROPIC_API_KEY in your shell (one small call to the eval's model). It prints the
// sources with their scores, the draft, the writing-rule results, and the copy check.
// Exit codes: 0 the draft passed every check, 1 it broke a rule or copied an example, 2 it could not run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_FILE, DEFAULT_K, MIN_SCORE, COPY_THRESHOLD } from '../retrieval/config.mjs';
import { readIndex } from '../retrieval/lib/index.mjs';
import { prepareDraft } from '../retrieval/lib/draft.mjs';
import { findCopies } from '../retrieval/lib/overlap.mjs';
import { scoreOutput } from '../evals/lib/score.mjs';
import { MODEL, MAX_TOKENS } from '../evals/resume-bullets/config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Stop extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export function parseArgs(argv) {
  const opts = { dryRun: false, retrieval: true, k: DEFAULT_K, minScore: MIN_SCORE, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Stop(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-retrieval') opts.retrieval = false;
    else if (arg === '--k') opts.k = Number(value());
    else if (arg === '--min-score') opts.minScore = Number(value());
    else if (arg.startsWith('--')) throw new Stop(`Unknown option ${arg}`);
    else opts.words.push(arg);
  }
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Stop('--k must be a whole number of at least 1');
  if (!(opts.minScore >= -1 && opts.minScore <= 1)) throw new Stop('--min-score must be a number from -1 to 1');
  opts.input = opts.words.join(' ').trim();
  if (!opts.input) throw new Stop('Give a description of the work, in quotes. For example: npm run draft -- "I set up nightly backups"');
  return opts;
}

/** The live call: one small request, set up the same way as the eval's. */
async function liveComplete({ system, user }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  try {
    const message = await new Anthropic({ apiKey: key }).messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: user }],
    });
    return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (error) {
    throw new Stop(`The API call failed: ${String(error.message).split(key).join('[key hidden]')}`);
  }
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, embed?: Function, complete?: (p: { system: string, user: string }) => Promise<string>, log?: (s: string) => void }} [deps]
 */
export async function main(argv, deps = {}) {
  const log = deps.log ?? console.log;
  const opts = parseArgs(argv);
  if (!opts.dryRun && !deps.complete && !process.env.ANTHROPIC_API_KEY) {
    throw new Stop('ANTHROPIC_API_KEY is not set. Set it in your shell (never commit it), or use --dry-run to see the prompt without calling the API.');
  }

  // The model is loaded only when retrieval is on, and only when the description is not empty.
  let embed = deps.embed;
  const lazyEmbed = async (texts) => {
    embed ??= await (await import('../retrieval/lib/embedder.mjs')).createEmbedder();
    return embed(texts);
  };
  const index = readIndex(path.join(deps.root ?? repoRoot, INDEX_FILE));
  const draft = await prepareDraft({ input: opts.input, index, embed: lazyEmbed, retrieval: opts.retrieval, k: opts.k, minScore: opts.minScore, log });

  if (draft.sources.length) {
    log('Reference examples retrieved:');
    draft.sources.forEach((s) => log(`  ${s.score.toFixed(3)}  ${s.id}\n         ${s.text}`));
  } else {
    log(`Reference examples: none (${draft.fallback}).`);
  }

  if (opts.dryRun) {
    log(`\n--- system prompt (the writing rules) ---\n${draft.system}\n\n--- message ---\n${draft.user}`);
    return 0;
  }

  const text = (await (deps.complete ?? liveComplete)({ system: draft.system, user: draft.user })).trim();
  const scored = scoreOutput(text, { input: opts.input });
  const copies = findCopies(text, draft.sources);
  const failed = scored.results.filter((r) => r.status === 'fail');

  log(`\nDraft:\n  ${text}\n`);
  log(failed.length ? `Writing rules: FAILED\n${failed.map((r) => `  ${r.rule}: ${r.detail}`).join('\n')}` : 'Writing rules: all passed.');
  log(copies.length ? `Copy check: FAILED, shares over ${COPY_THRESHOLD * 100}% of its words with ${copies.map((c) => `${c.id} (${(c.overlap * 100).toFixed(0)}%)`).join(', ')}` : 'Copy check: passed.');
  return failed.length || copies.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Stop ? `NOT RUN: ${error.message}` : `NOT RUN: unexpected error: ${error.stack ?? error}`);
      process.exitCode = error instanceof Stop ? error.code : 2;
    },
  );
}
