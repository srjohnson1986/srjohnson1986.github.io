import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';

// scripts/import-lanes.mjs reads lane tags, role ranks, and combined bullets from the resume bullet bank and
// writes them into the YAML files. These specs run it on a small made-up bank in tests/fixtures/lanes/ (never
// on private/), in a temporary folder, so they need no browser, no build, and leave the real data alone.

const script = path.join(root, 'scripts', 'import-lanes.mjs');
const fixtures = path.join(root, 'tests', 'fixtures', 'lanes');
const DATA_FILES = ['lanes.yaml', 'roles.yaml', 'bullets.yaml'];

type Setup = { bank?: (text: string) => string; bullets?: (text: string) => string; crlf?: boolean };

/** Copies the fixtures into a fresh folder (optionally changed), and returns helpers to run the script there. */
function workspace(setup: Setup = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-lanes-'));
  const eol = (t: string) => (setup.crlf ? t.replace(/\r?\n/g, '\r\n') : t);
  for (const f of DATA_FILES) {
    let text = fs.readFileSync(path.join(fixtures, f), 'utf8');
    if (f === 'bullets.yaml' && setup.bullets) text = setup.bullets(text);
    fs.writeFileSync(path.join(dir, f), eol(text));
  }
  let bank = fs.readFileSync(path.join(fixtures, 'bank.md'), 'utf8');
  if (setup.bank) bank = setup.bank(bank);
  fs.writeFileSync(path.join(dir, 'bank.md'), bank);
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [script, '--bank', path.join(dir, 'bank.md'), '--data-dir', dir, ...args], { encoding: 'utf8', cwd: root });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const bullet = (id: string) => (yaml.load(read('bullets.yaml')) as { id: string; lanes?: Record<string, number[]>; text: string; theme: string }[]).find((b) => b.id === id)!;
  return { dir, run, read, snapshot, bullet };
}

test.describe('import-lanes: a clean bank', () => {
  test('check mode reports and writes nothing', () => {
    const w = workspace();
    const before = w.snapshot();
    const { status, out } = w.run();
    expect(status).toBe(0);
    expect(out).toMatch(/0 problem\(s\), 0 warning\(s\)/);
    expect(out).toContain('Matched by text (the bank says "new"): 1');
    expect(out).toContain('alpha-created-new-one');
    expect(out).toContain('Empty lane lists (never used in a lane): 1');
    expect(w.snapshot()).toEqual(before);
  });

  test('--write sets lanes, role ranks, and combos, and leaves everything else alone', () => {
    const w = workspace();
    const before = w.snapshot();
    const { status } = w.run('--write');
    expect(status).toBe(0);

    expect(w.bullet('alpha-ran-checks').lanes).toEqual({ qa: [1, 10], sdet: [2, 20] });
    expect(w.bullet('alpha-wrote-plans').lanes).toEqual({ qa: [2, 10] }); // a plain, unescaped tag works too
    expect(w.bullet('alpha-created-new-one').lanes).toEqual({ sdet: [1, 10] }); // "new" matched by its text
    expect(w.bullet('beta-gathered-needs').lanes).toEqual({ qa: [3, 5], sdet: [1, 10] }); // keys follow lanes.yaml order
    expect(w.bullet('beta-trained-users').lanes).toEqual({ qa: [2, 20] }); // tagged under a Stories heading, attributed by id
    expect(w.bullet('alpha-built-tooling').lanes).toBeUndefined(); // an empty list means no lanes at all

    const roles = yaml.load(w.read('roles.yaml')) as { id: string; lane_rank: Record<string, number> }[];
    expect(roles.find((r) => r.id === 'alpha')!.lane_rank).toEqual({ qa: 1, sdet: 2 });
    expect(roles.find((r) => r.id === 'beta')!.lane_rank).toEqual({ qa: 2, sdet: 1 });

    const combos = yaml.load(w.read('combos.yaml')) as { id: string; role: string; replaces: string[]; lanes: string[]; text: string }[];
    expect(combos).toEqual([
      {
        id: 'alpha-combo-checks-plans',
        role: 'alpha',
        replaces: ['alpha-ran-checks', 'alpha-wrote-plans'],
        lanes: ['qa'],
        text: 'Ran the checks and wrote the release plans together.',
      },
    ]);

    // Comments, other fields, and the wording are untouched.
    expect(w.read('bullets.yaml')).toContain('# Fixture bullets. This comment must survive an import.');
    expect(w.read('roles.yaml')).toContain('# A comment between entries.');
    expect(w.bullet('alpha-ran-checks').theme).toBe('testing');
    const original = (yaml.load(before['bullets.yaml']) as { id: string; text: string }[]).find((b) => b.id === 'alpha-wrote-plans')!;
    expect(w.bullet('alpha-wrote-plans').text).toBe(original.text);
    expect(w.read('roles.yaml')).toContain('    - title: Senior Analyst');
  });

  test('a second --write changes nothing', () => {
    const w = workspace();
    w.run('--write');
    const after = w.snapshot();
    const second = w.run('--write');
    expect(second.status).toBe(0);
    expect(second.out).toContain('Nothing to change');
    expect(w.snapshot()).toEqual(after);
  });

  test('keeps Windows line endings', () => {
    const w = workspace({ crlf: true });
    w.run('--write');
    for (const f of ['bullets.yaml', 'roles.yaml', 'combos.yaml']) {
      expect(w.read(f), f).not.toMatch(/[^\r]\n/);
    }
    const after = w.snapshot();
    w.run('--write');
    expect(w.snapshot()).toEqual(after);
  });

  test('a later run drops lanes the bank no longer lists, and removes the line when the list is emptied', () => {
    const w = workspace();
    w.run('--write');
    expect(w.bullet('alpha-ran-checks').lanes).toEqual({ qa: [1, 10], sdet: [2, 20] });
    const bank = fs.readFileSync(path.join(fixtures, 'bank.md'), 'utf8');
    const tag = '\\[alpha-ran-checks | QA1.10 SDET2.20\\]';
    expect(bank).toContain(tag);
    fs.writeFileSync(path.join(w.dir, 'bank.md'), bank.replace(tag, '\\[alpha-ran-checks | QA1.10\\]'));
    expect(w.run('--write').status).toBe(0);
    expect(w.bullet('alpha-ran-checks').lanes).toEqual({ qa: [1, 10] });
    // Emptying a bullet that no combined bullet uses removes its lanes line.
    expect(w.bullet('beta-gathered-needs').lanes).toBeDefined();
    fs.writeFileSync(path.join(w.dir, 'bank.md'), bank.replace('\\[beta-gathered-needs | SDET1.10 QA3.5\\]', '\\[beta-gathered-needs | \\]'));
    expect(w.run('--write').status).toBe(0);
    expect(w.bullet('beta-gathered-needs').lanes).toBeUndefined();
    expect(w.read('bullets.yaml')).not.toContain('qa: [3, 5]');
  });
});

