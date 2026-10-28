// Turns scored outputs into pass rates, a readable report, and the pass or fail decision.
// Plain code, no network. tests/bullet-eval-gate.spec.ts proves it with fixed numbers.

import { RULES, MANUAL_REVIEW, scoreOutput } from './score.mjs';

const rate = (passed, total) => (total === 0 ? null : passed / total);

/**
 * @param {{ id: string, input: string, forbidden?: string[] }[]} prompts the eval prompts
 * @param {{ promptId: string, outputs: string[] }[]} runs what the model answered, several per prompt
 */
export function summarize(prompts, runs) {
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const byRule = Object.fromEntries(RULES.map((r) => [r.id, { pass: 0, fail: 0, na: 0, rate: null }]));
  const byPrompt = {};
  const failures = [];
  let passed = 0;
  let total = 0;

  for (const run of runs) {
    const prompt = byId.get(run.promptId);
    if (!prompt) throw new Error(`The results name a prompt that does not exist: "${run.promptId}"`);
    const entry = (byPrompt[prompt.id] ??= { passed: 0, total: 0, rate: null, failedRules: {} });
    for (const output of run.outputs) {
      const score = scoreOutput(output, prompt);
      total++;
      entry.total++;
      if (score.passed) {
        passed++;
        entry.passed++;
      } else {
        const failed = score.results.filter((r) => r.status === 'fail');
        for (const f of failed) entry.failedRules[f.rule] = (entry.failedRules[f.rule] ?? 0) + 1;
        failures.push({ promptId: prompt.id, output, failed });
      }
      for (const r of score.results) byRule[r.rule][r.status === 'n/a' ? 'na' : r.status]++;
    }
  }
  for (const stats of Object.values(byRule)) stats.rate = rate(stats.pass, stats.pass + stats.fail);
  for (const stats of Object.values(byPrompt)) stats.rate = rate(stats.passed, stats.total);
  // Worst first: the output that broke the most rules, then in prompt order.
  failures.sort((a, b) => b.failed.length - a.failed.length);
  return { overall: { passed, total, rate: rate(passed, total) }, byRule, byPrompt, failures };
}

/**
 * The decision. `threshold` is the lowest overall pass rate that still counts as passing (0 to 1).
 * @returns {{ ok: boolean, rate: number | null, threshold: number }}
 */
export function gate(summary, threshold) {
  if (typeof threshold !== 'number' || Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
    throw new Error(`The threshold must be a number from 0 to 1, not ${JSON.stringify(threshold)}`);
  }
  const r = summary.overall.rate;
  return { ok: r !== null && r + 1e-9 >= threshold, rate: r, threshold };
}

export const percent = (r) => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

