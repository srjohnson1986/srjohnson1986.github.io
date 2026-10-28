import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { bullets, root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { collectItems, buildIndex, checkIndex, readIndex, serializeIndex } from '../retrieval/lib/index.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { main } from '../scripts/build-embeddings.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { MODEL, INDEX_FILE } from '../retrieval/config.mjs';

// The embedding index (retrieval/embeddings.json, built by scripts/build-embeddings.mjs). These tests
// use a fake embedder that counts its calls, so they never load the real model or touch the network.
// No browser needed.

type Item = { id: string; source: string; text: string };
type Entry = Item & { model: string; hash: string; vector: number[] };

// A fake embedder: the same text always gives the same 3-number vector, and every call is counted.
const fake = () => {
  const seen: string[] = [];
  const embed = async (texts: string[]) => {
    seen.push(...texts);
    return texts.map((t) => [t.length / 100, (t.charCodeAt(0) % 17) / 17, 0.5]);
  };
  return { embed, seen };
};

const items: Item[] = [
  { id: 'a-built-thing', source: 'bullet', text: 'Built a thing that saved time.' },
  { id: 'a-led-team', source: 'bullet', text: 'Led a team of four through a release.' },
  { id: 'rule-1', source: 'rule', text: 'Use only single hyphens.' },
];

// A small made-up repository: the two files collectItems reads.
function makeRepo(
  bulletYaml: string,
  rules = 'Intro.\n\nRules for the bullet:\n\n- Use only single hyphens.\n- Never invent a number.\n',
  queries = '[]\n',
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embeddings-'));
  fs.mkdirSync(path.join(dir, 'src/data/resume'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'evals/resume-bullets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/data/resume/bullets.yaml'), bulletYaml);
  fs.writeFileSync(path.join(dir, 'evals/resume-bullets/system-prompt.md'), rules);
  fs.mkdirSync(path.join(dir, 'retrieval'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'retrieval/queries.yaml'), queries);
  fs.writeFileSync(path.join(dir, 'evals/resume-bullets/prompts.mjs'), 'export const PROMPTS = [];\n');
  return dir;
}
const yamlBullet = (id: string, text: string, pub = true) => `- id: ${id}\n  role: tpd\n  public: ${pub}\n  text: >-\n    ${text}\n\n`;

test.describe('Embedding index: caching and incremental updates', { tag: ['@req-407'] }, () => {
  test('an unchanged second run embeds nothing', async () => {
    const first = fake();
    const built = await buildIndex({ items, previous: [], model: 'm1', embed: first.embed });
    expect(built.embedded).toBe(3);
    expect(first.seen).toHaveLength(3);

    const second = fake();
    const again = await buildIndex({ items, previous: built.entries, model: 'm1', embed: second.embed });
    expect(second.seen, 'the embedder must not be called').toEqual([]);
    expect(again.embedded).toBe(0);
    expect(again.reused).toBe(3);
    expect(serializeIndex(again.entries)).toBe(serializeIndex(built.entries));
  });

  test('editing one bullet re-embeds only that bullet', async () => {
    const { entries } = await buildIndex({ items, previous: [], model: 'm1', embed: fake().embed });
    const edited = items.map((i) => (i.id === 'a-led-team' ? { ...i, text: 'Led a team of five through a release.' } : i));
    const spy = fake();
    const result = await buildIndex({ items: edited, previous: entries, model: 'm1', embed: spy.embed });
    expect(spy.seen).toEqual(['Led a team of five through a release.']);
    expect(result.embedded).toBe(1);
    expect(result.entries.find((e: Entry) => e.id === 'a-built-thing')!.vector).toEqual(entries[0].vector);
  });

  test('adding a bullet embeds only the new one, and removing a bullet removes its entry', async () => {
    const { entries } = await buildIndex({ items, previous: [], model: 'm1', embed: fake().embed });
    const added = [...items, { id: 'a-new', source: 'bullet', text: 'Wrote a guide.' }];
    const spy = fake();
    const grown = await buildIndex({ items: added, previous: entries, model: 'm1', embed: spy.embed });
    expect(spy.seen).toEqual(['Wrote a guide.']);

    const shrunk = await buildIndex({ items: items.slice(1), previous: grown.entries, model: 'm1', embed: fake().embed });
    expect(shrunk.removed).toBe(2);
    expect(shrunk.entries.map((e: Entry) => e.id)).toEqual(['a-led-team', 'rule-1']);
  });

  test('a different model re-embeds everything', async () => {
    const { entries } = await buildIndex({ items, previous: [], model: 'm1', embed: fake().embed });
    const spy = fake();
    await buildIndex({ items, previous: entries, model: 'm2', embed: spy.embed });
    expect(spy.seen).toHaveLength(3);
  });

  test('the script writes the file once, then a second run changes nothing and never loads the embedder', async () => {
    const dir = makeRepo(yamlBullet('b-one', 'Built one thing.') + yamlBullet('b-two', 'Led two things.'));
    const log: string[] = [];
    const first = fake();
    expect(await main([], { root: dir, embed: first.embed, model: 'm1', log: (s: string) => log.push(s) })).toBe(0);
    expect(first.seen).toHaveLength(4); // two bullets and two rules
    const file = path.join(dir, INDEX_FILE);
    const written = fs.readFileSync(file, 'utf8');

    const second = fake();
    expect(await main([], { root: dir, embed: second.embed, model: 'm1', log: (s: string) => log.push(s) })).toBe(0);
    expect(second.seen).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(written);
    expect(log.at(-1)).toContain('The file did not change');
  });
});

test.describe('Embedding index: content and the check mode', { tag: ['@req-407'] }, () => {
  test('only public bullets and the writing rules are collected', () => {
    const dir = makeRepo(yamlBullet('b-pub', 'Built it.') + yamlBullet('b-private', 'Led the secret thing.', false));
    const got = collectItems(dir) as Item[];
    expect(got.map((i) => i.id)).toEqual(['b-pub', 'rule-1', 'rule-2']);
    expect(got.map((i) => i.source)).toEqual(['bullet', 'rule', 'rule']);
    expect(JSON.stringify(got)).not.toContain('secret');
  });

  test('the check passes on a fresh index and reports a missing bullet', async () => {
    const dir = makeRepo(yamlBullet('b-one', 'Built one thing.'));
    const log: string[] = [];
    await main([], { root: dir, embed: fake().embed, model: 'm1', log: () => {} });
    expect(await main(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(0);

    // A new approved bullet that nobody embedded.
    fs.appendFileSync(path.join(dir, 'src/data/resume/bullets.yaml'), yamlBullet('b-new', 'Wrote a new thing.'));
    log.length = 0;
    expect(await main(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
    expect(log.join('\n')).toContain('missing: bullet "b-new"');
  });

  test('the check reports an edited bullet as stale and a removed one as extra', async () => {
    const dir = makeRepo(yamlBullet('b-one', 'Built one thing.') + yamlBullet('b-two', 'Led two things.'));
    await main([], { root: dir, embed: fake().embed, model: 'm1', log: () => {} });
    fs.writeFileSync(path.join(dir, 'src/data/resume/bullets.yaml'), yamlBullet('b-one', 'Built one better thing.'));
    const log: string[] = [];
    expect(await main(['--check'], { root: dir, model: 'm1', log: (s: string) => log.push(s) })).toBe(1);
    const out = log.join('\n');
    expect(out).toContain('stale: bullet "b-one"');
    expect(out).toContain('extra: "b-two"');
  });

  test('the check rejects a broken vector and a model change, and an unknown option exits 2', async () => {
    const { entries } = await buildIndex({ items, previous: [], model: 'm1', embed: fake().embed });
    const broken = entries.map((e: Entry, i: number) => (i === 0 ? { ...e, vector: [1, 2] } : e));
    const problems = checkIndex({ items, index: { dimensions: 3, items: broken }, model: 'm1' }) as string[];
    expect(problems.join('\n')).toContain('broken: the vector of "a-built-thing"');
    expect(checkIndex({ items, index: { dimensions: 3, items: entries }, model: 'm2' })).not.toEqual([]);
    expect(await main(['--nope'], { root: makeRepo(''), log: () => {} })).toBe(2);
  });
});

test.describe('Embedding index: the committed file', { tag: ['@req-407'] }, () => {
  const index = readIndex(path.join(root, INDEX_FILE)) as { dimensions: number; items: Entry[] };
  const expected = collectItems(root) as Item[];

  test('every public bullet in the real data is in the index, and the check passes', () => {
    const publicIds = bullets.filter((b) => b.public).map((b) => b.id);
    expect(publicIds.length).toBeGreaterThan(50);
    const indexed = new Set(index.items.map((e) => e.id));
    expect(publicIds.filter((id) => !indexed.has(id)), 'bullets missing from the index').toEqual([]);
    expect(checkIndex({ items: expected, index, model: MODEL })).toEqual([]);
  });

  test('every entry has the fields the spec names, one model, and equal-length finite vectors', () => {
    expect(index.dimensions).toBeGreaterThan(0);
    for (const e of index.items) {
      expect(Object.keys(e).sort(), e.id).toEqual(['hash', 'id', 'model', 'source', 'text', 'vector']);
      expect(['bullet', 'rule']).toContain(e.source);
      expect(e.model).toBe(MODEL);
      expect(e.vector, e.id).toHaveLength(index.dimensions);
      expect(e.vector.every(Number.isFinite), e.id).toBe(true);
    }
  });

  test('no non-public bullet text is in the index', () => {
    const indexedText = index.items.map((e) => e.text).join('\n');
    for (const b of bullets.filter((x) => !x.public)) expect(indexedText).not.toContain(b.text.replace(/\s+/g, ' ').trim());
  });
});
