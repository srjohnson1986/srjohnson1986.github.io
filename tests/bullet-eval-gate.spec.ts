import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { summarize, gate, renderReport } from '../evals/lib/report.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { PROMPTS } from '../evals/resume-bullets/prompts.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MODEL, RUNS_PER_PROMPT, MAX_CALLS, MAX_TOKENS } from '../evals/resume-bullets/config.mjs';

// The report and the pass or fail decision for the AI resume bullet eval (evals/lib/report.mjs and
// evals/resume-bullets/run.mjs). The numbers are fixed and the "model" is either saved replies or a
// local stand-in server, so none of this calls the real API or costs anything. No browser needed.

const execFileAsync = promisify(execFile);
const runner = path.join(root, 'evals', 'resume-bullets', 'run.mjs');
const fixture = (name: string) => path.join(root, 'tests', 'fixtures', 'bullet-eval', name);
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.GITHUB_STEP_SUMMARY;
  return env;
};
const run = (args: string[], env: NodeJS.ProcessEnv = cleanEnv()) => spawnSync('node', [runner, ...args], { encoding: 'utf8', env, cwd: root });

const miniPrompts = [
  { id: 'a', kind: 'normal', input: 'I built a thing for 3 teams.' },
  { id: 'b', kind: 'count', input: 'The project has 10 issues.' },
];

