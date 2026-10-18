#!/usr/bin/env node
// The runner for the resume bullet eval. It asks Claude to draft a bullet for each fixed prompt several
// times, scores every reply with evals/lib/score.mjs, prints a report, and fails when the overall pass
// rate is below the recorded threshold.
//
//   npm run eval:bullets                     live run (needs ANTHROPIC_API_KEY; makes API calls that cost money)
//   npm run eval:bullets -- --estimate       count tokens and print the cost; makes no replies
//   npm run eval:bullets:replay -- <file>    score saved replies from a file; no key, no network
//   options: --runs N  --threshold 0.9  --save <file>  --update-baseline
//
// Exit codes: 0 passed (or no threshold recorded yet), 1 the pass rate is below the threshold,
// 2 the run could not be done (no key, an API error, too many calls, bad options). An outage is never
// counted as a quality failure, so a red 1 always means the replies got worse.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPTS } from './prompts.mjs';
import { MODEL, RUNS_PER_PROMPT, MAX_CALLS, MAX_TOKENS, CONCURRENCY, PRICE_PER_MTOK } from './config.mjs';
import { summarize, gate, renderReport, percent } from '../lib/report.mjs';
import { RULES } from '../lib/score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_PROMPT = fs.readFileSync(path.join(here, 'system-prompt.md'), 'utf8').trim();
export const BASELINE_FILE = path.join(here, 'baseline.json');
export const RESULTS_FILE = path.join(here, 'results', 'last-run.json');

export const userMessage = (prompt) => `Write one resume bullet for this work:\n\n${prompt.input}`;
const cost = (usage) => (usage.input * PRICE_PER_MTOK.input + usage.output * PRICE_PER_MTOK.output) / 1_000_000;

class Stop extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function parseArgs(argv) {
  const opts = { runs: RUNS_PER_PROMPT, mode: 'live', updateBaseline: false };
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
    else if (arg === '--save') opts.save = value();
    else if (arg === '--update-baseline') opts.updateBaseline = true;
    else throw new Stop(`Unknown option ${arg}`, 2);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Stop('--runs must be a whole number of at least 1', 2);
  if (opts.threshold !== undefined && !(opts.threshold >= 0 && opts.threshold <= 1)) throw new Stop('--threshold must be a number from 0 to 1', 2);
  return opts;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
}

async function makeClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Stop('ANTHROPIC_API_KEY is not set. Set it in your shell, or run this from the AI eval workflow, which reads it from a repository secret.', 2);
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { client: new Anthropic({ apiKey: key }), Anthropic, key };
}

const scrub = (text, key) => (key ? String(text).split(key).join('[key hidden]') : String(text));

async function estimate(opts) {
  const { client, key } = await makeClient();
  let input = 0;
  try {
    for (const prompt of PROMPTS) {
      const r = await client.messages.countTokens({ model: MODEL, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage(prompt) }] });
      input += r.input_tokens;
    }
  } catch (error) {
    throw new Stop(`The token count failed: ${scrub(error.message, key)}`, 2);
  }
  const calls = PROMPTS.length * opts.runs;
  const perCall = input / PROMPTS.length;
  const typical = { input: Math.round(perCall * calls), output: calls * 80 };
  const ceiling = { input: Math.round(perCall * calls), output: calls * MAX_TOKENS };
  console.log(`Model ${MODEL}: ${PROMPTS.length} prompts x ${opts.runs} runs = ${calls} calls (cap ${MAX_CALLS}).`);
  console.log(`Input: about ${Math.round(perCall)} tokens per call, ${typical.input} in total.`);
  console.log(`Typical cost (about 80 output tokens per reply): $${cost(typical).toFixed(4)}`);
  console.log(`Ceiling (every reply uses all ${MAX_TOKENS} output tokens): $${cost(ceiling).toFixed(4)}`);
  return 0;
}

async function callModel(opts) {
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
          messages: [{ role: 'user', content: userMessage(job.prompt) }],
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

function readReplay(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Stop(`Could not read the replay file ${file}: ${error.message}`, 2);
  }
  if (!Array.isArray(data.runs)) throw new Stop(`The replay file ${file} has no "runs" list`, 2);
  return data;
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const calls = PROMPTS.length * opts.runs;
  if (opts.mode !== 'replay' && calls > MAX_CALLS) {
    throw new Stop(`Refusing to run: ${PROMPTS.length} prompts x ${opts.runs} runs = ${calls} calls, above the cap of ${MAX_CALLS}. Lower --runs, or raise MAX_CALLS in evals/resume-bullets/config.mjs on purpose.`, 2);
  }
  if (opts.mode === 'estimate') return estimate(opts);

  let data;
  if (opts.mode === 'replay') {
    data = readReplay(opts.file);
  } else {
    console.log(`Running ${calls} calls on ${MODEL} (${PROMPTS.length} prompts x ${opts.runs} runs)...`);
    const live = await callModel(opts);
    data = { model: MODEL, date: new Date().toISOString().slice(0, 10), runsPerPrompt: opts.runs, ...live };
    const target = path.resolve(opts.save ?? RESULTS_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
  }

  let summary;
  try {
    summary = summarize(PROMPTS, data.runs);
  } catch (error) {
    throw new Stop(error.message, 2);
  }
  const baseline = readBaseline();
  const threshold = opts.threshold ?? baseline?.threshold;
  const decision = typeof threshold === 'number' ? gate(summary, threshold) : null;
  const usage = data.usage;
  const report = renderReport(summary, {
    model: data.model ?? 'saved replies (no model call)',
    runsPerPrompt: data.runsPerPrompt ?? data.runs[0]?.outputs?.length,
    threshold,
    verdict: decision ? (decision.ok ? 'PASS' : 'FAIL') : undefined,
    usage,
    cost: usage ? cost(usage) : undefined,
  });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

  if (opts.updateBaseline) {
    if (opts.mode === 'replay') throw new Stop('--update-baseline needs a live run, not a replay', 2);
    if (typeof threshold !== 'number') throw new Stop('--update-baseline needs a threshold: pass --threshold 0.9 (or whatever you chose)', 2);
    const record = {
      model: data.model,
      date: data.date,
      runsPerPrompt: data.runsPerPrompt,
      prompts: PROMPTS.length,
      overall: summary.overall,
      byRule: Object.fromEntries(RULES.map((r) => [r.id, summary.byRule[r.id]])),
      byPrompt: Object.fromEntries(Object.entries(summary.byPrompt).map(([id, s]) => [id, { passed: s.passed, total: s.total, failedRules: s.failedRules }])),
      threshold,
    };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(record, null, 2) + '\n');
    console.log(`Baseline written to ${path.relative(process.cwd(), BASELINE_FILE)} (overall ${percent(summary.overall.rate)}, threshold ${percent(threshold)}).`);
  }

  if (!decision) {
    console.log('No threshold is recorded, so nothing was enforced. Record one with --update-baseline --threshold <0 to 1>.');
    return 0;
  }
  console.log(decision.ok ? `PASS: ${percent(decision.rate)} is at or above the threshold of ${percent(threshold)}.` : `FAIL: ${percent(decision.rate)} is below the threshold of ${percent(threshold)}.`);
  return decision.ok ? 0 : 1;
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
