import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { loadRetrieval, sourcesFor, retrievalFigures, retrievalFingerprint } from '../evals/lib/retrieval.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { styleSignals, openersOf, openingWord } from '../evals/lib/style.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { PROMPTS } from '../evals/resume-bullets/prompts.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { groundedMessage, EXAMPLES_HEADING } from '../retrieval/lib/grounding.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { collectEvalPrompts, checkIndex } from '../retrieval/lib/index.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MODEL as EMBEDDING_MODEL, MIN_SCORE, DEFAULT_K } from '../retrieval/config.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MODEL, RUNS_PER_PROMPT } from '../evals/resume-bullets/config.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { userMessage, fingerprint } from '../evals/resume-bullets/run.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { main as embeddingsMain } from '../scripts/build-embeddings.mjs';

// The bullet eval with retrieval off and on (evals/resume-bullets/run.mjs, evals/lib/). The numbers are
// fixed, and the "model" is saved replies or a local stand-in server, so none of this calls the real API.
// No browser needed.

const execFileAsync = promisify(execFile);
const runner = path.join(root, 'evals', 'resume-bullets', 'run.mjs');
const fixture = (name: string) => path.join(root, 'tests', 'fixtures', 'bullet-eval', name);
const both = JSON.parse(fs.readFileSync(fixture('replay-both-good.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-eval-'));
const cleanEnv = () => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.GITHUB_STEP_SUMMARY;
  return env;
};
const run = (args: string[]) => spawnSync('node', [runner, ...args], { encoding: 'utf8', env: cleanEnv(), cwd: root });
const save = (dir: string, data: unknown, name = 'results.json') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
};
const clone = () => JSON.parse(JSON.stringify(both));
// A reply that follows the rules but breaks one: it opens with a weak verb.
const WEAK = 'Helped the team with the work.';

