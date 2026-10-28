import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { emptyMemory, loadMemory, saveMemory, clearMemory, recordDraft, setVerdict, signals, memoryBlock, reusedVerb, MEMORY_FILE, MAX_ENTRIES, MAX_PREFERRED, MEMORY_HEADING } from '../retrieval/lib/memory.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { prepareDraft } from '../retrieval/lib/draft.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { groundedMessage } from '../retrieval/lib/grounding.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { readIndex } from '../retrieval/lib/index.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { INDEX_FILE } from '../retrieval/config.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { main as draftMain, parseArgs } from '../scripts/draft-bullet.mjs';

// Session memory for the draft command (retrieval/lib/memory.mjs, scripts/draft-bullet.mjs). Every test
// uses a temporary memory file and a fake model, so the real private/draft-memory.json is never touched and
// nothing is sent anywhere. No browser needed.

type Entry = { id: string; date: string; input: string; draft: string; status: string };
type Memory = { version: number; entries: Entry[] };
type Signals = { avoid: string[]; preferred: string[] };

const index = readIndex(path.join(root, INDEX_FILE)) as { items: { id: string; source: string; vector: number[] }[] };
const target = index.items.find((e) => e.id === 'cb-automated-releases-end-to-end')!;
const embed = async () => [target.vector];
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-memory-')), 'memory.json');
const read = (file: string) => loadMemory(file) as Memory;
const add = (memory: Memory, draft: string, status?: string): Memory => {
  const made = recordDraft(memory, { input: 'I did a thing.', draft, date: '2026-10-28' }) as Memory;
  return status ? (setVerdict(made, status).memory as Memory) : made;
};

test.describe('Draft memory: what is stored and what it says', { tag: ['@req-422'] }, () => {
  test('a new draft waits for a verdict, only one waits at a time, and it can be accepted or rejected', () => {
    let m = add(emptyMemory(), 'Built a thing.');
    expect(m.entries.map((e) => e.status)).toEqual(['pending']);
    m = add(m, 'Led another thing.');
    expect(m.entries.map((e) => e.draft), 'the unjudged earlier draft is dropped').toEqual(['Led another thing.']);
    const done = setVerdict(m, 'rejected');
    expect(done.entry).toMatchObject({ draft: 'Led another thing.', status: 'rejected' });
    expect(setVerdict(done.memory, 'accepted'), 'nothing is waiting any more').toBeNull();
    expect(() => setVerdict(m, 'maybe')).toThrow(/Unknown verdict/);
  });

  test('the signals are the rejected opening verbs, once each, and the newest accepted bullets', () => {
    let m = emptyMemory() as Memory;
    for (const [draft, status] of [['Maintained a thing.', 'rejected'], ['Maintained another thing.', 'rejected'], ['Authored the guide.', 'rejected'], ['Built one.', 'accepted'], ['Led two.', 'accepted'], ['Wrote three.', 'accepted'], ['Shipped four.', 'accepted']] as const) m = add(m, draft, status);
    m = add(m, 'Pending five.'); // not judged yet, so it says nothing
    const s = signals(m) as Signals;
    expect(s.avoid).toEqual(['maintained', 'authored']);
    expect(s.preferred, 'newest first, and no more than the limit').toEqual(['Shipped four.', 'Wrote three.', 'Led two.']);
    expect(s.preferred).toHaveLength(MAX_PREFERRED);
  });

  test('the block names the verbs to avoid and the accepted bullets, and is empty when there is nothing to say', () => {
    expect(memoryBlock({ avoid: [], preferred: [] })).toBe('');
    const block = memoryBlock({ avoid: ['maintained', 'authored'], preferred: ['Built one.'] }) as string;
    expect(block.startsWith(MEMORY_HEADING)).toBe(true);
    expect(block).toContain('Do not open the bullet with any of these verbs');
    expect(block).toContain('Maintained, Authored.');
    expect(block).toContain('1. Built one.');
    expect(block).toMatch(/never copy their facts, numbers, tools, or wording/);
  });

  test('a draft is checked against the rejected verbs by its first word', () => {
    expect(reusedVerb('Maintained the build scripts.', ['maintained'])).toBe('maintained');
    expect(reusedVerb('Kept the build scripts.', ['maintained'])).toBeNull();
    expect(reusedVerb('', ['maintained'])).toBeNull();
  });

  test('only the newest 20 drafts are kept', () => {
    let m = emptyMemory() as Memory;
    for (let i = 0; i < 25; i++) m = add(m, `Built thing number ${i}.`, 'accepted');
    expect(m.entries).toHaveLength(MAX_ENTRIES);
    expect(m.entries[0].draft).toBe('Built thing number 5.');
  });

  test('the file round-trips, a missing or damaged file is an empty memory, and clearing deletes it', () => {
    const file = tmpFile();
    expect(read(file).entries).toEqual([]);
    saveMemory(file, add(emptyMemory(), 'Built a thing.', 'accepted'));
    expect(read(file).entries).toHaveLength(1);
    fs.writeFileSync(file, '{ not json');
    expect(read(file).entries).toEqual([]);
    saveMemory(file, add(emptyMemory(), 'Built a thing.', 'rejected'));
    expect(clearMemory(file)).toBe(1);
    expect(fs.existsSync(file)).toBe(false);
    expect(clearMemory(file), 'clearing nothing is fine').toBe(0);
  });
});