test.describe('bullet eval report and threshold', { tag: ['@req-366'] }, () => {
  test('counts passes per rule and per prompt, and leaves out rules that do not apply', () => {
    const summary = summarize(miniPrompts, [
      { promptId: 'a', outputs: ['Built a thing for 3 teams.', 'Helped build a thing for 3 teams.', 'Built a thing for 9 teams.'] },
      { promptId: 'b', outputs: ['Shipped 10+ issues of work.', 'Shipped 10 issues of work.'] },
    ]);
    expect(summary.overall).toMatchObject({ passed: 2, total: 5 });
    expect(summary.overall.rate).toBeCloseTo(0.4);
    expect(summary.byPrompt.a).toMatchObject({ passed: 1, total: 3 });
    expect(summary.byPrompt.a.failedRules).toEqual({ 'strong-verb': 1, 'no-invented-numbers': 1 });
    expect(summary.byPrompt.b).toMatchObject({ passed: 1, total: 2 });
    // Of five outputs only the two that name "10 issues" have a count; the other three are not applicable.
    expect(summary.byRule['count-floor']).toMatchObject({ pass: 1, fail: 1, na: 3 });
    expect(summary.byRule['count-floor'].rate).toBeCloseTo(0.5);
    expect(summary.byRule['single-hyphens']).toMatchObject({ pass: 5, fail: 0, na: 0, rate: 1 });
    expect(summary.byRule['no-leaked-strings']).toMatchObject({ pass: 0, fail: 0, na: 5, rate: null });
  });

  test('lists the worst failures first, with the model output', () => {
    const summary = summarize(miniPrompts, [
      { promptId: 'a', outputs: ['Built a thing for 3 teams.', 'Helped build a thing for 99 teams.', 'Build a thing for 3 teams.'] },
      { promptId: 'b', outputs: [] },
    ]);
    expect(summary.failures.map((f: { output: string }) => f.output)).toEqual(['Helped build a thing for 99 teams.', 'Build a thing for 3 teams.']);
    const report = renderReport(summary, { model: 'test-model', runsPerPrompt: 3, threshold: 0.9 });
    expect(report).toContain('Helped build a thing for 99 teams.');
    expect(report).toContain('## Pass rate per rule');
    expect(report).toContain('## Pass rate per prompt');
    expect(report).toContain('## Manual review');
    expect(report).toContain('FAIL');
    expect(report).not.toMatch(/\u2014|\u2013/);
  });

  test('the decision passes at the threshold and fails just below it', () => {
    const outputs = (good: number, bad: number) => [...Array(good).fill('Built a thing for 3 teams.'), ...Array(bad).fill('Build a thing for 3 teams.')];
    const nine = summarize(miniPrompts, [{ promptId: 'a', outputs: outputs(9, 1) }]);
    expect(gate(nine, 0.9).ok).toBe(true);
    expect(gate(nine, 0.91).ok).toBe(false);
    expect(gate(nine, 0).ok).toBe(true);
    expect(gate(nine, 1).ok).toBe(false);
    const empty = summarize(miniPrompts, []);
    expect(gate(empty, 0).ok, 'no outputs is never a pass').toBe(false);
  });

  test('a bad threshold or a result for an unknown prompt is an error, not a silent pass', () => {
    const summary = summarize(miniPrompts, [{ promptId: 'a', outputs: ['Built a thing for 3 teams.'] }]);
    for (const bad of [-0.1, 1.1, Number.NaN, '0.9', undefined]) expect(() => gate(summary, bad)).toThrow(/threshold/);
    expect(() => summarize(miniPrompts, [{ promptId: 'zzz', outputs: ['x'] }])).toThrow(/does not exist/);
  });

  test('the run is small and capped', () => {
    expect(PROMPTS.length * RUNS_PER_PROMPT).toBeLessThanOrEqual(MAX_CALLS);
    expect(MAX_CALLS).toBeLessThanOrEqual(100);
    expect(MAX_TOKENS).toBeLessThanOrEqual(1000);
    expect(RUNS_PER_PROMPT).toBeGreaterThanOrEqual(3);
  });

  test('a baseline from a real run is recorded, and it matches the prompts, system prompt, and model in the repo', async () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'baseline.json'), 'utf8'));
    // @ts-expect-error - plain JavaScript module with no type declarations
    const { fingerprint } = await import('../evals/resume-bullets/run.mjs');
    expect(baseline.threshold, 'a threshold is recorded').toBeGreaterThan(0.5);
    expect(baseline.threshold).toBeLessThanOrEqual(1);
    expect(baseline.model).toBe(MODEL);
    expect(baseline.runsPerPrompt).toBe(RUNS_PER_PROMPT);
    expect(baseline.prompts).toBe(PROMPTS.length);
    expect(baseline.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(baseline.overall.total).toBe(PROMPTS.length * RUNS_PER_PROMPT);
    expect(baseline.overall.rate, 'the recorded run passed its own threshold').toBeGreaterThanOrEqual(baseline.threshold);
    expect(Object.keys(baseline.byRule).sort()).toEqual(['bare-one-sentence', 'count-floor', 'no-invented-numbers', 'no-leaked-strings', 'no-phone', 'past-tense-verb', 'single-hyphens', 'strong-verb']);
    expect(Object.keys(baseline.byPrompt).sort()).toEqual(PROMPTS.map((p: { id: string }) => p.id).sort());
    // If a prompt, the system prompt, the model, or the runs per prompt changed, the old baseline no longer
    // describes what the eval asks. Run the eval again and record a new one (see the README).
    expect(baseline.fingerprint, 'the prompts, system prompt, or model changed since the baseline was recorded: record a new baseline').toBe(fingerprint());
  });

  test('replaying good replies passes the gate (exit 0)', () => {
    const result = run(['--replay', fixture('replay-good.json'), '--threshold', '0.9']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('PASS');
  });

  test('replaying known-bad replies fails the gate (exit 1) and shows the actual output', () => {
    const result = run(['--replay', fixture('replay-bad.json'), '--threshold', '0.9']);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('FAIL');
    expect(result.stdout).toContain('Build a Playwright test suite that checks every resume version.');
    // Every rule that can apply was broken by at least one saved reply.
    const rows = result.stdout.split('\n').filter((l: string) => /^\| .* \| \d+ \| \d+ \| \d+ \| \S+ \|$/.test(l));
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const failed = Number(row.split('|')[3]);
      expect(failed, row).toBeGreaterThan(0);
    }
  });

  test('a threshold set one step above the pass rate fails, one step below passes', () => {
    // replay-good scores 100%. A threshold of exactly 1 still passes; the bad file never reaches even 0.5.
    expect(run(['--replay', fixture('replay-good.json'), '--threshold', '1']).status).toBe(0);
    expect(run(['--replay', fixture('replay-bad.json'), '--threshold', '0.5']).status).toBe(1);
    expect(run(['--replay', fixture('replay-bad.json'), '--threshold', '0']).status).toBe(0);
  });

  test('a run that cannot be done exits 2, not 1, and makes no API call', () => {
    const tooMany = run(['--runs', '100']);
    expect(tooMany.status).toBe(2);
    expect(tooMany.stderr).toMatch(/Refusing to run.*cap of 60/);
    const noKey = run([]);
    expect(noKey.status).toBe(2);
    expect(noKey.stderr).toContain('ANTHROPIC_API_KEY is not set');
    expect(run(['--replay', fixture('does-not-exist.json')]).status).toBe(2);
    expect(run(['--bogus']).status).toBe(2);
    expect(run(['--threshold', '2']).status).toBe(2);
    expect(run(['--replay', fixture('replay-good.json'), '--update-baseline', '--threshold', '0.9']).status, 'replies that do not name a model and date cannot become a baseline').toBe(2);
  });

  test('an API error exits 2 and never prints the key', async () => {
    const fakeKey = 'sk-ant-test-0000000000000000';
    // Nothing listens on this port, so every request fails to connect.
    const env = { ...cleanEnv(), ANTHROPIC_API_KEY: fakeKey, ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' };
    const result = await execFileAsync('node', [runner, '--runs', '1', '--threshold', '0.5'], { env, cwd: root }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
    );
    expect(result.code).toBe(2);
    expect(result.out).toContain('NOT RUN');
    expect(result.out).not.toContain(fakeKey);
  });

  test('an error message that echoes the key is scrubbed before it is printed', async () => {
    const fakeKey = 'sk-ant-test-2222222222222222';
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `bad request for key ${req.headers['x-api-key']}` } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const env = { ...cleanEnv(), ANTHROPIC_API_KEY: fakeKey, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };
      const result = await execFileAsync('node', [runner, '--runs', '1', '--threshold', '0.5'], { env, cwd: root }).then(
        (r) => ({ code: 0, out: r.stdout + r.stderr }),
        (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
      );
      expect(result.code).toBe(2);
      expect(result.out).toContain('[key hidden]');
      expect(result.out).not.toContain(fakeKey);
    } finally {
      server.close();
    }
  });

  test('the live path works end to end against a local stand-in for the API', async () => {
    // A tiny server that answers like the Messages API. It returns a good reply for each prompt and
    // keeps the requests so the test can check exactly what the runner sends.
    const seen: { headers: http.IncomingHttpHeaders; body: any }[] = [];
    const goodFor = JSON.parse(fs.readFileSync(fixture('replay-good.json'), 'utf8')).runs as { promptId: string; outputs: string[] }[];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data);
        seen.push({ headers: req.headers, body });
        const asked = body.messages[0].content as string;
        const prompt = PROMPTS.find((p: { input: string }) => asked.includes(p.input));
        const text = goodFor.find((g) => g.promptId === prompt.id)!.outputs[0];
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bullet-eval-'));
    const fakeKey = 'sk-ant-test-1111111111111111';
    try {
      const env = { ...cleanEnv(), ANTHROPIC_API_KEY: fakeKey, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };
      const result = await execFileAsync('node', [runner, '--runs', '2', '--threshold', '0.9', '--save', path.join(dir, 'out.json')], { env, cwd: root });
      expect(result.stdout).toContain('PASS');
      expect(result.stdout + result.stderr).not.toContain(fakeKey);
      expect(seen).toHaveLength(PROMPTS.length * 2);
      for (const { headers, body } of seen) {
        expect(headers['x-api-key']).toBe(fakeKey);
        expect(body.model).toBe(MODEL);
        expect(body.max_tokens).toBe(MAX_TOKENS);
        expect(body.system).toContain('one resume bullet');
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body.messages).toHaveLength(1);
        expect(body).not.toHaveProperty('temperature');
      }
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
      expect(saved.runs).toHaveLength(PROMPTS.length);
      expect(saved.usage).toEqual({ input: 100 * PROMPTS.length * 2, output: 20 * PROMPTS.length * 2 });
      expect(JSON.stringify(saved)).not.toContain(fakeKey);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
