import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from './helpers/test';
import { root, roles, variants, bullets } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { checkBullet, STRONG_VERBS } from '../.claude/skills/add-resume-bullet/check-bullet.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { startsWithPastTenseVerb } from '../src/lib/copy-rules.js';

// The add-resume-bullet skill (.claude/skills/add-resume-bullet/) checks a new bullet before it writes
// anything. These specs run its check mode, which never writes, against a good bullet and one bullet
// per rule. They read only files, so they need no browser and no build.

const script = path.join(root, '.claude', 'skills', 'add-resume-bullet', 'check-bullet.mjs');
const role = roles[0].id;
const version = variants[0].id;
const good = 'Streamlined a long manual step into one scripted command that anyone on the team could run.';

const check = (text: string, extra: Record<string, unknown> = {}) =>
  checkBullet({ role, versions: version, text, ...extra }) as { errors: string[]; warnings: string[] };

test.describe('add-resume-bullet skill', () => {
  test('accepts a clean bullet', () => {
    expect(check(good).errors).toEqual([]);
  });

  const broken: [string, string, RegExp][] = [
    ['a weak verb (Reviewed)', 'Reviewed the release checklist and updated every step.', /Reviewed.*strong action verb/],
    ['a weak verb (Asked)', 'Asked each team for the status of their open work.', /Asked.*strong action verb/],
    ['a weak verb (Helped)', 'Helped the team move the process into source control.', /Helped.*strong action verb/],
    ['a weak verb (Worked on)', 'Worked on the build scripts for the add-in.', /Worked.*strong action verb/],
    ['a verb that is not past tense', 'Build a pipeline that runs every check.', /not a past-tense verb/],
    ['an em dash', `Built a pipeline ${String.fromCharCode(0x2014)} and shipped it.`, /single hyphens/],
    ['an en dash', `Built a pipeline ${String.fromCharCode(0x2013)} and shipped it.`, /single hyphens/],
    ['a double hyphen', 'Built a pipeline -- and shipped it.', /single hyphens/],
    ['a phone number', 'Built a call tree, reachable at 404-555-0123.', /phone numbers/],
    ['a project count without a plus sign', 'Shipped 152 issues and 90+ pull requests.', /"152 issues".*plus sign/],
  ];
  for (const [name, text, message] of broken) {
    test(`rejects ${name}`, () => {
      expect(check(text).errors.join('\n')).toMatch(message);
    });
  }

  test('accepts counts written as a floor, and an exact count when told it is final', () => {
    expect(check('Shipped 152+ issues and 90+ pull requests.').errors).toEqual([]);
    expect(check('Shipped 152 issues.', { exactOk: true }).errors).toEqual([]);
  });

  test('rejects an unknown role or version and a missing version', () => {
    expect(checkBullet({ role: 'nope', versions: version, text: good }).errors.join('\n')).toMatch(/Unknown role/);
    expect(checkBullet({ role, versions: 'nope', text: good }).errors.join('\n')).toMatch(/Unknown resume version/);
    expect(checkBullet({ role, versions: '', text: good }).errors.join('\n')).toMatch(/at least one resume version/);
  });

  test('warns, without failing, when the verb is already used in the same role, and suggests others', () => {
    // Take a verb from a real bullet in the role, so the test follows the data.
    const existing = bullets.find((b) => b.role === role)!;
    const verb = existing.text.match(/^[A-Za-z]+/)![0];
    const result = check(`${verb} a second, different piece of work for the same role.`);
    const warning = result.warnings.find((w) => w.includes('already starts'));
    expect(warning, `a warning about "${verb}" in the ${role} role`).toBeTruthy();
    expect(warning).toContain(existing.id);
    expect(warning).toContain('Unused verbs in this role');
    expect(result.errors.filter((e) => e.includes('verb'))).toEqual([]);
  });

  test('every suggested alternative passes the schema verb check', () => {
    const rejected = (STRONG_VERBS as string[]).filter((verb) => !startsWithPastTenseVerb(`${verb} something.`));
    expect(rejected, 'suggested verbs that the build would reject').toEqual([]);
  });

  test('the command line exits 1 on a bad bullet, 0 on a good one, and writes nothing', () => {
    const files = ['bullets.yaml', 'variants.yaml'].map((name) => path.join(root, 'src', 'data', 'resume', name));
    const before = files.map((file) => fs.readFileSync(file, 'utf8'));
    const run = (text: string) => spawnSync('node', [script, 'check', '--role', role, '--versions', version, '--text', text], { encoding: 'utf8' });

    const bad = run('Reviewed the plan.');
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain('Nothing was written');
    expect(run(good).status).toBe(0);
    expect(run(good).stdout).toContain('OK');

    expect(files.map((file) => fs.readFileSync(file, 'utf8'))).toEqual(before);
  });

  test('the schema and the skill use the same copy rules file', () => {
    // If someone pasted the rules back into the schema, the two copies could drift apart.
    const schema = fs.readFileSync(path.join(root, 'src', 'content.config.ts'), 'utf8');
    expect(schema).toContain("from './lib/copy-rules.js'");
    expect(schema).not.toMatch(/const noDashes|const noPhone|const startsWithPastTenseVerb/);
    expect(fs.readFileSync(script, 'utf8')).toContain("src/lib/copy-rules.js");
  });
});