test.describe('Draft memory: the prompt', { tag: ['@req-422'] }, () => {
  const small = { items: [{ id: 'b-1', source: 'bullet', text: 'Built a thing.', vector: [1, 0] }] };
  const ask = (memory?: Signals) => prepareDraft({ input: 'I made a thing.', index: small, embed: async () => [[1, 0]], minScore: 0.5, memory });

  test('with no memory the message is exactly what it was before memory existed', async () => {
    const plain = await ask();
    expect(await ask({ avoid: [], preferred: [] })).toEqual(plain);
    expect(plain.user).toBe(groundedMessage('I made a thing.', plain.sources));
    expect(plain.user).not.toContain(MEMORY_HEADING);
  });

  test('with memory the block comes last, after the reference examples, and the writing rules do not change', async () => {
    const plain = await ask();
    const remembered = await ask({ avoid: ['maintained'], preferred: ['Led two.'] });
    expect(remembered.user.startsWith(plain.user)).toBe(true);
    expect(remembered.user.slice(plain.user.length)).toBe(`\n\n${memoryBlock({ avoid: ['maintained'], preferred: ['Led two.'] })}`);
    expect(remembered.system).toBe(plain.system);
    expect(remembered.system).not.toContain('Maintained');
  });
});

test.describe('Draft memory: the draft command', { tag: ['@req-422'] }, () => {
  const run = async (file: string, argv: string[], complete?: (p: { system: string; user: string }) => Promise<string>) => {
    const log: string[] = [];
    const code = await draftMain(argv, { embed, complete, memoryFile: file, log: (s: string) => log.push(s) });
    return { code, out: log.join('\n') };
  };
  const reply = (...texts: string[]) => {
    const asked: string[] = [];
    return { asked, complete: async ({ user }: { user: string }) => (asked.push(user), texts[Math.min(asked.length - 1, texts.length - 1)]) };
  };
  const D = 'I automated the release of my app.';

  test('a draft is recorded as waiting, and --reject marks it and says which verb is now avoided', async () => {
    const file = tmpFile();
    const first = reply('Maintained app releases so a version tag publishes the app.');
    const made = await run(file, [D], first.complete);
    expect(made.code).toBe(0);
    expect(made.out).toContain('Memory: nothing stored yet.');
    expect(made.out).toContain('Recorded as the draft waiting for a verdict');
    expect(first.asked[0]).not.toContain(MEMORY_HEADING);
    expect(read(file).entries.map((e) => e.status)).toEqual(['pending']);

    const rejected = await run(file, ['--reject']);
    expect(rejected.out).toContain('Later drafts will not open with "maintained".');
    expect(read(file).entries.map((e) => e.status)).toEqual(['rejected']);
  });

  test('the next draft is told to avoid the rejected verb, and a clean draft passes the memory check', async () => {
    const file = tmpFile();
    saveMemory(file, add(emptyMemory(), 'Maintained app releases.', 'rejected'));
    const next = reply('Automated app releases so a version tag publishes the app.');
    const made = await run(file, [D], next.complete);
    expect(made.code).toBe(0);
    expect(next.asked).toHaveLength(1);
    expect(next.asked[0]).toContain('Do not open the bullet with any of these verbs');
    expect(next.asked[0]).toContain('Maintained.');
    expect(made.out).toContain('Memory: avoiding opening verbs maintained');
    expect(made.out).toContain('Memory check: passed');
  });

  test('a draft that opens with a rejected verb is retried once, and the second try is used', async () => {
    const file = tmpFile();
    saveMemory(file, add(emptyMemory(), 'Maintained app releases.', 'rejected'));
    const two = reply('Maintained app releases through a version tag.', 'Automated app releases through a version tag.');
    const made = await run(file, [D], two.complete);
    expect(made.code).toBe(0);
    expect(two.asked).toHaveLength(2);
    expect(two.asked[1]).toContain('Your previous attempt opened with "maintained", which is not allowed.');
    expect(made.out).toContain('Asking once more');
    expect(made.out).toContain('Automated app releases through a version tag.');
    expect(read(file).entries.at(-1)!.draft).toBe('Automated app releases through a version tag.');
  });

  test('a draft that repeats the rejected verb even after the retry fails the check and exits 1', async () => {
    const file = tmpFile();
    saveMemory(file, add(emptyMemory(), 'Maintained app releases.', 'rejected'));
    const stubborn = reply('Maintained app releases through a version tag.');
    const made = await run(file, [D], stubborn.complete);
    expect(made.code).toBe(1);
    expect(stubborn.asked, 'one try and one retry, no more').toHaveLength(2);
    expect(made.out).toContain('Memory check: FAILED');
  });

  test('--accept makes the bullet a style guide for later drafts', async () => {
    const file = tmpFile();
    await run(file, [D], reply('Automated app releases so a version tag publishes the app.').complete);
    expect((await run(file, ['--accept'])).out).toContain('Marked as accepted');
    const later = reply('Built a release pipeline.');
    await run(file, [D], later.complete);
    expect(later.asked[0]).toContain('1. Automated app releases so a version tag publishes the app.');
  });

  test('--no-memory leaves the memory out of the prompt and out of the file', async () => {
    const file = tmpFile();
    saveMemory(file, add(emptyMemory(), 'Maintained app releases.', 'rejected'));
    const before = fs.readFileSync(file, 'utf8');
    const quiet = reply('Maintained app releases through a version tag.');
    const made = await run(file, ['--no-memory', D], quiet.complete);
    expect(made.code).toBe(0);
    expect(quiet.asked[0]).not.toContain(MEMORY_HEADING);
    expect(made.out).toContain('Memory: off for this draft.');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('--dry-run shows the memory in the prompt but calls nothing and records nothing', async () => {
    const file = tmpFile();
    saveMemory(file, add(emptyMemory(), 'Maintained app releases.', 'rejected'));
    const before = fs.readFileSync(file, 'utf8');
    let called = false;
    const made = await run(file, ['--dry-run', D], async () => ((called = true), 'x'));
    expect(called).toBe(false);
    expect(made.out).toContain(MEMORY_HEADING);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('--memory lists what is stored, and --clear-memory wipes it', async () => {
    const file = tmpFile();
    expect((await run(file, ['--memory'])).out).toBe('Memory is empty.');
    saveMemory(file, add(add(emptyMemory(), 'Authored a guide.', 'accepted'), 'Maintained scripts.', 'rejected'));
    const shown = (await run(file, ['--memory'])).out;
    expect(shown).toContain('[accepted]');
    expect(shown).toContain('[rejected]');
    expect(shown).toContain('Later drafts will avoid opening with: maintained.');
    expect((await run(file, ['--clear-memory'])).out).toBe('Memory cleared: 2 drafts removed.');
    expect(fs.existsSync(file)).toBe(false);
    expect((await run(file, ['--clear-memory'])).out).toBe('Memory cleared: 0 drafts removed.');
    expect((await run(file, ['--memory'])).out).toBe('Memory is empty.');
  });

  test('--accept or --reject with no draft waiting stops with a clear message', async () => {
    const file = tmpFile();
    await expect(run(file, ['--accept'])).rejects.toThrow(/no draft waiting/);
    await expect(run(file, ['--reject'])).rejects.toThrow(/no draft waiting/);
  });

  test('the commands take no description, and only one at a time', () => {
    expect(() => parseArgs(['--accept', 'some words'])).toThrow(/takes no description/);
    expect(() => parseArgs(['--accept', '--reject'])).toThrow(/only one of/);
    expect(parseArgs(['--memory']).command).toBe('show');
    expect(parseArgs(['--no-memory', 'a', 'b']).useMemory).toBe(false);
  });
});

test.describe('Draft memory: privacy and the eval', { tag: ['@req-422'] }, () => {
  test('the memory file is under private/, which Git ignores', () => {
    expect(MEMORY_FILE.startsWith('private/')).toBe(true);
    const ignored = spawnSync('git', ['check-ignore', '-q', MEMORY_FILE], { cwd: root });
    expect(ignored.status, `git check-ignore ${MEMORY_FILE}`).toBe(0);
  });

  test('the bullet eval never uses the memory, so its messages and baseline cannot change because of it', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'results') continue;
        e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name));
      }
    };
    walk(path.join(root, 'evals'));
    const using = files.filter((f) => /\.(mjs|js)$/.test(f) && /memory/i.test(fs.readFileSync(f, 'utf8')));
    expect(using.map((f) => path.relative(root, f))).toEqual([]);
  });
});
