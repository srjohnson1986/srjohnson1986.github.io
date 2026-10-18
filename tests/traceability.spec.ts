import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { buildMatrix, collectTests, parseExemption, toHtml, toMarkdown, toRequirements } from '../scripts/lib/traceability.mjs';

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
