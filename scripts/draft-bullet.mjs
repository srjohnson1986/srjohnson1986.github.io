#!/usr/bin/env node
// Drafts one resume bullet from a description of the work, grounded in the approved bullets that are
// closest in meaning, and remembers which drafts you accepted or rejected. A developer tool: the site never
// runs it and visitors never see it.
//
//   npm run draft -- "I set up nightly backups for the file server"      draft with retrieval and memory
//   npm run draft -- --dry-run "..."                                     show the sources and the prompt; no API call, no key
//   npm run draft -- --no-retrieval "..."                                draft from the writing rules alone
//   npm run draft -- --no-memory "..."                                   ignore (and do not record) the memory
//   npm run draft -- --accept | --reject                                 mark the last draft
//   npm run draft -- --memory | --clear-memory                           show or wipe what is remembered
//   options: --k N (examples, default 5)  --min-score 0.6
//
// The live path needs ANTHROPIC_API_KEY in your shell (one small call to the eval's model, two if the draft
// opens with a verb you rejected). It prints the sources with their scores, the draft, the writing-rule
// results, the copy check, and the memory check.
// The memory is private/draft-memory.json, which Git ignores. It reaches the API only inside the prompt.
// Exit codes: 0 the draft passed every check, 1 it broke a rule, copied an example, or reused a rejected
// verb, 2 it could not run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_FILE, DEFAULT_K, MIN_SCORE, COPY_THRESHOLD } from '../retrieval/config.mjs';
import { readIndex } from '../retrieval/lib/index.mjs';
import { prepareDraft } from '../retrieval/lib/draft.mjs';
import { findCopies } from '../retrieval/lib/overlap.mjs';
import { MEMORY_FILE, MAX_ENTRIES, emptyMemory, loadMemory, saveMemory, clearMemory, recordDraft, setVerdict, signals, reusedVerb } from '../retrieval/lib/memory.mjs';
import { scoreOutput } from '../evals/lib/score.mjs';
import { openingWord } from '../evals/lib/style.mjs';
import { MODEL, MAX_TOKENS } from '../evals/resume-bullets/config.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = { '--accept': 'accept', '--reject': 'reject', '--memory': 'show', '--clear-memory': 'clear' };

class Stop extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

