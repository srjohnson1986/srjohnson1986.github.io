import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { bullets, root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { cosine, rank, retrieve, recallAt } from '../retrieval/lib/retrieve.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { overlap, findCopies } from '../retrieval/lib/overlap.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { groundedMessage, prepareDraft, EXAMPLES_HEADING, EXAMPLES_INSTRUCTION } from '../retrieval/lib/draft.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { readIndex, collectQueries, checkIndex } from '../retrieval/lib/index.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MODEL, INDEX_FILE, QUERY_VECTORS_FILE, MIN_SCORE } from '../retrieval/config.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { SYSTEM_PROMPT, userMessage } from '../evals/resume-bullets/run.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { main as draftMain, parseArgs } from '../scripts/draft-bullet.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { main as embeddingsMain } from '../scripts/build-embeddings.mjs';

// Retrieval (RAG-2) and the grounded prompt (RAG-3). Everything here runs on made-up vectors or on the
// committed vectors (retrieval/embeddings.json and retrieval/query-vectors.json), so no test loads the
// model or uses the network. No browser needed.

type Entry = { id: string; source: string; text: string; vector: number[]; expected?: string | null };
type Hit = { id: string; text: string; score: number };

const index = readIndex(path.join(root, INDEX_FILE)) as { dimensions: number; items: Entry[] };
const queryVectors = readIndex(path.join(root, QUERY_VECTORS_FILE)) as { dimensions: number; items: Entry[] };

// A tiny made-up index in 2 dimensions: the angle decides the score, so each case is easy to follow.
const small: Entry[] = [
  { id: 'b-east', source: 'bullet', text: 'Built the east thing.', vector: [1, 0] },
  { id: 'b-northeast', source: 'bullet', text: 'Led the northeast thing.', vector: [0.8, 0.6] },
  { id: 'b-north', source: 'bullet', text: 'Wrote the north thing.', vector: [0, 1] },
  { id: 'rule-1', source: 'rule', text: 'Use only single hyphens.', vector: [1, 0] },
];