test.describe('import-lanes: the bank has a problem', () => {
  // [name, change to the bank, change to bullets.yaml (optional), message expected in the report]
  const cases: [string, (b: string) => string, ((t: string) => string) | undefined, RegExp][] = [
    ['an id that is not in bullets.yaml', (b) => b.replace('alpha-wrote-plans |', 'alpha-ghost |'), undefined, /id "alpha-ghost" is not in bullets.yaml/],
    ['a lane code that does not exist', (b) => b.replace('QA2.10', 'XX2.10'), undefined, /bad lane tag "XX2.10"/],
    ['a tier of 4', (b) => b.replace('QA2.10', 'QA4.10'), undefined, /tiers are 1, 2, or 3/],
    ['a position of 0', (b) => b.replace('QA2.10', 'QA2.0'), undefined, /positions start at 1/],
    ['a lane listed twice on a bullet', (b) => b.replace('QA2.10', 'QA2.10 QA3.10'), undefined, /lists QA twice/],
    ['a tag that is not a lane tag', (b) => b.replace('QA2.10', 'QA'), undefined, /bad lane tag "QA"/],
    ['a role heading missing a lane rank', (b) => b.replace('\\[QA1 SDET2\\]', '\\[QA1\\]'), undefined, /missing a rank for SDET/],
    ['a role heading with no rank tag at all', (b) => b.replace(' \\[QA2 SDET1\\]', ''), undefined, /missing a rank for QA, SDET/],
    ['a role heading with a rank of 0', (b) => b.replace('QA2 SDET1', 'QA0 SDET1'), undefined, /ranks start at 1/],
    ['a role with no heading in the bank', (b) => b.replace('## Beta Labs - Analyst', '## Gamma - Analyst'), undefined, /role "beta".*no ranked heading/],
    ['a new bullet that is not in bullets.yaml', (b) => b.replace('Created a new one.', 'Created something else.'), undefined, /not in bullets.yaml yet/],
    [
      'a new bullet that matches two bullets',
      (b) => b,
      (t) => `${t}\n- id: alpha-created-new-two\n  role: alpha\n  theme: tooling\n  tags: [development]\n  public: true\n  text: >-\n    Created a new one.\n`,
      /matches 2 bullets/,
    ],
    ['the same bullet tagged twice with different tags', (b) => `${b}\n- Ran the checks every night. [alpha-ran-checks | QA3.10]\n`, undefined, /alpha-ran-checks is tagged on lines \d+ and \d+ with different tags/],
    ['a public bullet with no tagged line', (b) => b.replace(/^.*\[beta-gathered-needs \| .*$/m, ''), undefined, /"beta-gathered-needs" has no tagged line/],
    ['a combined bullet that replaces a bullet that does not exist', (b) => b.replace('replaces alpha-ran-checks', 'replaces alpha-ghost'), undefined, /alpha-ghost.*not in bullets.yaml/],
    ['a combined bullet that mixes roles', (b) => b.replace('alpha-wrote-plans |', 'beta-gathered-needs |').replace('replaces alpha-ran-checks alpha-wrote-plans', 'replaces alpha-ran-checks beta-gathered-needs'), undefined, /different roles/],
    ['a combined bullet used in a lane a replaced bullet is not tagged for', (b) => b.replace('| QA\\]', '| QA SDET\\]'), undefined, /lane "sdet", but the bullet it replaces, "alpha-wrote-plans", is not tagged/],
    ['a combined bullet with an unknown lane', (b) => b.replace('| QA\\]', '| QA ZZ\\]'), undefined, /unknown lane "ZZ"/],
    ['a combined bullet that does not start with a past-tense verb', (b) => b.replace('Ran the checks and wrote the release plans together.', 'Running the checks and plans together.'), undefined, /does not start with a past-tense verb/],
    ['a combined bullet with a double hyphen', (b) => b.replace('plans together.', 'plans -- together.'), undefined, /double hyphen/],
    ['an unreadable tag', (b) => b.replace('[alpha-wrote-plans | QA2.10]', '[ | QA2.10]'), undefined, /unreadable tag/],
  ];
  for (const [name, change, changeBullets, message] of cases) {
    test(`exits 1 and writes nothing for ${name}`, () => {
      const w = workspace({ bank: change, bullets: changeBullets });
      const before = w.snapshot();
      const check = w.run();
      expect(check.status, check.out).toBe(1);
      expect(check.out).toMatch(message);
      const write = w.run('--write');
      expect(write.status).toBe(1);
      expect(write.out).toContain('Nothing written');
      expect(w.snapshot()).toEqual(before);
    });
  }

  test('a missing bank file explains how to refresh it', () => {
    const w = workspace();
    fs.rmSync(path.join(w.dir, 'bank.md'));
    const r = w.run();
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/not found.*Refresh it from the bank artifact/);
  });

  test('a bullet under the wrong role heading is only a warning: it still imports by its id', () => {
    const moved = workspace({ bank: (b) => b.replace(/- Gathered needs\..*\n/, '').replace('**Combined bullets**', '- Gathered needs. \\[beta-gathered-needs | SDET1.10 QA3.5\\]\n\n**Combined bullets**') });
    const r = moved.run();
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/beta-gathered-needs sits under the alpha heading but bullets.yaml says beta/);
  });
});