test.describe('Eval with retrieval: examples and figures', { tag: ['@req-414'] }, () => {
  const retrieval = loadRetrieval(root);

  test('the vectors of the fixed prompts are committed, complete, and current', async () => {
    const items = await collectEvalPrompts(root);
    expect(items.map((i: { id: string }) => i.id)).toEqual(PROMPTS.map((p: { id: string }) => p.id));
    expect(checkIndex({ items, index: retrieval.evalVectors, model: EMBEDDING_MODEL })).toEqual([]);
  });

  test('each prompt gets at most k approved bullets at the minimum score or higher, best first, and most get some', () => {
    const sources = sourcesFor(PROMPTS, retrieval) as Record<string, { id: string; score: number }[]>;
    expect(Object.keys(sources)).toEqual(PROMPTS.map((p: { id: string }) => p.id));
    for (const [id, list] of Object.entries(sources)) {
      expect(list.length, id).toBeLessThanOrEqual(DEFAULT_K);
      for (const s of list) {
        expect(s.score, id).toBeGreaterThanOrEqual(MIN_SCORE);
        expect(s.id.startsWith('rule-'), 'a rule is never an example').toBe(false);
      }
      expect(list.map((s) => s.score), id).toEqual([...list.map((s) => s.score)].sort((a, b) => b - a));
    }
    expect(Object.values(sources).filter((l) => l.length > 0).length).toBeGreaterThanOrEqual(5);
  });

  test('a prompt with no bullet above the floor is drafted without examples: the message is the plain one', () => {
    const far = { items: [{ id: 'normal-test-suite', vector: retrieval.evalVectors.items[0].vector.map((x: number) => -x) }] };
    const sources = sourcesFor([PROMPTS[0]], { index: retrieval.index, evalVectors: far }) as Record<string, unknown[]>;
    expect(sources['normal-test-suite']).toEqual([]);
    expect(groundedMessage(PROMPTS[0].input, sources['normal-test-suite'])).toBe(userMessage(PROMPTS[0]));
  });

  test('a prompt with no stored vector is an error that says how to fix it', () => {
    expect(() => sourcesFor([{ id: 'brand-new', input: 'x' }], retrieval)).toThrow(/npm run embeddings/);
  });

  test('the retrieval figures are the recall on the fixed queries, the average similarity, and how many prompts got nothing', () => {
    const made = { a: [{ score: 0.8 }, { score: 0.6 }], b: [{ score: 0.7 }], c: [] };
    const f = retrievalFigures(made, retrieval);
    expect(f.avgSimilarity).toBeCloseTo(0.7, 10);
    expect(f.avgExamples).toBeCloseTo(1, 10);
    expect(f.promptsWithoutExamples).toBe(1);
    expect(f.prompts).toBe(3);
    expect(f.recallAsked).toBe(10);
    expect(f.recallAt3).toBeGreaterThanOrEqual(0.8);
    expect(f.recallHits / f.recallAsked).toBeCloseTo(f.recallAt3, 10);
    expect(retrievalFigures({}, retrieval).avgSimilarity, 'no examples at all is n/a, not zero').toBeNull();
  });

  test('style signals count verb reuse, different verbs, and length, and need no model', () => {
    const openers = openersOf(['Built a thing.', 'Led a team of four.']);
    expect(openingWord('  Built a thing')).toBe('built');
    const s = styleSignals(['Built a tool.', 'Built another tool.', 'Automated the release.', 'Led it.'], openers);
    expect(s.drafts).toBe(4);
    expect(s.verbReuse).toBeCloseTo(0.75, 10); // built, built, led are used by approved bullets; automated is new
    expect(s.distinctVerbs).toBe(3);
    expect(s.avgWords).toBeCloseTo((3 + 3 + 3 + 2) / 4, 10);
    expect(styleSignals([], openers).verbReuse).toBeNull();
  });

  test('a live run drafts every prompt with retrieval off and then on, and the on messages carry the examples', async () => {
    const seen: { body: any }[] = [];
    const goodFor = JSON.parse(fs.readFileSync(fixture('replay-good.json'), 'utf8')).runs as { promptId: string; outputs: string[] }[];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        const body = JSON.parse(data);
        seen.push({ body });
        const asked = body.messages[0].content as string;
        const prompt = PROMPTS.find((p: { input: string }) => asked.includes(p.input));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: goodFor.find((g) => g.promptId === prompt.id)!.outputs[0] }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const dir = tmp();
    const fakeKey = 'sk-ant-test-3333333333333333';
    try {
      const env = { ...cleanEnv(), ANTHROPIC_API_KEY: fakeKey, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };
      const out = path.join(dir, 'out.json');
      const result = await execFileAsync('node', [runner, '--runs', '1', '--threshold', '0.9', '--save', out, '--baseline-file', path.join(dir, 'b.json')], { env, cwd: root });
      expect(result.stdout).toContain('PASS (retrieval off)');
      expect(result.stdout).toContain('PASS (retrieval on)');
      expect(result.stdout + result.stderr).not.toContain(fakeKey);
      expect(seen).toHaveLength(PROMPTS.length * 2);

      const sources = sourcesFor(PROMPTS, retrieval) as Record<string, { text: string }[]>;
      const messages = seen.map((s) => s.body.messages[0].content as string);
      const off = messages.slice(0, PROMPTS.length);
      const on = messages.slice(PROMPTS.length);
      // Retrieval off runs first, then on (calls inside a mode run side by side, so find each by its input).
      // Every prompt is drafted once in each mode: one plain message and one grounded.
      for (const p of PROMPTS as { id: string; input: string }[]) {
        const plain = off.filter((m) => m.includes(p.input));
        const grounded = on.filter((m) => m.includes(p.input));
        expect(plain, p.id).toEqual([userMessage(p)]);
        expect(grounded, p.id).toEqual([groundedMessage(p.input, sources[p.id])]);
        expect(grounded[0].includes(EXAMPLES_HEADING), p.id).toBe(sources[p.id].length > 0);
      }
      for (const { body } of seen) expect(body.system, 'the writing rules are the same in both modes').toContain('one resume bullet');

      const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(saved.off.runs).toHaveLength(PROMPTS.length);
      expect(saved.on.runs).toHaveLength(PROMPTS.length);
      expect(Object.keys(saved.on.sources)).toEqual(PROMPTS.map((p: { id: string }) => p.id));
      expect(JSON.stringify(saved)).not.toContain(fakeKey);
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the report puts the two modes side by side, then the retrieval figures and the style signals', () => {
    const result = run(['--replay', fixture('replay-both-good.json'), '--threshold', '0.95']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const out = result.stdout;
    expect(out).toContain('# Resume bullet eval: retrieval off and on');
    expect(out).toContain('| Rule | Off passed | Off rate | On passed | On rate |');
    expect(out).toContain('| Prompt | Off | On | Rules broken, off | Rules broken, on |');
    expect(out).toContain('## Retrieval');
    expect(out).toContain('recall@3 on the fixed test queries');
    expect(out).toContain('Average similarity of the retrieved bullets');
    expect(out).toContain('Prompts drafted without examples');
    expect(out).toContain('## Style signals (reported only, never part of the pass rate)');
    expect(out).toContain('PASS (retrieval off)');
    expect(out).toContain('PASS (retrieval on)');
    expect(out).not.toMatch(/—|–/);
    // One row per prompt, and one per rule, in the same table for both columns.
    expect(out.split('\n').filter((l: string) => /^\| (normal|count|no-outcome|weak|dash|contact)/.test(l))).toHaveLength(PROMPTS.length);
  });

  test('a retrieval-on draft that copies a reference example fails the on column only', () => {
    const data = clone();
    const copiedFrom = data.on.sources['normal-test-suite'][0];
    data.on.runs[0].outputs[0] = copiedFrom.text;
    const dir = tmp();
    try {
      const result = run(['--replay', save(dir, data), '--threshold', '0.95']);
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('FAIL (retrieval on)');
      expect(result.stdout).toContain('PASS (retrieval off)');
      expect(result.stdout).toContain(`shares over 80% of its words with the reference example ${copiedFrom.id}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('Eval with retrieval: the gate and the history', { tag: ['@req-415'] }, () => {
  test('the run exits 1 when retrieval on is below the threshold, or when retrieval off is', () => {
    const dir = tmp();
    try {
      // One weak reply out of 16 in one column is 93.8%, under 95%.
      for (const [mode, other] of [['on', 'off'], ['off', 'on']]) {
        const data = clone();
        data[mode].runs[0].outputs[0] = WEAK;
        const result = run(['--replay', save(dir, data), '--threshold', '0.95']);
        expect(result.status, `${mode}\n${result.stdout}${result.stderr}`).toBe(1);
        expect(result.stdout).toContain(`FAIL (retrieval ${mode})`);
        expect(result.stdout).toContain(`PASS (retrieval ${other})`);
        // The same replies pass a threshold they meet.
        expect(run(['--replay', save(dir, data), '--threshold', '0.9']).status).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a run that cannot be done exits 2, never 1', () => {
    const dir = tmp();
    try {
      expect(run(['--retrieval', 'sideways']).status).toBe(2);
      expect(run(['--runs', '100']).stderr).toMatch(/x 2 modes = 1600 calls, above the cap of 80/);
      expect(run(['--runs', '5', '--retrieval', 'off']).status, 'five runs of one mode is 40 calls and fits, so only the missing key stops it').toBe(2);
      const noSources = clone();
      delete noSources.on.sources;
      const r = run(['--replay', save(dir, noSources)]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('cannot be scored');
      // A baseline needs both modes.
      const offOnly = clone();
      delete offOnly.on;
      const u = run(['--replay', save(dir, offOnly, 'off.json'), '--threshold', '0.95', '--update-baseline', '--baseline-file', path.join(dir, 'b.json'), '--history-file', path.join(dir, 'h.jsonl')]);
      expect(u.status).toBe(2);
      expect(u.stderr).toContain('both off and on');
      expect(fs.existsSync(path.join(dir, 'b.json'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recording a baseline writes both modes and the fingerprints, and adds one history line each time', () => {
    const dir = tmp();
    const realBaseline = fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'baseline.json'), 'utf8');
    const realHistory = fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'history.jsonl'), 'utf8');
    try {
      const baselineFile = path.join(dir, 'baseline.json');
      const historyFile = path.join(dir, 'history.jsonl');
      const args = ['--replay', fixture('replay-both-good.json'), '--threshold', '0.95', '--update-baseline', '--baseline-file', baselineFile, '--history-file', historyFile];
      expect(run(args).status).toBe(0);
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      expect(baseline).toMatchObject({ model: 'test-model', date: '2026-10-28', threshold: 0.95, fingerprint: fingerprint(), retrievalFingerprint: retrievalFingerprint() });
      expect(baseline.off.overall.rate).toBe(1);
      expect(baseline.on.overall.rate).toBe(1);
      expect(baseline.retrieval.recallAt3).toBeGreaterThanOrEqual(0.8);
      expect(baseline.retrieval).toHaveProperty('avgSimilarity');
      expect(Object.keys(baseline.style).sort()).toEqual(['approvedAvgWords', 'off', 'on']);

      expect(run(args).status).toBe(0);
      const lines = fs.readFileSync(historyFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(2);
      expect(Object.keys(lines[0]).sort()).toEqual(['avgSimilarity', 'avgWords', 'date', 'distinctVerbs', 'model', 'offRate', 'onRate', 'promptsWithoutExamples', 'recallAt3', 'runsPerPrompt', 'threshold', 'verbReuse']);
      expect(lines[0]).toMatchObject({ date: '2026-10-28', model: 'test-model', offRate: 1, onRate: 1, threshold: 0.95 });

      // Replies that do not name a model and date are not a real run and cannot become a baseline.
      const anonymous = clone();
      delete anonymous.model;
      delete anonymous.date;
      const dir2 = tmp();
      expect(run(['--replay', save(dir2, anonymous), '--threshold', '0.95', '--update-baseline', '--baseline-file', path.join(dir2, 'b.json'), '--history-file', path.join(dir2, 'h.jsonl')]).status).toBe(2);
      fs.rmSync(dir2, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // The real files were not touched by any of that.
    expect(fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'baseline.json'), 'utf8')).toBe(realBaseline);
    expect(fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'history.jsonl'), 'utf8')).toBe(realHistory);
  });

  test('the committed baseline was recorded with the current retrieval settings', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'baseline.json'), 'utf8'));
    expect(baseline.retrievalFingerprint, 'the example instruction, the number of examples, the minimum score, the copy threshold, or the embedding model changed since the baseline was recorded: record a new baseline').toBe(retrievalFingerprint());
    expect(retrievalFingerprint()).toMatch(/^[0-9a-f]{16}$/);
    expect(baseline.retrieval.recallAt3).toBeGreaterThanOrEqual(0.8);
    expect(baseline.model).toBe(MODEL);
    expect(baseline.runsPerPrompt).toBe(RUNS_PER_PROMPT);
  });

  test('the history file is valid, and its last line is the committed baseline', () => {
    const lines = fs
      .readFileSync(path.join(root, 'evals', 'resume-bullets', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(line.offRate).toBeGreaterThan(0);
    }
    const dates = lines.map((l) => l.date);
    expect(dates, 'oldest first').toEqual([...dates].sort());
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'resume-bullets', 'baseline.json'), 'utf8'));
    const last = lines.at(-1);
    expect(last.date).toBe(baseline.date);
    expect(last.offRate).toBe(baseline.off.overall.rate);
    expect(last.onRate).toBe(baseline.on.overall.rate);
    expect(last.recallAt3).toBe(baseline.retrieval.recallAt3);
  });

  test('the check mode fails when the vector of an eval prompt is missing or stale', async () => {
    const dir = tmp();
    try {
      for (const d of ['src/data/resume', 'evals/resume-bullets', 'retrieval']) fs.mkdirSync(path.join(dir, d), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/data/resume/bullets.yaml'), '- id: b-one\n  role: tpd\n  public: true\n  text: Built one thing.\n');
      fs.writeFileSync(path.join(dir, 'evals/resume-bullets/system-prompt.md'), 'Rules for the bullet:\n\n- Be brief.\n');
      fs.writeFileSync(path.join(dir, 'retrieval/queries.yaml'), '[]\n');
      const promptsFile = path.join(dir, 'evals/resume-bullets/prompts.mjs');
      fs.writeFileSync(promptsFile, "export const PROMPTS = [{ id: 'p1', kind: 'normal', input: 'I made a thing.' }];\n");
      const embed = async (texts: string[]) => texts.map(() => [1, 0]);
      const quiet = () => {};
      expect(await embeddingsMain([], { root: dir, embed, model: 'm1', log: quiet })).toBe(0);
      expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: quiet })).toBe(0);

      // A new prompt that nobody embedded, then an edited one.
      fs.writeFileSync(promptsFile, "export const PROMPTS = [{ id: 'p1', kind: 'normal', input: 'I made a thing.' }, { id: 'p2', kind: 'normal', input: 'Another.' }];\n");
      const log: string[] = [];
      expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
      expect(log.join('\n')).toContain('missing: eval-prompt "p2"');
      await embeddingsMain([], { root: dir, embed, model: 'm1', log: quiet });
      fs.writeFileSync(promptsFile, "export const PROMPTS = [{ id: 'p1', kind: 'normal', input: 'I made a different thing.' }, { id: 'p2', kind: 'normal', input: 'Another.' }];\n");
      log.length = 0;
      expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
      expect(log.join('\n')).toContain('stale: eval-prompt "p1"');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
