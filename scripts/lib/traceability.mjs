// The logic behind the requirements traceability report. It has no file or network access, so
// tests/traceability.spec.ts can run it on made-up data. The command line wrapper is
// scripts/traceability.mjs.
//
// Convention (README, "Requirements traceability"):
//   - A requirement is a GitHub issue labelled `requirement`. Closed as "not planned" means retired.
//   - A test names the requirements it verifies with Playwright tags: { tag: ['@req-12'] }.
//   - A requirement with no test needs the `no-automated-test` label and a written reason in a
//     "## No automated test - reason" section of its body.

export const REQUIREMENT_LABEL = 'requirement';
export const EXEMPT_LABEL = 'no-automated-test';

/** The written reason from the "## No automated test" section of an issue body ('' if missing). */
export function parseExemption(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+no automated test\b/i.test(l.trim()));
  if (start < 0) return '';
  const rest = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    rest.push(line);
  }
  return rest.join(' ').replace(/\s+/g, ' ').trim();
}

/** Turns GitHub issue objects into requirement records, leaving out pull requests and other issues. */
export function toRequirements(issues) {
  return issues
    .filter((i) => !i.pull_request)
    .filter((i) => (i.labels ?? []).some((l) => (typeof l === 'string' ? l : l.name) === REQUIREMENT_LABEL))
    .map((i) => {
      const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
      return {
        number: i.number,
        title: String(i.title).replace(/^REQ:\s*/i, ''),
        url: i.html_url ?? '',
        state: i.state,
        retired: i.state === 'closed' && i.state_reason === 'not_planned',
        exempt: labels.includes(EXEMPT_LABEL),
        reason: parseExemption(i.body),
      };
    })
    .sort((a, b) => a.number - b.number);
}

const reqNumbers = (tags) =>
  (tags ?? []).map((t) => /^@?req-(\d+)$/.exec(t)).filter(Boolean).map((m) => Number(m[1]));

/** Every test in one or more Playwright JSON reports, with its requirement numbers and result. */
export function collectTests(reports) {
  const out = [];
  for (const report of reports) {
    const walk = (suite) => {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const ran = (test.results ?? []).length > 0;
          const status = !ran ? 'not run' : test.status === 'expected' ? 'passed' : test.status === 'unexpected' ? 'failed' : test.status === 'flaky' ? 'flaky' : 'skipped';
          out.push({
            project: test.projectName ?? '',
            file: spec.file,
            line: spec.line,
            title: spec.title,
            status,
            reqs: reqNumbers(spec.tags),
          });
        }
      }
      for (const child of suite.suites ?? []) walk(child);
    };
    for (const suite of report.suites ?? []) walk(suite);
  }
  return out;
}

const RANK = ['failed', 'flaky', 'passed', 'skipped', 'not run'];

/** The worst status wins: failed, then flaky, then passed, then skipped, then not run. */
export const rollUp = (statuses) => RANK.find((r) => statuses.includes(r)) ?? 'not run';