test.describe('Retrieval: scoring and ranking', { tag: ['@req-410'] }, () => {
  test('cosine similarity is 1 for the same direction, 0 for a right angle, -1 for opposite, and 0 for bad input', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  test('rank returns at most k bullets, best first, above the minimum score, and never a rule', () => {
    const all = rank([1, 0], small, { k: 5, minScore: -1 }) as Hit[];
    expect(all.map((r) => r.id)).toEqual(['b-east', 'b-northeast', 'b-north']);
    expect(all.some((r) => r.id === 'rule-1'), 'a rule must never be an example').toBe(false);
    expect((rank([1, 0], small, { k: 2, minScore: -1 }) as Hit[]).map((r) => r.id)).toEqual(['b-east', 'b-northeast']);
    // 0.8 is the score of b-northeast; the right-angle bullet scores 0 and is cut.
    expect((rank([1, 0], small, { k: 5, minScore: 0.8 }) as Hit[]).map((r) => r.id)).toEqual(['b-east', 'b-northeast']);
    expect(rank([1, 0], small, { k: 5, minScore: 0.99 }).length).toBe(1);
  });

  test('equal scores are ordered by id, so the order never changes between runs', () => {
    const tied: Entry[] = [
      { id: 'b-z', source: 'bullet', text: 'Z.', vector: [1, 0] },
      { id: 'b-a', source: 'bullet', text: 'A.', vector: [1, 0] },
    ];
    expect((rank([1, 0], tied, { k: 5, minScore: 0 }) as Hit[]).map((r) => r.id)).toEqual(['b-a', 'b-z']);
  });

  test('the default is the top 5 above the configured minimum score', () => {
    const many: Entry[] = Array.from({ length: 8 }, (_, i) => ({ id: `b-${i}`, source: 'bullet', text: `T${i}.`, vector: [1, i / 100] }));
    const got = rank([1, 0], many) as Hit[];
    expect(got).toHaveLength(5);
    expect(got.every((r) => r.score >= MIN_SCORE)).toBe(true);
  });
});

test.describe('Retrieval: fallback to the writing rules alone', { tag: ['@req-410'] }, () => {
  const embedTo = (vector: number[]) => async () => [vector];
  const smallIndex = { dimensions: 2, items: small };

  test('a good match returns results and no fallback, and logs nothing', async () => {
    const log: string[] = [];
    const out = await retrieve({ query: 'east work', index: smallIndex, embed: embedTo([1, 0]), minScore: 0.5, log: (s: string) => log.push(s) });
    expect(out.fallback).toBeNull();
    expect((out.results as Hit[]).map((r) => r.id)).toEqual(['b-east', 'b-northeast']);
    expect(log).toEqual([]);
  });

  test('nothing above the minimum score gives no results, a reason, and a logged fallback', async () => {
    const log: string[] = [];
    const out = await retrieve({ query: 'x', index: smallIndex, embed: embedTo([-1, 0]), minScore: 0.5, log: (s: string) => log.push(s) });
    expect(out.results).toEqual([]);
    expect(out.fallback).toContain('no bullet scored 0.5');
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('retrieval fallback');
    expect(log[0]).toContain('writing rules alone');
  });

  test('an embedding error does not stop drafting: it gives no results and logs the reason', async () => {
    const log: string[] = [];
    const embed = async () => {
      throw new Error('model files not found');
    };
    const out = await retrieve({ query: 'x', index: smallIndex, embed, log: (s: string) => log.push(s) });
    expect(out.results).toEqual([]);
    expect(out.fallback).toContain('embedding failed: model files not found');
    expect(log[0]).toContain('model files not found');
  });

  test('a vector of the wrong size, an empty description, and an index with no bullets each fall back and log', async () => {
    for (const [query, idx, embed, reason] of [
      ['x', smallIndex, embedTo([1, 0, 0]), 'does not match the index'],
      ['x', smallIndex, embedTo([Number.NaN, 0]), 'does not match the index'],
      ['   ', smallIndex, embedTo([1, 0]), 'empty description'],
      ['x', { dimensions: 2, items: small.filter((e) => e.source === 'rule') }, embedTo([1, 0]), 'no bullets'],
      ['x', { dimensions: 0, items: [] }, embedTo([1, 0]), 'no bullets'],
    ] as const) {
      const log: string[] = [];
      const out = await retrieve({ query, index: idx, embed, log: (s: string) => log.push(s) });
      expect(out.results, reason).toEqual([]);
      expect(out.fallback, reason).toContain(reason);
      expect(log, reason).toHaveLength(1);
    }
  });

  test('prepareDraft still builds the plain prompt when retrieval fails or is turned off', async () => {
    const plain = userMessage({ input: 'I did a thing.' });
    const failing = async () => {
      throw new Error('boom');
    };
    const log: string[] = [];
    const failed = await prepareDraft({ input: 'I did a thing.', index: smallIndex, embed: failing, log: (s: string) => log.push(s) });
    expect(failed.user).toBe(plain);
    expect(failed.system).toBe(SYSTEM_PROMPT);
    expect(failed.sources).toEqual([]);
    expect(failed.fallback).toContain('boom');
    expect(log).toHaveLength(1);

    let calls = 0;
    const off = await prepareDraft({ input: 'I did a thing.', index: smallIndex, embed: async () => (calls++, [[1, 0]]), retrieval: false });
    expect(off.user).toBe(plain);
    expect(calls, 'the embedder must not run when retrieval is off').toBe(0);
  });
});

test.describe('Retrieval: quality on the fixed test queries', { tag: ['@req-410'] }, () => {
  test('the expected bullet is in the top 3 for at least 8 of the 10 queries (recall@3 of 80% or more)', () => {
    const result = recallAt(3, queryVectors, index) as { recall: number; asked: number; hits: number; rows: { id: string; position: number | null; hit: boolean }[] };
    expect(result.asked).toBe(10);
    const misses = result.rows.filter((r) => !r.hit).map((r) => `${r.id} (position ${r.position})`);
    expect(result.recall, `misses: ${misses.join(', ')}`).toBeGreaterThanOrEqual(0.8);
  });

  test('every expected bullet is a real public bullet that is in the index', () => {
    const publicIds = new Set(bullets.filter((b) => b.public).map((b) => b.id));
    const indexed = new Set(index.items.map((e) => e.id));
    for (const q of queryVectors.items.filter((x) => x.expected)) {
      expect(publicIds.has(q.expected!), `${q.id} expects ${q.expected}`).toBe(true);
      expect(indexed.has(q.expected!), `${q.id} expects ${q.expected}`).toBe(true);
    }
  });

  test('the off-topic queries clear no bullet, and each on-topic query clears at least one', () => {
    const off = queryVectors.items.filter((q) => !q.expected);
    const on = queryVectors.items.filter((q) => q.expected);
    expect(off.length).toBeGreaterThanOrEqual(3);
    for (const q of off) expect(rank(q.vector, index.items), q.id).toEqual([]);
    for (const q of on) expect((rank(q.vector, index.items) as Hit[]).length, q.id).toBeGreaterThan(0);
  });

  test('the query vectors are complete and current for retrieval/queries.yaml', () => {
    expect(checkIndex({ items: collectQueries(root), index: queryVectors, model: MODEL })).toEqual([]);
  });

  test('the check mode fails when a query has no vector, or its expected bullet changed, and an edit re-embeds nothing extra', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queries-'));
    fs.mkdirSync(path.join(dir, 'src/data/resume'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'evals/resume-bullets'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'retrieval'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src/data/resume/bullets.yaml'), '- id: b-one\n  role: tpd\n  public: true\n  text: Built one thing.\n');
    fs.writeFileSync(path.join(dir, 'evals/resume-bullets/system-prompt.md'), 'Rules for the bullet:\n\n- Be brief.\n');
    fs.writeFileSync(path.join(dir, 'evals/resume-bullets/prompts.mjs'), 'export const PROMPTS = [];\n');
    const yamlFile = path.join(dir, 'retrieval/queries.yaml');
    fs.writeFileSync(yamlFile, '- id: q1\n  query: I made one thing.\n  expected: b-one\n');

    const seen: string[] = [];
    const embed = async (texts: string[]) => (seen.push(...texts), texts.map(() => [1, 0, 0]));
    const quiet = () => {};
    expect(await embeddingsMain([], { root: dir, embed, model: 'm1', log: quiet })).toBe(0);
    expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: quiet })).toBe(0);

    // A new query nobody embedded.
    fs.appendFileSync(yamlFile, '\n- id: q2\n  query: Another thing entirely.\n  expected: null\n');
    const log: string[] = [];
    expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
    expect(log.join('\n')).toContain('missing: query "q2"');

    // After a rebuild, changing only the expected bullet is a stale entry, fixed without embedding again.
    await embeddingsMain([], { root: dir, embed, model: 'm1', log: quiet });
    fs.writeFileSync(yamlFile, '- id: q1\n  query: I made one thing.\n  expected: null\n\n- id: q2\n  query: Another thing entirely.\n  expected: null\n');
    log.length = 0;
    expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
    expect(log.join('\n')).toContain('the expected bullet of "q1"');
    const before = seen.length;
    expect(await embeddingsMain([], { root: dir, embed, model: 'm1', log: quiet })).toBe(0);
    expect(seen.length, 'a changed expected bullet needs no new embedding').toBe(before);
    expect(await embeddingsMain(['--check'], { root: dir, model: 'm1', log: quiet })).toBe(0);
  });
});

