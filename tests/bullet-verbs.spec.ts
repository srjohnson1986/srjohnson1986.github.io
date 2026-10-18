import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { bullets, root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { startsWithPastTenseVerb } from '../src/lib/copy-rules.js';

// CLAUDE.md: resume bullets start with a strong, past-tense, action-oriented verb. The content schema
// (src/content.config.ts) enforces it with startsWithPastTenseVerb, so a bad bullet fails the build.
// No browser needed.

const startsWell = startsWithPastTenseVerb as (s: string) => boolean;

test.describe('bullets start with a past-tense verb', { tag: ['@req-352'] }, () => {
  test('the rule accepts past-tense verbs, regular and irregular', () => {
    for (const text of ['Built a thing', 'Led the team', 'Reduced the time', 'Wrote the docs']) {
      expect(startsWell(text), text).toBe(true);
    }
  });

  test('the rule rejects present tense, -ing forms, and non-verbs', () => {
    for (const text of ['Build a thing', 'Leading the team', 'Responsible for releases', 'Manages the queue', '5 releases shipped', '']) {
      expect(startsWell(text), JSON.stringify(text)).toBe(false);
    }
  });

  test('every bullet in the real data starts with a past-tense verb, public or not', () => {
    expect(bullets.length).toBeGreaterThan(50);
    const bad = bullets.filter((b) => !startsWell(b.text)).map((b) => b.id);
    expect(bad).toEqual([]);
  });

  test('every combined bullet starts with a past-tense verb too', () => {
    const combos = yaml.load(fs.readFileSync(path.join(root, 'src', 'data', 'resume', 'combos.yaml'), 'utf8')) as { id: string; text: string }[];
    expect(combos.length).toBeGreaterThan(0);
    expect(combos.filter((c) => !startsWell(c.text)).map((c) => c.id)).toEqual([]);
  });

  test('the content schema applies the rule to bullets and to combined bullets', () => {
    const schema = fs.readFileSync(path.join(root, 'src', 'content.config.ts'), 'utf8');
    expect(schema.match(/text: copy\.refine\(startsWithPastTenseVerb/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