export function buildMatrix(requirements, tests) {
  const known = new Map(requirements.map((r) => [r.number, r]));
  const rows = requirements
    .filter((r) => !r.retired)
    .map((r) => {
      const linked = tests.filter((t) => t.reqs.includes(r.number));
      const reasonOk = r.exempt && r.reason.length >= 10;
      const coverage = linked.length > 0 ? 'covered' : reasonOk ? 'exempt' : r.exempt ? 'exempt-no-reason' : 'gap';
      return { ...r, tests: linked, coverage, result: linked.length ? rollUp(linked.map((t) => t.status)) : 'none' };
    });
  const problems = [];
  for (const row of rows) {
    if (row.coverage === 'gap') problems.push({ kind: 'untested', message: `Requirement #${row.number} (${row.title}) has no linked test and no ${EXEMPT_LABEL} label.` });
    if (row.coverage === 'exempt-no-reason') problems.push({ kind: 'no-reason', message: `Requirement #${row.number} (${row.title}) has the ${EXEMPT_LABEL} label but no written reason. Add a "## No automated test - reason" section.` });
  }
  for (const t of tests) {
    const where = `${t.file}:${t.line} "${t.title}"`;
    if (t.reqs.length === 0) problems.push({ kind: 'untagged', message: `Test ${where} has no @req-N tag.` });
    for (const n of t.reqs) {
      const r = known.get(n);
      if (!r) problems.push({ kind: 'unknown', message: `Test ${where} is tagged @req-${n}, which is not a requirement (no such issue, or it does not have the ${REQUIREMENT_LABEL} label).` });
      else if (r.retired) problems.push({ kind: 'retired', message: `Test ${where} is tagged @req-${n}, which is retired (closed as not planned).` });
    }
  }
  // Several projects can repeat a problem for the same test; show each message once.
  const seen = new Set();
  const unique = problems.filter((p) => (seen.has(p.message) ? false : seen.add(p.message)));
  const retired = requirements.filter((r) => r.retired);
  return { rows, problems: unique, retired, testCount: tests.length };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mdCell = (s) => String(s).replace(/\|/g, '\\|');
const LABEL = { covered: 'Tested', exempt: 'Manual (reason given)', 'exempt-no-reason': 'Manual, reason missing', gap: 'No test' };

function counts(tests) {
  const c = {};
  for (const t of tests) c[t.status] = (c[t.status] ?? 0) + 1;
  return Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ');
}
const byFile = (tests) => {
  const m = new Map();
  for (const t of tests) m.set(t.file, (m.get(t.file) ?? 0) + 1);
  return [...m].map(([f, n]) => `${f} (${n})`).join(', ');
};

export function summarize(matrix) {
  const { rows } = matrix;
  return {
    requirements: rows.length,
    covered: rows.filter((r) => r.coverage === 'covered').length,
    exempt: rows.filter((r) => r.coverage === 'exempt').length,
    gaps: rows.filter((r) => r.coverage === 'gap' || r.coverage === 'exempt-no-reason').length,
    tests: matrix.testCount,
    linked: new Set(rows.flatMap((r) => r.tests.map((t) => `${t.project}|${t.file}|${t.line}|${t.title}`))).size,
  };
}

export function toMarkdown(matrix, meta = {}) {
  const s = summarize(matrix);
  const out = ['# Requirements traceability matrix', ''];
  out.push(`${s.requirements} requirements: ${s.covered} tested, ${s.exempt} manual with a written reason, ${s.gaps} gaps. ${s.tests} tests, all linked: ${matrix.problems.some((p) => p.kind === 'untagged') ? 'no' : 'yes'}.`, '');
  if (meta.generated) out.push(`Generated ${meta.generated}${meta.commit ? ` from commit ${meta.commit}` : ''}.`, '');
  if (matrix.problems.length) {
    out.push('## Problems', '', ...matrix.problems.map((p) => `- ${p.message}`), '');
  }
  out.push('## Matrix', '', '| Requirement | Coverage | Tests | Last result |', '| --- | --- | --- | --- |');
  for (const r of matrix.rows) {
    const link = r.url ? `[#${r.number}](${r.url})` : `#${r.number}`;
    const tests = r.tests.length ? `${r.tests.length}: ${mdCell(byFile(r.tests))}` : r.coverage === 'exempt' ? `Manual: ${mdCell(r.reason)}` : 'none';
    const result = r.tests.length ? `${r.result} (${counts(r.tests)})` : 'n/a';
    out.push(`| ${link} ${mdCell(r.title)} | ${LABEL[r.coverage]} | ${tests} | ${result} |`);
  }
  if (matrix.retired.length) out.push('', `Retired requirements (not counted): ${matrix.retired.map((r) => `#${r.number}`).join(', ')}.`);
  return out.join('\n') + '\n';
}

export function toHtml(matrix, meta = {}) {
  const s = summarize(matrix);
  const rows = matrix.rows
    .map((r) => {
      const link = r.url ? `<a href="${esc(r.url)}">#${r.number}</a>` : `#${r.number}`;
      const list = r.tests.length
        ? `<details><summary>${r.tests.length} test${r.tests.length === 1 ? '' : 's'} in ${new Set(r.tests.map((t) => t.file)).size} file${new Set(r.tests.map((t) => t.file)).size === 1 ? '' : 's'}</summary><ul>${r.tests
            .map((t) => `<li><span class="st ${t.status.replace(' ', '-')}">${t.status}</span> <code>${esc(t.file)}:${t.line}</code> ${esc(t.title)}${t.project ? ` <small>[${esc(t.project)}]</small>` : ''}</li>`)
            .join('')}</ul></details>`
        : r.coverage === 'exempt'
          ? `<p class="reason"><strong>Manual.</strong> ${esc(r.reason)}</p>`
          : '<p class="reason">None.</p>';
      const result = r.tests.length ? `<span class="st ${r.result.replace(' ', '-')}">${r.result}</span> <small>${esc(counts(r.tests))}</small>` : 'n/a';
      return `<tr class="${r.coverage}"><th scope="row">${link} ${esc(r.title)}</th><td>${LABEL[r.coverage]}</td><td>${list}</td><td>${result}</td></tr>`;
    })
    .join('\n');
  const problems = matrix.problems.length
    ? `<section class="problems" aria-labelledby="p"><h2 id="p">Problems</h2><ul>${matrix.problems.map((p) => `<li>${esc(p.message)}</li>`).join('')}</ul></section>`
    : '<p class="ok">No problems: every requirement has a test or a written reason, and every test names a real requirement.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Requirements traceability matrix</title>
<style>
:root { --bg: #fff; --fg: #1b1b1f; --muted: #55555f; --line: #d4d4dc; --accent: #1a56c4; --ok: #0b6b34; --bad: #a3141f; --warn: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --bg: #15161a; --fg: #ececf1; --muted: #a6a6b3; --line: #34353d; --accent: #8db4ff; --ok: #6fd694; --bad: #ff8d95; --warn: #f0c36b; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 1rem/1.5 system-ui, sans-serif; }
main { max-width: 72rem; margin: 0 auto; padding: 1rem; }
a { color: var(--accent); }
table { border-collapse: collapse; width: 100%; }
th, td { border-top: 1px solid var(--line); padding: .5rem .6rem; text-align: left; vertical-align: top; }
thead th { border-top: 0; color: var(--muted); }
tbody th { font-weight: 600; }
code { font-size: .85em; }
small, .reason { color: var(--muted); }
.st { font-weight: 600; }
.passed { color: var(--ok); } .failed, .gap, .exempt-no-reason { color: var(--bad); } .flaky, .skipped { color: var(--warn); }
.problems { border: 2px solid var(--bad); padding: 0 1rem; border-radius: .5rem; }
.ok { color: var(--ok); font-weight: 600; }
details ul { margin: .4rem 0 0; padding-left: 1.2rem; }
@media (max-width: 40rem) { thead { display: none; } tr, td, th { display: block; } }
</style>
</head>
<body>
<main>
<p><a href="/development-qa/this-site/">Back to the This site page</a></p>
<h1>Requirements traceability matrix</h1>
<p>${s.requirements} requirements: ${s.covered} tested, ${s.exempt} manual with a written reason, ${s.gaps} gaps. ${s.tests} tests, ${s.linked} linked to a requirement.</p>
<p><small>${meta.generated ? `Generated ${esc(meta.generated)}${meta.commit ? ` from commit ${esc(meta.commit)}` : ''}. ` : ''}Requirements are GitHub issues labelled <code>requirement</code>; tests name them with <code>@req-N</code> tags. See the README for the convention.</small></p>
${problems}
<table>
<thead><tr><th scope="col">Requirement</th><th scope="col">Coverage</th><th scope="col">Tests</th><th scope="col">Last result</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</main>
</body>
</html>
`;
}
