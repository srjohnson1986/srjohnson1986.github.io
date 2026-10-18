// Turns performance results into rows that put each measured value next to its budget, and renders them
// as a Markdown table for the CI job summary. Pure functions: no files, no network, no browser, so the
// tests can feed them made-up results (tests/performance.spec.ts).
//
// Two sources:
//   - Lighthouse CI: the budgets come from the assertMatrix in lighthouserc.cjs, the measured values from
//     the lhr-*.json files Lighthouse wrote (one per run). The value compared is the median of the runs,
//     the same rule the assertion uses, so the report and the gate agree.
//   - k6: the thresholds and the measured values both come from the file written by `k6 run --summary-export`.
//
// A result that is not there (a tool that did not run, a page that was not measured) is a failure, never a
// pass. Silence must not look like success.

/** How each Lighthouse assertion is read, shown, and compared. */
export const LIGHTHOUSE_METRICS = [
  { id: 'categories:performance', label: 'Performance score', read: (lhr) => lhr.categories?.performance?.score, show: (v) => String(Math.round(v * 100)), showLimit: (v) => String(Math.round(v * 100)) },
  { id: 'largest-contentful-paint', label: 'Largest contentful paint', read: (lhr) => lhr.audits?.['largest-contentful-paint']?.numericValue, show: (v) => `${Math.round(v)} ms`, showLimit: (v) => `${v} ms` },
  { id: 'total-blocking-time', label: 'Total blocking time', read: (lhr) => lhr.audits?.['total-blocking-time']?.numericValue, show: (v) => `${Math.round(v)} ms`, showLimit: (v) => `${v} ms` },
  { id: 'cumulative-layout-shift', label: 'Cumulative layout shift', read: (lhr) => lhr.audits?.['cumulative-layout-shift']?.numericValue, show: (v) => v.toFixed(4), showLimit: (v) => String(v) },
  { id: 'total-byte-weight', label: 'Total page weight', read: (lhr) => lhr.audits?.['total-byte-weight']?.numericValue, show: (v) => `${(v / 1024).toFixed(1)} KB`, showLimit: (v) => `${Math.round(v / 1024)} KB` },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const urlOf = (lhr) => lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl ?? '';
const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/**
 * The budgets in a Lighthouse CI config: one entry per page, each with its URL pattern, a readable page
 * name (the path), and the limits it sets. Only the metrics this report knows how to show are kept.
 */
export function readBudgets(config) {
  const urls = config.ci?.collect?.url ?? [];
  return (config.ci?.assert?.assertMatrix ?? []).map((entry) => {
    const pattern = new RegExp(entry.matchingUrlPattern);
    const url = urls.find((u) => pattern.test(u));
    const limits = [];
    for (const metric of LIGHTHOUSE_METRICS) {
      const assertion = entry.assertions?.[metric.id];
      if (!assertion) continue;
      const options = assertion[1] ?? {};
      if (options.minScore !== undefined) limits.push({ metric, op: '>=', limit: options.minScore });
      if (options.maxNumericValue !== undefined) limits.push({ metric, op: '<=', limit: options.maxNumericValue });
    }
    return { page: url ? pathOf(url) : entry.matchingUrlPattern, pattern, limits };
  });
}

const passes = (op, value, limit) => (op === '>=' ? value >= limit : value <= limit);
const words = (op) => (op === '>=' ? 'is under the minimum of' : 'is over the budget of');

/** One row per page and metric. `lhrs` are the parsed lhr-*.json files. */
export function lighthouseRows(budgets, lhrs) {
  const rows = [];
  for (const budget of budgets) {
    const runs = lhrs.filter((lhr) => budget.pattern.test(urlOf(lhr)));
    for (const { metric, op, limit } of budget.limits) {
      const values = runs.map((lhr) => metric.read(lhr)).filter((v) => typeof v === 'number' && Number.isFinite(v));
      const row = { tool: 'Lighthouse', page: budget.page, metric: metric.label, budget: `${op === '>=' ? 'at least' : 'at most'} ${metric.showLimit(limit)}`, runs: values.length };
      if (values.length === 0) {
        rows.push({ ...row, measured: 'no result', status: 'fail', message: `${budget.page} ${metric.label}: no Lighthouse result was found, so the budget could not be checked` });
        continue;
      }
      const value = median(values);
      const ok = passes(op, value, limit);
      rows.push({
        ...row,
        measured: metric.show(value),
        status: ok ? 'pass' : 'fail',
        message: ok ? '' : `${budget.page} ${metric.label}: ${metric.show(value)} ${words(op)} ${metric.showLimit(limit)}`,
      });
    }
  }
  return rows;
}

// What a k6 threshold looks like: "p(95)<100", "rate<0.01", "rate>0.99".
const K6_EXPRESSION = /^([\w()]+)\s*(<=|>=|<|>)\s*([\d.]+)$/;
const K6_REQUIRED = [
  { metric: 'http_req_failed', label: 'Failed requests' },
  { metric: 'http_req_duration', label: 'Response time' },
  { metric: 'checks', label: 'Checks passed' },
];
const K6_LABELS = Object.fromEntries(K6_REQUIRED.map((m) => [m.metric, m.label]));

const showK6 = (metric, stat, value) => {
  if (metric === 'http_req_duration') return `${Number(value).toFixed(2)} ms`;
  return `${(value * 100).toFixed(2)}%`; // http_req_failed and checks are rates
};
const showK6Limit = (metric, op, limit) => {
  const sign = op.startsWith('<') ? 'under' : 'over';
  if (metric === 'http_req_duration') return `${sign} ${limit} ms`;
  return `${sign} ${Number((limit * 100).toFixed(2))}%`;
};

/**
 * One row per k6 threshold, from the file `k6 run --summary-export` writes. In that file a threshold's
 * value is `true` when it was crossed (failed) and `false` when it held.
 */
export function k6Rows(summary) {
  const rows = [];
  for (const { metric, label } of K6_REQUIRED) {
    const data = summary?.metrics?.[metric];
    const thresholds = Object.entries(data?.thresholds ?? {});
    if (thresholds.length === 0) {
      rows.push({ tool: 'k6', page: 'all pages', metric: label, budget: 'a threshold', measured: 'no result', runs: 0, status: 'fail', message: `k6 ${label}: no threshold result was found for ${metric}, so it could not be checked` });
      continue;
    }
    for (const [expression, crossed] of thresholds) {
      const parsed = K6_EXPRESSION.exec(expression);
      const stat = parsed?.[1] ?? 'value';
      const op = parsed?.[2] ?? '<';
      const limit = Number(parsed?.[3] ?? NaN);
      // A Rate metric (failed requests, checks) keeps its answer in `value`; a Trend (response time) keeps one number per statistic, such as `p(95)`.
      const value = data[stat === 'rate' ? 'value' : stat];
      const measured = typeof value === 'number' ? showK6(metric, stat, value) : 'no value';
      const budget = parsed ? showK6Limit(metric, op, limit) : expression;
      const statLabel = metric === 'http_req_duration' ? ` (${stat})` : '';
      rows.push({
        tool: 'k6',
        page: 'all pages',
        metric: `${K6_LABELS[metric]}${statLabel}`,
        budget,
        measured,
        runs: 1,
        status: crossed === false ? 'pass' : 'fail',
        message: crossed === false ? '' : `k6 ${K6_LABELS[metric]}${statLabel}: ${measured} is not ${budget}`,
      });
    }
  }
  return rows;
}

/** True when any row failed. An empty list is also a failure: nothing was measured. */
export const anyFailed = (rows) => rows.length === 0 || rows.some((row) => row.status !== 'pass');

/** The Markdown for the CI job summary: a verdict line, the table, and one line per failure. */
export function toMarkdown(rows, { heading = 'Performance budgets' } = {}) {
  const failed = rows.filter((row) => row.status !== 'pass');
  const lines = [`## ${heading}`, ''];
  if (rows.length === 0) lines.push('**FAILED** - nothing was measured.', '');
  else if (failed.length === 0) lines.push(`**Passed** - all ${rows.length} checks are inside their budgets.`, '');
  else lines.push(`**FAILED** - ${failed.length} of ${rows.length} checks are outside their budgets.`, '');
  if (rows.length > 0) {
    lines.push('| Tool | Page | Metric | Measured | Budget | Result |', '| --- | --- | --- | --- | --- | --- |');
    for (const row of rows) {
      lines.push(`| ${row.tool} | ${row.page} | ${row.metric} | ${row.measured} | ${row.budget} | ${row.status === 'pass' ? 'pass' : '**FAIL**'} |`);
    }
    lines.push('');
  }
  if (failed.length > 0) {
    lines.push('### What failed', '');
    for (const row of failed) lines.push(`- ${row.message}`);
    lines.push('');
  }
  lines.push('Lighthouse values are the median of the runs on each page, measured against a local preview server of the built site. k6 values are one short run with a few virtual users against the same server.', '');
  return lines.join('\n');
}
