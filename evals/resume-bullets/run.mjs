#!/usr/bin/env node
// The runner for the resume bullet eval. It asks Claude to draft a bullet for each fixed prompt several
// times, once with retrieval off (the writing rules alone) and once with retrieval on (the same rules plus
// a "Reference examples" block of the closest approved bullets), scores every reply with
// evals/lib/score.mjs, prints both side by side, and fails when either pass rate is below the recorded
// threshold.
//
//   npm run eval:bullets                     live run, both modes (needs ANTHROPIC_API_KEY; makes API calls that cost money)
//   npm run eval:bullets -- --estimate       count tokens and print the cost; makes no replies
//   npm run eval:bullets:replay -- <file>    score saved replies from a file; no key, no network
//   options: --retrieval off|on|both  --runs N  --threshold 0.95  --save <file>  --update-baseline
//            --baseline-file <file>  --history-file <file>   (these two exist so tests can write elsewhere)
//
// Exit codes: 0 passed (or no threshold recorded yet), 1 a pass rate is below the threshold,
// 2 the run could not be done (no key, an API error, too many calls, bad options). An outage is never
// counted as a quality failure, so a red 1 always means the replies got worse.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPTS } from './prompts.mjs';
import { userMessage } from './message.mjs';
import { MODEL, RUNS_PER_PROMPT, MAX_CALLS, MAX_TOKENS, CONCURRENCY, PRICE_PER_MTOK } from './config.mjs';
import { summarize, gate, renderReport, renderComparison, percent } from '../lib/report.mjs';
import { RULES } from '../lib/score.mjs';
import { loadRetrieval, sourcesFor, retrievalFigures, retrievalFingerprint } from '../lib/retrieval.mjs';
import { openersOf, styleSignals, mean, wordCount } from '../lib/style.mjs';
import { groundedMessage } from '../../retrieval/lib/grounding.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
export { userMessage };
export const SYSTEM_PROMPT = fs.readFileSync(path.join(here, 'system-prompt.md'), 'utf8').trim();
export const BASELINE_FILE = path.join(here, 'baseline.json');
export const HISTORY_FILE = path.join(here, 'history.jsonl');
export const RESULTS_FILE = path.join(here, 'results', 'last-run.json');

/**
 * A short fingerprint of everything that decides what the eval asks with retrieval off: the prompts, the
 * system prompt, the model, and the runs per prompt. It is saved in baseline.json, and a test fails when it
 * no longer matches, so nobody can change a prompt or the model and keep comparing against a baseline from
 * before the change. (What retrieval adds is covered by retrievalFingerprint in evals/lib/retrieval.mjs.)
 */
export const fingerprint = () =>
  createHash('sha256')
    .update(JSON.stringify({ prompts: PROMPTS, system: SYSTEM_PROMPT.replace(/\r\n/g, '\n'), model: MODEL, runs: RUNS_PER_PROMPT }))
    .digest('hex')
    .slice(0, 16);

const cost = (usage) => (usage.input * PRICE_PER_MTOK.input + usage.output * PRICE_PER_MTOK.output) / 1_000_000;
const addUsage = (a, b) => ({ input: (a?.input ?? 0) + (b?.input ?? 0), output: (a?.output ?? 0) + (b?.output ?? 0) });

class Stop extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function parseArgs(argv) {
  const opts = { runs: RUNS_PER_PROMPT, mode: 'live', retrieval: 'both', updateBaseline: false, baselineFile: BASELINE_FILE, historyFile: HISTORY_FILE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Stop(`${arg} needs a value`, 2);
      return argv[++i];
    };
    if (arg === '--estimate') opts.mode = 'estimate';
    else if (arg === '--replay') {
      opts.mode = 'replay';
      opts.file = value();
    } else if (arg === '--runs') opts.runs = Number(value());
    else if (arg === '--threshold') opts.threshold = Number(value());
    else if (arg === '--retrieval') opts.retrieval = value();
    else if (arg === '--save') opts.save = value();
    else if (arg === '--baseline-file') opts.baselineFile = path.resolve(value());
    else if (arg === '--history-file') opts.historyFile = path.resolve(value());
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else throw new Stop(`Unknown option ${arg}`, 2);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Stop('--runs must be a whole number of at least 1', 2);
  if (opts.threshold !== undefined && !(opts.threshold >= 0 && opts.threshold <= 1)) throw new Stop('--threshold must be a number from 0 to 1', 2);
  if (!['off', 'on', 'both'].includes(opts.retrieval)) throw new Stop('--retrieval must be off, on, or both', 2);
  opts.modes = opts.retrieval === 'both' ? ['off', 'on'] : [opts.retrieval];
  return opts;
}