test.describe('Grounded prompt: the reference examples block', { tag: ['@req-411'] }, () => {
  const examples = [
    { id: 'b-1', text: 'Built an add-in that saved the team hours.' },
    { id: 'b-2', text: 'Led a release process with a checklist.' },
  ];
  const input = 'I made a tool for my team.';

  test('with no examples the message is exactly the one the eval sends today', () => {
    expect(groundedMessage(input, [])).toBe(userMessage({ input }));
  });

  test('the examples sit in a labelled block after the description, in order, in the message', () => {
    const message = groundedMessage(input, examples) as string;
    expect(message.startsWith(userMessage({ input }))).toBe(true);
    const heading = message.indexOf(EXAMPLES_HEADING);
    expect(heading).toBeGreaterThan(message.indexOf(input));
    expect(message.indexOf('1. Built an add-in')).toBeGreaterThan(heading);
    expect(message.indexOf('2. Led a release')).toBeGreaterThan(message.indexOf('1. Built an add-in'));
  });

  test('the block tells the model to match style and never copy facts, numbers, tools, or wording', () => {
    const message = groundedMessage(input, examples) as string;
    expect(message).toContain(EXAMPLES_INSTRUCTION);
    expect(EXAMPLES_INSTRUCTION).toMatch(/Match their style/);
    expect(EXAMPLES_INSTRUCTION).toMatch(/Never copy an example's facts, numbers, tools, or wording/);
  });

  test('the block also tells the model not to add a result, purpose, or benefit the description does not state', () => {
    expect(EXAMPLES_INSTRUCTION).toMatch(/Do not add a result, purpose, or benefit of your own unless the description states it/);
    expect(EXAMPLES_INSTRUCTION).toMatch(/stop after saying what was done/);
    // It names no example clause, so it cannot hand the model a ready-made one to copy.
    expect(EXAMPLES_INSTRUCTION).not.toMatch(/regression|stable|on track|protect/i);
    expect(groundedMessage('I did a thing.', [{ id: 'b-1', text: 'Built a thing.' }])).toContain('stop after saying what was done');
  });

  test('the examples never enter the system prompt, which still holds the unchanged writing rules', async () => {
    const draft = await prepareDraft({ input, index: { dimensions: 2, items: small }, embed: async () => [[1, 0]], minScore: 0.5 });
    expect(draft.sources.length).toBeGreaterThan(0);
    expect(draft.system).toBe(SYSTEM_PROMPT);
    expect(draft.system).not.toContain(EXAMPLES_HEADING);
    for (const s of draft.sources as Hit[]) {
      expect(draft.system).not.toContain(s.text);
      expect(draft.user).toContain(s.text);
    }
    const onDisk = fs.readFileSync(path.join(root, 'evals/resume-bullets/system-prompt.md'), 'utf8').trim();
    expect(SYSTEM_PROMPT).toBe(onDisk);
  });
});

test.describe('Grounded prompt: the copy check', { tag: ['@req-411'] }, () => {
  const example = { id: 'b-1', text: 'Built an Excel add-in that turns exports into branded customer equipment lists and schedules.' };

  test('a verbatim copy fails, even with changed case and punctuation', () => {
    expect(findCopies(example.text, [example]).map((c: { id: string }) => c.id)).toEqual(['b-1']);
    expect(findCopies('BUILT an Excel add-in, that turns exports into branded customer equipment lists, and schedules!', [example])).toHaveLength(1);
  });

  test('copying a large part of an example fails, and a reworded draft passes', () => {
    expect(findCopies('Built an Excel add-in that turns exports into branded customer equipment lists.', [example])).toHaveLength(1);
    expect(findCopies('Automated the weekly build of customer packages from raw exports using a macro-enabled workbook.', [example])).toEqual([]);
  });

  test('over 80% fails and exactly 80% passes', () => {
    const eight = (words: string[]) => words.join(' ');
    const ex = { id: 'x', text: eight(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12']) };
    // 10 distinct words, 8 shared with the example: exactly 80%.
    expect(overlap(eight(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'z1', 'z2']), ex.text)).toBeCloseTo(0.8, 10);
    expect(findCopies(eight(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'z1', 'z2']), [ex])).toEqual([]);
    // 9 of 10 shared: 90%.
    expect(findCopies(eight(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'z2']), [ex])).toHaveLength(1);
  });

  test('empty text never counts as a copy', () => {
    expect(overlap('', example.text)).toBe(0);
    expect(findCopies('', [example])).toEqual([]);
  });

  test('no two different real bullets trip the check, so a genuine bullet is never blocked by another', () => {
    const real = bullets.filter((b) => b.public);
    expect(real.length).toBeGreaterThan(50);
    const trips: string[] = [];
    for (let i = 0; i < real.length; i++) {
      for (let j = i + 1; j < real.length; j++) {
        if (findCopies(real[i].text, [{ id: real[j].id, text: real[j].text }]).length) trips.push(`${real[i].id} / ${real[j].id}`);
      }
    }
    expect(trips).toEqual([]);
  });
});