export function parseArgs(argv) {
  const opts = { dryRun: false, retrieval: true, useMemory: true, k: DEFAULT_K, minScore: MIN_SCORE, words: [], command: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Stop(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-retrieval') opts.retrieval = false;
    else if (arg === '--no-memory') opts.useMemory = false;
    else if (arg in COMMANDS) {
      if (opts.command) throw new Stop(`Use only one of --accept, --reject, --memory, and --clear-memory`);
      opts.command = COMMANDS[arg];
    } else if (arg === '--k') opts.k = Number(value());
    else if (arg === '--min-score') opts.minScore = Number(value());
    else if (arg.startsWith('--')) throw new Stop(`Unknown option ${arg}`);
    else opts.words.push(arg);
  }
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Stop('--k must be a whole number of at least 1');
  if (!(opts.minScore >= -1 && opts.minScore <= 1)) throw new Stop('--min-score must be a number from -1 to 1');
  opts.input = opts.words.join(' ').trim();
  if (opts.command && opts.input) throw new Stop(`--${Object.keys(COMMANDS).find((k) => COMMANDS[k] === opts.command).slice(2)} works on the last draft and takes no description`);
  if (!opts.command && !opts.input) throw new Stop('Give a description of the work, in quotes. For example: npm run draft -- "I set up nightly backups"');
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

const shorten = (text, n = 90) => (text.length > n ? `${text.slice(0, n - 3)}...` : text);

/** --accept, --reject, --memory, and --clear-memory: they work on the memory file and never call anything. */
function memoryCommand(command, file, log) {
  if (command === 'clear') {
    const removed = clearMemory(file);
    log(`Memory cleared: ${removed} draft${removed === 1 ? '' : 's'} removed.`);
    return 0;
  }
  const memory = loadMemory(file);
  if (command === 'show') {
    if (!memory.entries.length) {
      log('Memory is empty.');
      return 0;
    }
    log(`Memory (${memory.entries.length} of at most ${MAX_ENTRIES} drafts, kept in ${MEMORY_FILE}, which Git ignores):`);
    memory.entries.forEach((e) => log(`  [${e.status}] ${e.date}  ${shorten(e.draft)}`));
    const s = signals(memory);
    log(`Later drafts will avoid opening with: ${s.avoid.length ? s.avoid.join(', ') : 'nothing'}. Accepted bullets shown as style guidance: ${s.preferred.length}.`);
    return 0;
  }
  const verdict = command === 'accept' ? 'accepted' : 'rejected';
  const done = setVerdict(memory, verdict);
  if (!done) throw new Stop('There is no draft waiting for a verdict. Make one first with npm run draft -- "<description>".');
  saveMemory(file, done.memory);
  log(`Marked as ${verdict}: ${shorten(done.entry.draft)}`);
  if (verdict === 'rejected') log(`Later drafts will not open with "${openingWord(done.entry.draft)}".`);
  return 0;
}

/**
 * @param {string[]} argv
 * @param {{ root?: string, memoryFile?: string, embed?: Function, complete?: (p: { system: string, user: string }) => Promise<string>, log?: (s: string) => void }} [deps]
 */
export async function main(argv, deps = {}) {
  const log = deps.log ?? console.log;
  const opts = parseArgs(argv);
  const memoryFile = deps.memoryFile ?? path.join(repoRoot, MEMORY_FILE);
  if (opts.command) return memoryCommand(opts.command, memoryFile, log);

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
  const memory = opts.useMemory ? loadMemory(memoryFile) : emptyMemory();
  const heard = signals(memory);
  const draft = await prepareDraft({ input: opts.input, index, embed: lazyEmbed, retrieval: opts.retrieval, memory: heard, k: opts.k, minScore: opts.minScore, log });

  if (draft.sources.length) {
    log('Reference examples retrieved:');
    draft.sources.forEach((s) => log(`  ${s.score.toFixed(3)}  ${s.id}\n         ${s.text}`));
  } else {
    log(`Reference examples: none (${draft.fallback}).`);
  }
  if (!opts.useMemory) log('Memory: off for this draft.');
  else if (heard.avoid.length || heard.preferred.length) log(`Memory: avoiding opening verbs ${heard.avoid.join(', ') || '(none)'}; ${heard.preferred.length} accepted bullet${heard.preferred.length === 1 ? '' : 's'} as style guidance.`);
  else log('Memory: nothing stored yet.');

  if (opts.dryRun) {
    log(`\n--- system prompt (the writing rules) ---\n${draft.system}\n\n--- message ---\n${draft.user}`);
    return 0;
  }

  const complete = deps.complete ?? liveComplete;
  let text = (await complete({ system: draft.system, user: draft.user })).trim();
  // A rejected opening verb is a promise, not a request: if the model repeats one, ask once more.
  let repeated = reusedVerb(text, heard.avoid);
  if (repeated) {
    log(`Memory: the draft opened with "${repeated}", which you rejected. Asking once more.`);
    const again = `${draft.user}\n\nYour previous attempt opened with "${repeated}", which is not allowed. Write the bullet again with a different opening verb.`;
    text = (await complete({ system: draft.system, user: again })).trim();
    repeated = reusedVerb(text, heard.avoid);
  }

  const scored = scoreOutput(text, { input: opts.input });
  const copies = findCopies(text, draft.sources);
  const failed = scored.results.filter((r) => r.status === 'fail');

  log(`\nDraft:\n  ${text}\n`);
  log(failed.length ? `Writing rules: FAILED\n${failed.map((r) => `  ${r.rule}: ${r.detail}`).join('\n')}` : 'Writing rules: all passed.');
  log(copies.length ? `Copy check: FAILED, shares over ${COPY_THRESHOLD * 100}% of its words with ${copies.map((c) => `${c.id} (${(c.overlap * 100).toFixed(0)}%)`).join(', ')}` : 'Copy check: passed.');
  if (heard.avoid.length) log(repeated ? `Memory check: FAILED, opens with "${repeated}", which you rejected, even after a second try.` : 'Memory check: passed, it does not open with a rejected verb.');

  if (opts.useMemory) {
    saveMemory(memoryFile, recordDraft(memory, { input: opts.input, draft: text, date: new Date().toISOString().slice(0, 10) }));
    log('Recorded as the draft waiting for a verdict. Next: npm run draft -- --accept   or   npm run draft -- --reject');
  }
  return failed.length || copies.length || repeated ? 1 : 0;
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