const fence = (text) => (String(text).trim() ? '```\n' + String(text).replace(/```/g, "'''") + '\n```' : '(an empty reply)');

/** The report as Markdown (it is printed to the terminal and written to the Actions job summary). */
export function renderReport(summary, { model, runsPerPrompt, threshold, verdict, usage, cost, worst = 5 } = {}) {
  const lines = [];
  lines.push('# Resume bullet eval', '');
  if (model) lines.push(`Model: ${model}. Runs per prompt: ${runsPerPrompt ?? 'n/a'}.`, '');
  const o = summary.overall;
  lines.push(`**Overall: ${o.passed} of ${o.total} outputs passed every rule that applied (${percent(o.rate)}).**`);
  if (typeof threshold === 'number') {
    lines.push(`Threshold: ${percent(threshold)}. Result: ${verdict ?? (o.rate !== null && o.rate + 1e-9 >= threshold ? 'PASS' : 'FAIL')}.`);
  } else {
    lines.push('Threshold: none recorded yet, so this run is report only.');
  }
  if (usage) lines.push(`Tokens: ${usage.input} in, ${usage.output} out${typeof cost === 'number' ? ` (about $${cost.toFixed(4)})` : ''}.`);
  lines.push('', '## Pass rate per rule', '', '| Rule | Passed | Failed | Not applicable | Rate |', '| --- | --- | --- | --- | --- |');
  for (const rule of RULES) {
    const s = summary.byRule[rule.id];
    lines.push(`| ${rule.name} | ${s.pass} | ${s.fail} | ${s.na} | ${percent(s.rate)} |`);
  }
  lines.push('', '## Pass rate per prompt', '', '| Prompt | Passed | Rate | Rules it broke |', '| --- | --- | --- | --- |');
  for (const [id, s] of Object.entries(summary.byPrompt)) {
    const broke = Object.entries(s.failedRules).map(([rule, n]) => `${rule} x${n}`).join(', ') || 'none';
    lines.push(`| ${id} | ${s.passed} of ${s.total} | ${percent(s.rate)} | ${broke} |`);
  }
  lines.push('', `## Worst failures (up to ${worst}, with the model's actual output)`, '');
  if (summary.failures.length === 0) lines.push('None.', '');
  for (const f of summary.failures.slice(0, worst)) {
    lines.push(`Prompt \`${f.promptId}\` broke: ${f.failed.map((x) => `${x.rule} (${x.detail})`).join('; ')}`, '', fence(f.output), '');
  }
  lines.push('## Manual review (not checked in code)', '', ...MANUAL_REVIEW.map((m) => `- ${m}`), '');
  return lines.join('\n');
}

const cell = (s) => (s ? `${s.passed} of ${s.total} (${percent(s.rate)})` : 'not run');
const num = (n, digits = 3) => (typeof n === 'number' ? n.toFixed(digits) : 'n/a');

/**
 * The report for a run that drafted with retrieval off and on, side by side.
 * @param {{ off?: object, on?: object }} summaries the output of summarize() for each mode that ran
 * @param {{ model?: string, runsPerPrompt?: number, threshold?: number, verdicts?: { off?: string, on?: string }, usage?: { input: number, output: number }, cost?: number,
 *   figures?: object, style?: { off?: object, on?: object, approvedAvgWords?: number | null }, worst?: number }} meta
 */
export function renderComparison(summaries, { model, runsPerPrompt, threshold, verdicts = {}, usage, cost, figures, style = {}, worst = 3 } = {}) {
  const { off, on } = summaries;
  const lines = [];
  lines.push('# Resume bullet eval: retrieval off and on', '');
  if (model) lines.push(`Model: ${model}. Runs per prompt: ${runsPerPrompt ?? 'n/a'}. The same prompts, the same writing rules, and the same scorer for both columns.`, '');
  lines.push(`**Retrieval off: ${cell(off?.overall)}. Retrieval on: ${cell(on?.overall)}.**`);
  if (typeof threshold === 'number') {
    const parts = ['off', 'on'].filter((m) => summaries[m]).map((m) => `${m} ${verdicts[m] ?? (gate(summaries[m], threshold).ok ? 'PASS' : 'FAIL')}`);
    const all = parts.every((p) => p.endsWith('PASS')) ? 'PASS' : 'FAIL';
    lines.push(`Threshold: ${percent(threshold)} for each column. Result: ${all} (${parts.join(', ')}).`);
  } else {
    lines.push('Threshold: none recorded yet, so this run is report only.');
  }
  if (usage) lines.push(`Tokens: ${usage.input} in, ${usage.output} out${typeof cost === 'number' ? ` (about $${cost.toFixed(4)})` : ''}.`);

  lines.push('', '## Pass rate per rule', '', '| Rule | Off passed | Off rate | On passed | On rate |', '| --- | --- | --- | --- | --- |');
  for (const rule of RULES) {
    const a = off?.byRule[rule.id];
    const b = on?.byRule[rule.id];
    const left = (s) => (s ? [`${s.pass} of ${s.pass + s.fail}`, percent(s.rate)] : ['not run', 'n/a']);
    lines.push(`| ${rule.name} | ${left(a).join(' | ')} | ${left(b).join(' | ')} |`);
  }

  lines.push('', '## Pass rate per prompt', '', '| Prompt | Off | On | Rules broken, off | Rules broken, on |', '| --- | --- | --- | --- | --- |');
  const ids = Object.keys((off ?? on).byPrompt);
  const broke = (s) => Object.entries(s?.failedRules ?? {}).map(([rule, n]) => `${rule} x${n}`).join(', ') || 'none';
  for (const id of ids) lines.push(`| ${id} | ${cell(off?.byPrompt[id])} | ${cell(on?.byPrompt[id])} | ${broke(off?.byPrompt[id])} | ${broke(on?.byPrompt[id])} |`);

  if (figures) {
    lines.push('', '## Retrieval', '', '| Measure | Value |', '| --- | --- |');
    lines.push(`| recall@3 on the fixed test queries | ${figures.recallHits} of ${figures.recallAsked} (${percent(figures.recallAt3)}) |`);
    lines.push(`| Average similarity of the retrieved bullets | ${num(figures.avgSimilarity)} |`);
    lines.push(`| Average examples per prompt | ${num(figures.avgExamples, 1)} |`);
    lines.push(`| Prompts drafted without examples | ${figures.promptsWithoutExamples} of ${figures.prompts} |`);
  }

  if (style.off || style.on) {
    const s = (m, f) => (style[m] ? f(style[m]) : 'not run');
    lines.push('', '## Style signals (reported only, never part of the pass rate)', '', '| Signal | Off | On |', '| --- | --- | --- |');
    lines.push(`| Drafts that open with a verb an approved bullet already opens with | ${s('off', (x) => percent(x.verbReuse))} | ${s('on', (x) => percent(x.verbReuse))} |`);
    lines.push(`| Different opening verbs across all drafts | ${s('off', (x) => x.distinctVerbs)} | ${s('on', (x) => x.distinctVerbs)} |`);
    lines.push(`| Average words per draft (approved bullets: ${num(style.approvedAvgWords, 1)}) | ${s('off', (x) => num(x.avgWords, 1))} | ${s('on', (x) => num(x.avgWords, 1))} |`);
    lines.push('', 'A higher or lower number here is not better or worse by itself. Read the drafts.');
  }

  for (const [label, s] of [['on', on], ['off', off]]) {
    if (!s) continue;
    lines.push('', `## Worst failures with retrieval ${label} (up to ${worst}, with the model's actual output)`, '');
    if (s.failures.length === 0) lines.push('None.', '');
    for (const f of s.failures.slice(0, worst)) {
      lines.push(`Prompt \`${f.promptId}\` broke: ${f.failed.map((x) => `${x.rule} (${x.detail})`).join('; ')}`, '', fence(f.output), '');
    }
  }
  lines.push('## Manual review (not checked in code)', '', ...MANUAL_REVIEW.map((m) => `- ${m}`), '');
  return lines.join('\n');
}