test.describe('The draft command', { tag: ['@req-411'] }, () => {
  // The real committed index, with a fake embedder that returns the vector of one known bullet, so the
  // top source is always that bullet (score 1). The API call is a fake too: no key, no network.
  const target = index.items.find((e) => e.id === 'cb-automated-releases-end-to-end')!;
  const embed = async () => [target.vector];
  const run = async (argv: string[], complete?: (p: { system: string; user: string }) => Promise<string>) => {
    const log: string[] = [];
    const code = await draftMain(argv, { embed, complete, log: (s: string) => log.push(s) });
    return { code, out: log.join('\n') };
  };

  test('--dry-run prints the sources with scores and the full prompt, and calls no API', async () => {
    let called = false;
    const { code, out } = await run(['--dry-run', 'I automated the release of my app.'], async () => ((called = true), 'x'));
    expect(code).toBe(0);
    expect(called).toBe(false);
    expect(out).toContain('Reference examples retrieved:');
    expect(out).toContain('1.000  cb-automated-releases-end-to-end');
    expect(out).toContain(target.text);
    expect(out).toContain(`--- system prompt (the writing rules) ---`);
    expect(out).toContain(EXAMPLES_HEADING);
  });

  test('a clean draft passes every check', async () => {
    const { code, out } = await run(['I automated the release of my app.'], async () => 'Automated app releases so a single version tag builds and publishes the app.');
    expect(code).toBe(0);
    expect(out).toContain('Writing rules: all passed.');
    expect(out).toContain('Copy check: passed.');
  });

  test('a draft that copies a retrieved bullet exits 1 and names it', async () => {
    const { code, out } = await run(['I automated the release of my app.'], async () => target.text);
    expect(code).toBe(1);
    expect(out).toContain('Copy check: FAILED');
    expect(out).toContain('cb-automated-releases-end-to-end (100%)');
  });

  test('a draft that breaks a writing rule exits 1', async () => {
    const { code, out } = await run(['I automated the release of my app.'], async () => 'Automated releases -- one tag does it all.');
    expect(code).toBe(1);
    expect(out).toContain('Writing rules: FAILED');
    expect(out).toContain('single-hyphens');
  });

  test('--no-retrieval sends the plain message and shows no sources', async () => {
    let sent = '';
    const { code, out } = await run(['--no-retrieval', 'I automated the release of my app.'], async ({ user }) => ((sent = user), 'Automated app releases.'));
    expect(code).toBe(0);
    expect(sent).toBe(userMessage({ input: 'I automated the release of my app.' }));
    expect(out).toContain('Reference examples: none (retrieval turned off)');
  });

  test('bad options and a missing description are refused before anything runs', () => {
    expect(() => parseArgs([])).toThrow(/description/);
    expect(() => parseArgs(['--nope', 'x'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--k', '0', 'x'])).toThrow(/--k/);
    expect(() => parseArgs(['--min-score', '2', 'x'])).toThrow(/--min-score/);
    expect(parseArgs(['--k', '3', 'a', 'b']).input).toBe('a b');
  });

  test('without a key, a live run stops with a clear message instead of calling the API', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(draftMain(['I did a thing.'], { embed, log: () => {} })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
