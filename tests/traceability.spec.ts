import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { buildMatrix, collectTests, parseExemption, summarize, toHtml, toMarkdown, toRequirements } from '../scripts/lib/traceability.mjs';

// The requirements traceability check (scripts/traceability.mjs, logic in scripts/lib/traceability.mjs),
// run on made-up requirements and a made-up Playwright report. No browser or network needed.

type Issue = Record<string, unknown>;
const issue = (number: number, extra: Issue = {}): Issue => ({
  number,
  title: `REQ: Requirement ${number}`,
  html_url: `https://example.test/issues/${number}`,
  state: 'open',
  labels: [{ name: 'requirement' }],
  body: `## Requirement\n\nIt works.\n\n## Acceptance criteria\n\n- [ ] it does\n`,
  ...extra,
});
const spec = (title: string, tags: string[], status = 'expected', file = 'a.spec.ts') => ({
  title,
  file,
  line: 1,
  tags,
  tests: [{ projectName: 'site', status, results: [{ status: 'passed' }] }],
});
const report = (...specs: Record<string, unknown>[]) => ({ suites: [{ title: 'a.spec.ts', specs }] });

const run = (issues: Issue[], reports: unknown[]) => {
  const m = buildMatrix(toRequirements(issues), collectTests(reports));
  return { m, kinds: m.problems.map((p: { kind: string }) => p.kind) as string[] };
};

test.describe('the traceability check', { tag: ['@req-355'] }, () => {
  test('a requirement with a linked test passes', () => {
    const { m, kinds } = run([issue(1)], [report(spec('does it', ['req-1']))]);
    expect(kinds).toEqual([]);
    expect(m.rows[0].coverage).toBe('covered');
    expect(m.rows[0].result).toBe('passed');
  });

  test('tags are read with or without the @ sign, and one test can verify several requirements', () => {
    const { m, kinds } = run([issue(1), issue(2)], [report(spec('both', ['@req-1', 'req-2']))]);
    expect(kinds).toEqual([]);
    expect(m.rows.map((r: { tests: unknown[] }) => r.tests.length)).toEqual([1, 1]);
  });

  test('a requirement with no test fails', () => {
    const { kinds, m } = run([issue(1), issue(2)], [report(spec('only one', ['req-1']))]);
    expect(kinds).toEqual(['untested']);
    expect(m.problems[0].message).toContain('#2');
  });

  test('no-automated-test with a written reason passes; without one it fails', () => {
    const reasoned = issue(2, { labels: [{ name: 'requirement' }, { name: 'no-automated-test' }], body: '## Requirement\n\nX\n\n## No automated test - reason\n\nA person judges this by reading it.\n' });
    const bare = issue(3, { labels: [{ name: 'requirement' }, { name: 'no-automated-test' }] });
    const empty = issue(4, { labels: [{ name: 'requirement' }, { name: 'no-automated-test' }], body: '## No automated test - reason\n\n## Other\n\ntext\n' });
    const tests = [report(spec('one', ['req-1']))];
    expect(run([issue(1), reasoned], tests).kinds).toEqual([]);
    expect(run([issue(1), bare], tests).kinds).toEqual(['no-reason']);
    expect(run([issue(1), empty], tests).kinds).toEqual(['no-reason']);
  });

  test('the reason is read up to the next heading', () => {
    expect(parseExemption('## No automated test - reason\n\nBecause.\nStill because.\n\n## Next\n\nno')).toBe('Because. Still because.');
    expect(parseExemption('## Requirement\n\nno exemption here')).toBe('');
  });

  test('a test tagged with a number that is not a requirement fails', () => {
    const plainIssue = issue(9, { labels: [{ name: 'bug' }] });
    const { kinds, m } = run([issue(1), plainIssue], [report(spec('ok', ['req-1']), spec('typo', ['req-999']), spec('wrong kind', ['req-9']))]);
    expect(kinds).toEqual(['unknown', 'unknown']);
    expect(m.problems.map((p: { message: string }) => p.message).join('\n')).toMatch(/@req-999.*not a requirement/);
  });

  test('a test with no requirement tag fails', () => {
    const { kinds } = run([issue(1)], [report(spec('ok', ['req-1']), spec('stray', ['smoke']))]);
    expect(kinds).toEqual(['untagged']);
  });

  test('a retired requirement is left out, and a test still pointing at it fails', () => {
    const retired = issue(2, { state: 'closed', state_reason: 'not_planned' });
    const clean = run([issue(1), retired], [report(spec('ok', ['req-1']))]);
    expect(clean.kinds).toEqual([]);
    expect(clean.m.rows).toHaveLength(1);
    expect(run([issue(1), retired], [report(spec('ok', ['req-1', 'req-2']))]).kinds).toEqual(['retired']);
  });

  test('a requirement closed as completed still counts, and pull requests are ignored', () => {
    const done = issue(2, { state: 'closed', state_reason: 'completed' });
    const pr = issue(3, { pull_request: {} });
    const { kinds, m } = run([issue(1), done, pr], [report(spec('ok', ['req-1']))]);
    expect(kinds).toEqual(['untested']);
    expect(m.rows).toHaveLength(2);
  });

  test('the last result is the worst result, and tests that did not run say so', () => {
    const failing = report(spec('a', ['req-1']), spec('b', ['req-1'], 'unexpected'));
    expect(run([issue(1)], [failing]).m.rows[0].result).toBe('failed');
    const listed = { suites: [{ specs: [{ title: 'smoke', file: 's.spec.ts', line: 3, tags: ['req-1'], tests: [{ projectName: 'smoke', results: [] }] }] }] };
    const { m, kinds } = run([issue(1)], [listed]);
    expect(kinds).toEqual([]);
    expect(m.rows[0].result).toBe('not run');
  });

  test('linked tests are counted per test, even when titles repeat', () => {
    const { m } = run([issue(1)], [report(spec('same', ['req-1']), spec('same', ['req-1']), spec('stray', []))]);
    expect(m.testCount).toBe(3);
    expect(m.linkedCount).toBe(2);
  });

  test('the markdown and HTML list every requirement and escape what they print', () => {
    const odd = issue(5, { title: 'REQ: Handles <b>markup</b> | pipes' });
    const { m } = run([issue(1), odd], [report(spec('ok', ['req-1', 'req-5']))]);
    const md = toMarkdown(m, { generated: 'now' });
    const html = toHtml(m, { generated: 'now' });
    for (const text of [md, html]) {
      expect(text).toContain('#1');
      expect(text).toContain('#5');
    }
    expect(md).toContain('\\|');
    expect(html).toContain('&lt;b&gt;markup');
    expect(html).not.toContain('<b>markup');
  });

  test('the command line exits 1 on a gap, 0 on a clean matrix, and writes the report either way', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-'));
    const write = (name: string, data: unknown) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, JSON.stringify(data));
      return file;
    };
    const smoke = write('smoke.json', { suites: [{ specs: [{ title: 's', file: 's.spec.ts', line: 1, tags: ['req-1'], tests: [{ projectName: 'smoke', results: [] }] }] }] });
    const results = write('results.json', report(spec('ok', ['req-1'])));
    const cli = (issues: Issue[], out: string) =>
      spawnSync(process.execPath, [path.join(root, 'scripts', 'traceability.mjs'), '--results', results, '--results', smoke, '--requirements', write(`${out}.json`, issues), '--out', path.join(dir, out)], { encoding: 'utf8' });

    const ok = cli([issue(1)], 'ok');
    expect(ok.status, ok.stderr).toBe(0);
    expect(fs.existsSync(path.join(dir, 'ok', 'traceability.html'))).toBe(true);

    const bad = cli([issue(1), issue(2)], 'bad');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('#2');
    expect(fs.readFileSync(path.join(dir, 'bad', 'traceability.md'), 'utf8')).toContain('No test');
  });
});

