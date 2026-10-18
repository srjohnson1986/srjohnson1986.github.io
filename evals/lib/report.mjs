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

const fence = (text) => '```\n' + String(text).replace(/```/g, "'''") + '\n```';

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