test.describe('import-lanes: bullet wording', () => {
  const drifted = (b: string) => b.replace('Ran the checks every night. \\[alpha-ran-checks', 'Ran the checks every night and weekend. \\[alpha-ran-checks');

  test('check mode lists changed wording, and --write alone leaves it', () => {
    const w = workspace({ bank: drifted });
    const r = w.run('--write');
    expect(r.status).toBe(0);
    expect(r.out).toContain('Bullet wording that differs from bullets.yaml: 1');
    expect(r.out).toContain('alpha-ran-checks');
    expect(r.out).toMatch(/night\. => night and weekend\./);
    expect(w.bullet('alpha-ran-checks').text).toBe('Ran the checks every night.');
  });

  test('--apply-text copies it, keeps the id, and stays rewrapped as a folded block', () => {
    const w = workspace({ bank: drifted });
    const r = w.run('--write', '--apply-text');
    expect(r.status).toBe(0);
    expect(w.bullet('alpha-ran-checks').text).toBe('Ran the checks every night and weekend.');
    expect(w.read('bullets.yaml')).toContain('- id: alpha-ran-checks');
    expect(w.run('--write', '--apply-text').out).toContain('Nothing to change');
  });

  test('--apply-text refuses wording that breaks the copy rules, and writes nothing', () => {
    const w = workspace({ bank: (b) => b.replace('Ran the checks every night. \\[alpha-ran-checks', 'Running the checks every night. \\[alpha-ran-checks') });
    const before = w.snapshot();
    const r = w.run('--write', '--apply-text');
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/alpha-ran-checks: the bank wording does not start with a past-tense verb/);
    expect(w.snapshot()).toEqual(before);
  });
});