function readBaseline(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function makeClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Stop('ANTHROPIC_API_KEY is not set. Set it in your shell, or run this from the AI eval workflow, which reads it from a repository secret.', 2);
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { client: new Anthropic({ apiKey: key }), Anthropic, key };
}

const scrub = (text, key) => (key ? String(text).split(key).join('[key hidden]') : String(text));

/** The user message for a prompt in a mode. With retrieval off it is the plain message. */
const messageFor = (mode, sources) => (prompt) => (mode === 'on' ? groundedMessage(prompt.input, sources[prompt.id] ?? []) : userMessage(prompt));

async function estimate(opts, sources) {
  const { client, key } = await makeClient();
  let input = 0;
  try {
    for (const mode of opts.modes) {
      for (const prompt of PROMPTS) {
        const r = await client.messages.countTokens({ model: MODEL, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: messageFor(mode, sources)(prompt) }] });
        input += r.input_tokens;
      }
    }
  } catch (error) {
    throw new Stop(`The token count failed: ${scrub(error.message, key)}`, 2);
  }
  const calls = PROMPTS.length * opts.runs * opts.modes.length;
  const perCall = input / (PROMPTS.length * opts.modes.length);
  const typical = { input: Math.round(perCall * calls), output: calls * 80 };
  const ceiling = { input: Math.round(perCall * calls), output: calls * MAX_TOKENS };
  console.log(`Model ${MODEL}: ${PROMPTS.length} prompts x ${opts.runs} runs x ${opts.modes.length} mode${opts.modes.length === 1 ? '' : 's'} (${opts.modes.join(', ')}) = ${calls} calls (cap ${MAX_CALLS}).`);
  console.log(`Input: about ${Math.round(perCall)} tokens per call, ${typical.input} in total.`);
  console.log(`Typical cost (about 80 output tokens per reply): $${cost(typical).toFixed(4)}`);
  console.log(`Ceiling (every reply uses all ${MAX_TOKENS} output tokens): $${cost(ceiling).toFixed(4)}`);
  return 0;
}

async function callModel(opts, build) {
  const { client, Anthropic, key } = await makeClient();
  const jobs = PROMPTS.flatMap((prompt, p) => Array.from({ length: opts.runs }, (_, r) => ({ prompt, p, r })));
  const outputs = PROMPTS.map(() => Array.from({ length: opts.runs }));
  const usage = { input: 0, output: 0 };
  let next = 0;
  let failure = null;

  const worker = async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try {
        const message = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: build(job.prompt) }],
        });
        usage.input += message.usage.input_tokens;
        usage.output += message.usage.output_tokens;
        outputs[job.p][job.r] = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      } catch (error) {
        const what = error instanceof Anthropic.APIError ? `API error ${error.status ?? ''}` : 'Request failed';
        failure = new Stop(`${what} on prompt "${job.prompt.id}": ${scrub(error.message, key)}`, 2);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  if (failure) throw failure;
  return { runs: PROMPTS.map((prompt, p) => ({ promptId: prompt.id, outputs: outputs[p] })), usage };
}

/**
 * Reads a saved results file. A file from before retrieval existed has one `runs` list; it is the
 * retrieval-off side.
 */