// A requirement issue is opened before its tests are merged (issue first). Until they are, every other
// pull request and the next deploy would see a requirement with no test. The `planned` label says so.
test.describe('planned requirements', { tag: ['@req-438'] }, () => {
  const planned = (number: number, extra: Issue = {}) => issue(number, { labels: [{ name: 'requirement' }, { name: 'planned' }], ...extra });
  const one = [report(spec('one', ['req-1']))];
  const warningsOf = (m: { warnings: { kind: string; message: string }[] }) => m.warnings;

  test('a planned requirement with no test is shown as planned, not as a gap', () => {
    const { m, kinds } = run([issue(1), planned(2)], one);
    expect(kinds).toEqual([]);
    expect(warningsOf(m)).toEqual([]);
    expect(m.rows[1].coverage).toBe('planned');
    expect(summarize(m)).toMatchObject({ requirements: 2, covered: 1, planned: 1, gaps: 0 });
    // The label is what makes the difference: the same requirement without it is a gap.
    const bare = run([issue(1), issue(2)], one);
    expect(bare.kinds).toEqual(['untested']);
    expect(summarize(bare.m)).toMatchObject({ planned: 0, gaps: 1 });
  });

  test('a planned requirement that already has tests counts as tested and warns that the label is stale', () => {
    const { m, kinds } = run([issue(1), planned(2)], [report(spec('one', ['req-1']), spec('two', ['req-2']), spec('two again', ['req-2']))]);
    expect(kinds, 'a stale label is a warning, not a problem').toEqual([]);
    expect(m.rows[1].coverage).toBe('covered');
    expect(summarize(m)).toMatchObject({ covered: 2, planned: 0, gaps: 0 });
    expect(warningsOf(m).map((w) => w.kind)).toEqual(['stale-planned']);
    expect(warningsOf(m)[0].message).toMatch(/#2 .*planned label.*2 linked tests/);
    // No warning for a tested requirement that never had the label.
    expect(warningsOf(run([issue(1)], one).m)).toEqual([]);
  });

  test('the planned label does not hide a missing reason, and is stale next to a written reason', () => {
    const both = [{ name: 'requirement' }, { name: 'planned' }, { name: 'no-automated-test' }];
    const noReason = run([issue(1), issue(2, { labels: both })], one);
    expect(noReason.kinds).toEqual(['no-reason']);
    const reasoned = run([issue(1), issue(2, { labels: both, body: '## No automated test - reason\n\nA person judges this by reading it.\n' })], one);
    expect(reasoned.kinds).toEqual([]);
    expect(reasoned.m.rows[1].coverage).toBe('exempt');
    expect(warningsOf(reasoned.m).map((w) => w.kind)).toEqual(['stale-planned']);
  });

  test('the planned label excuses nothing else: bad tags and untagged tests still fail', () => {
    const { kinds } = run([issue(1), planned(2)], [report(spec('ok', ['req-1']), spec('typo', ['req-999']), spec('stray', []))]);
    expect(kinds.sort()).toEqual(['unknown', 'untagged']);
    // A retired requirement stays retired whatever its labels say.
    const retired = planned(3, { state: 'closed', state_reason: 'not_planned' });
    expect(run([issue(1), retired], one).m.rows).toHaveLength(1);
  });

  test('the report shows a planned row and no problems section, and a stale label in a separate warnings section', () => {
    const fresh = run([issue(1), planned(2)], one).m;
    const md = toMarkdown(fresh);
    expect(md).toContain('2 requirements: 1 tested, 0 manual with a written reason, 1 planned, 0 gaps.');
    expect(md).toMatch(/#2\]\(.*\) Requirement 2 \| Planned \(tests not merged yet\) \| none yet \| n\/a \|/);
    expect(md).not.toContain('## Problems');
    expect(md).not.toContain('## Warnings');
    const html = toHtml(fresh);
    // The smoke test fails the live site on a .problems section, so a planned requirement must not make one.
    expect(html).not.toContain('class="problems"');
    expect(html).not.toContain('class="warnings"');
    expect(html).toContain('class="ok"');
    expect(html).toContain('<tr class="planned">');
    expect(html).toContain('1 planned, 0 gaps.');

    const stale = run([issue(1), planned(2)], [report(spec('one', ['req-1']), spec('two', ['req-2']))]).m;
    expect(toMarkdown(stale)).toMatch(/## Warnings\n\n- Requirement #2 /);
    const staleHtml = toHtml(stale);
    expect(staleHtml).toContain('<section class="warnings"');
    expect(staleHtml).not.toContain('class="problems"');
    expect(staleHtml).toContain('class="ok"');

    // With nothing planned the summary reads as it always did.
    expect(toMarkdown(run([issue(1)], one).m)).toContain('1 requirements: 1 tested, 0 manual with a written reason, 0 gaps.');
  });

  test('the command line exits 0 for a planned requirement and for a stale label, and prints the warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-planned-'));
    const write = (name: string, data: unknown) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, JSON.stringify(data));
      return file;
    };
    const smoke = write('smoke.json', { suites: [{ specs: [{ title: 's', file: 's.spec.ts', line: 1, tags: ['req-1'], tests: [{ projectName: 'smoke', results: [] }] }] }] });
    // Run as if outside GitHub Actions, so the output is the same on a laptop and in CI and nothing is
    // added to the real job summary.
    const plainEnv: NodeJS.ProcessEnv = { ...process.env };
    delete plainEnv.GITHUB_ACTIONS;
    delete plainEnv.GITHUB_STEP_SUMMARY;
    const cli = (name: string, issues: Issue[], specs: Record<string, unknown>[], env: NodeJS.ProcessEnv = plainEnv) =>
      spawnSync(
        process.execPath,
        [path.join(root, 'scripts', 'traceability.mjs'), '--results', write(`${name}-results.json`, report(...specs)), '--results', smoke, '--requirements', write(`${name}.json`, issues), '--out', path.join(dir, name)],
        { encoding: 'utf8', env },
      );

    const gap = cli('gap', [issue(1), issue(2)], [spec('ok', ['req-1'])]);
    expect(gap.status, 'without the label it is a gap').toBe(1);

    const fresh = cli('fresh', [issue(1), planned(2)], [spec('ok', ['req-1'])]);
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.stdout).toContain('1 planned, 0 gaps');
    expect(fresh.stdout).toContain('0 problem(s), 0 warning(s)');
    expect(fresh.stderr).toBe('');
    expect(fs.readFileSync(path.join(dir, 'fresh', 'traceability.md'), 'utf8')).toContain('Planned (tests not merged yet)');

    const stale = cli('stale', [issue(1), planned(2)], [spec('ok', ['req-1']), spec('new', ['req-2'])]);
    expect(stale.status, stale.stderr).toBe(0);
    expect(stale.stdout).toContain('0 problem(s), 1 warning(s)');
    expect(stale.stderr).toMatch(/warning: Requirement #2 .*planned label/);

    // In GitHub Actions the warning is an annotation, and still not an error.
    const inCi = cli('ci', [issue(1), planned(2)], [spec('ok', ['req-1']), spec('new', ['req-2'])], { ...plainEnv, GITHUB_ACTIONS: 'true' });
    expect(inCi.status, inCi.stderr).toBe(0);
    expect(inCi.stderr).toContain('::warning title=Traceability::Requirement #2 ');
    expect(inCi.stderr).not.toContain('::error');
  });
});