function readReplay(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Stop(`Could not read the replay file ${file}: ${error.message}`, 2);
  }
  if (Array.isArray(data.runs)) return { ...data, off: { runs: data.runs, usage: data.usage } };
  if (!data.off && !data.on) throw new Stop(`The replay file ${file} has no "runs" list, and no "off" or "on" results`, 2);
  for (const mode of ['off', 'on']) if (data[mode] && !Array.isArray(data[mode].runs)) throw new Stop(`The replay file ${file} has no "runs" list under "${mode}"`, 2);
  if (data.on && !data.on.sources) throw new Stop(`The replay file ${file} has results with retrieval on but not the reference examples they were given ("sources"), so they cannot be scored`, 2);
  return data;
}

const pick = (summary) => ({
  overall: summary.overall,
  byRule: Object.fromEntries(RULES.map((r) => [r.id, summary.byRule[r.id]])),
  byPrompt: Object.fromEntries(Object.entries(summary.byPrompt).map(([id, s]) => [id, { passed: s.passed, total: s.total, failedRules: s.failedRules }])),
});

export async function main(argv) {
  const opts = parseArgs(argv);
  const calls = PROMPTS.length * opts.runs * opts.modes.length;
  if (opts.mode !== 'replay' && calls > MAX_CALLS) {
    throw new Stop(`Refusing to run: ${PROMPTS.length} prompts x ${opts.runs} runs x ${opts.modes.length} mode${opts.modes.length === 1 ? '' : 's'} = ${calls} calls, above the cap of ${MAX_CALLS}. Lower --runs, or raise MAX_CALLS in evals/resume-bullets/config.mjs on purpose.`, 2);
  }

  // The committed vectors and index: what retrieval-on reference examples come from, and what the retrieval
  // figures and style signals are measured against.
  const retrieval = loadRetrieval(repoRoot);
  let sources = {};
  if (opts.mode !== 'replay' && opts.modes.includes('on')) {
    try {
      sources = sourcesFor(PROMPTS, retrieval);
    } catch (error) {
      throw new Stop(error.message, 2);
    }
  }
  if (opts.mode === 'estimate') return estimate(opts, sources);

  let data;
  if (opts.mode === 'replay') {
    data = readReplay(opts.file);
  } else {
    console.log(`Running ${calls} calls on ${MODEL} (${PROMPTS.length} prompts x ${opts.runs} runs x ${opts.modes.length} mode${opts.modes.length === 1 ? '' : 's'}: ${opts.modes.join(', ')})...`);
    data = { model: MODEL, date: new Date().toISOString().slice(0, 10), runsPerPrompt: opts.runs };
    for (const mode of opts.modes) {
      const live = await callModel(opts, messageFor(mode, sources));
      data[mode] = mode === 'on' ? { ...live, sources } : live;
    }
    const target = path.resolve(opts.save ?? RESULTS_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  }

  const summaries = {};
  try {
    if (data.off) summaries.off = summarize(PROMPTS, data.off.runs);
    if (data.on) summaries.on = summarize(PROMPTS.map((p) => ({ ...p, examples: data.on.sources[p.id] ?? [] })), data.on.runs);
  } catch (error) {
    throw new Stop(error.message, 2);
  }
  const modes = ['off', 'on'].filter((m) => summaries[m]);

  const baseline = readBaseline(opts.baselineFile);
  const threshold = opts.threshold ?? baseline?.threshold;
  const decisions = typeof threshold === 'number' ? Object.fromEntries(modes.map((m) => [m, gate(summaries[m], threshold)])) : null;
  const ok = decisions ? modes.every((m) => decisions[m].ok) : null;
  const usage = ['off', 'on'].reduce((sum, m) => (data[m]?.usage ? addUsage(sum, data[m].usage) : sum), null);

  const figures = data.on ? retrievalFigures(data.on.sources, retrieval) : null;
  const bulletTexts = retrieval.index.items.filter((e) => e.source === 'bullet').map((e) => e.text);
  const openers = openersOf(bulletTexts);
  const flat = (m) => data[m].runs.flatMap((r) => r.outputs).filter((o) => typeof o === 'string');
  const style = Object.fromEntries(modes.map((m) => [m, styleSignals(flat(m), openers)]));
  const approvedAvgWords = mean(bulletTexts.map(wordCount));

  const meta = {
    model: data.model ?? 'saved replies (no model call)',
    runsPerPrompt: data.runsPerPrompt ?? data.off?.runs[0]?.outputs?.length ?? data.on?.runs[0]?.outputs?.length,
    threshold,
    usage: usage ?? undefined,
    cost: usage ? cost(usage) : undefined,
  };
  const report =
    modes.length === 1 && modes[0] === 'off'
      ? renderReport(summaries.off, { ...meta, verdict: decisions ? (decisions.off.ok ? 'PASS' : 'FAIL') : undefined })
      : renderComparison(summaries, {
          ...meta,
          verdicts: decisions ? Object.fromEntries(modes.map((m) => [m, decisions[m].ok ? 'PASS' : 'FAIL'])) : undefined,
          figures: figures ?? undefined,
          style: { ...style, approvedAvgWords },
        });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

  if (opts.updateBaseline) {
    // A baseline must come from a real run: a live run now, or the file a live run saved (it names the model and date).
    if (opts.mode === 'replay' && !(data.model && data.date)) throw new Stop('--update-baseline needs a live run, or the results file a live run saved (it names the model and date)', 2);
    if (typeof threshold !== 'number') throw new Stop('--update-baseline needs a threshold: pass --threshold 0.95 (or whatever you chose)', 2);
    if (!summaries.off || !summaries.on) throw new Stop('--update-baseline needs a run with retrieval both off and on, so the baseline holds both', 2);
    const record = {
      model: data.model,
      date: data.date,
      runsPerPrompt: data.runsPerPrompt,
      prompts: PROMPTS.length,
      fingerprint: fingerprint(),
      retrievalFingerprint: retrievalFingerprint(),
      threshold,
      off: pick(summaries.off),
      on: pick(summaries.on),
      retrieval: figures,
      style: { off: style.off, on: style.on, approvedAvgWords },
    };
    fs.writeFileSync(opts.baselineFile, JSON.stringify(record, null, 2) + '\n');
    // One line per recorded baseline, kept in git, so a change over time can be read from the file.
    const line = {
      date: data.date,
      model: data.model,
      runsPerPrompt: data.runsPerPrompt,
      threshold,
      offRate: summaries.off.overall.rate,
      onRate: summaries.on.overall.rate,
      recallAt3: figures.recallAt3,
      avgSimilarity: figures.avgSimilarity,
      promptsWithoutExamples: figures.promptsWithoutExamples,
      verbReuse: { off: style.off.verbReuse, on: style.on.verbReuse },
      distinctVerbs: { off: style.off.distinctVerbs, on: style.on.distinctVerbs },
      avgWords: { off: style.off.avgWords, on: style.on.avgWords },
    };
    fs.appendFileSync(opts.historyFile, JSON.stringify(line) + '\n');
    console.log(`Baseline written to ${path.relative(process.cwd(), opts.baselineFile)} and a line added to ${path.relative(process.cwd(), opts.historyFile)} (off ${percent(summaries.off.overall.rate)}, on ${percent(summaries.on.overall.rate)}, threshold ${percent(threshold)}).`);
  }

  if (!decisions) {
    console.log('No threshold is recorded, so nothing was enforced. Record one with --update-baseline --threshold <0 to 1>.');
    return 0;
  }
  for (const m of modes) {
    const d = decisions[m];
    console.log(d.ok ? `PASS (retrieval ${m}): ${percent(d.rate)} is at or above the threshold of ${percent(threshold)}.` : `FAIL (retrieval ${m}): ${percent(d.rate)} is below the threshold of ${percent(threshold)}.`);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Set the exit code and let Node finish by itself. Calling process.exit() while the HTTP connections of
  // a live run are still closing crashes Node on Windows (a libuv assertion), which would hide the result.
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
