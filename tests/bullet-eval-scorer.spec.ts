import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { scoreOutput, RULES, MANUAL_REVIEW, numbersIn } from '../evals/lib/score.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { PROMPTS } from '../evals/resume-bullets/prompts.mjs';
// @ts-expect-error - plain JavaScript module with no type declarations
import { isBareOneSentence, notWeakVerb, unflooredCounts, WEAK_VERBS } from '../src/lib/copy-rules.js';

// The scorer for the AI resume bullet eval (evals/lib/score.mjs). It is ordinary code, so these tests
// are exact: fixed sample outputs, a clean one that passes, and a bad one for every rule that must fail
// it. They prove the scorer can fail BEFORE any live call to the model. No browser, no network.

type Prompt = { id: string; kind: string; input: string; forbidden?: string[] };
type Score = { passed: boolean; results: { rule: string; status: 'pass' | 'fail' | 'n/a'; detail?: string }[] };
const prompts = PROMPTS as Prompt[];
const rules = RULES as { id: string }[];
const score = scoreOutput as (output: string, prompt: Prompt) => Score;
const promptById = (id: string) => prompts.find((p) => p.id === id)!;
const failedRules = (s: Score) => s.results.filter((r) => r.status === 'fail').map((r) => r.rule);

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

// One clean bullet for every prompt. Each must pass every rule that applies to it.
const GOOD: Record<string, string> = {
  'normal-test-suite':
    'Built a Playwright test suite that checks every resume version, the print layouts, all links, and accessibility in light and dark mode on every pull request.',
  'normal-ci-merge':
    'Established branch protection so changes reach main only through a pull request with a passing build, and dependency updates merge automatically once it passes.',
  'normal-handoff-docs':
    'Wrote a user guide, wiki, developer architecture guide, changelog, and release process so another person can support the Excel add-in after handoff.',
  'count-floor': 'Shipped new releases of an active communication board app, with 155+ issues and 164+ pull requests so far.',
  'no-outcome': 'Investigated intermittent end-to-end test failures over several weeks to narrow down the cause.',
  'weak-verb-bait': 'Coordinated release notes, pull request review, status updates, and build scripts for the team.',
  'dash-bait': 'Built a CI pipeline that runs lint, tests, and deploy in one workflow on every push.',
  'contact-details': 'Built a phone call tree so the team could reach each other quickly during an outage.',
};

// One bad bullet per rule (and variants). `also` lists other rules the same text legitimately breaks:
// a bullet that starts with a list marker or a quotation mark has no opening verb, for example.
const BAD: { name: string; rule: string; prompt: string; output: string; also?: string[] }[] = [
  { name: 'an em dash', rule: 'single-hyphens', prompt: 'dash-bait', output: `Built a CI pipeline ${EM} lint, tests, and deploy in one workflow.` },
  { name: 'an en dash', rule: 'single-hyphens', prompt: 'dash-bait', output: `Built a CI pipeline ${EN} lint, tests, and deploy in one workflow.` },
  { name: 'a double hyphen', rule: 'single-hyphens', prompt: 'dash-bait', output: 'Built a CI pipeline -- lint, tests, and deploy in one workflow.' },
  { name: 'a present-tense opening verb', rule: 'past-tense-verb', prompt: 'normal-test-suite', output: 'Build a Playwright test suite that checks every resume version.' },
  { name: 'an -ing opening word', rule: 'past-tense-verb', prompt: 'normal-test-suite', output: 'Building a Playwright test suite that checks every resume version.' },
  { name: 'a non-verb opening', rule: 'past-tense-verb', prompt: 'normal-test-suite', output: 'Responsible for a Playwright test suite that checks every resume version.' },
  { name: 'the weak verb Helped', rule: 'strong-verb', prompt: 'weak-verb-bait', output: 'Helped the team with release notes and the build scripts.' },
  { name: 'the weak verb Reviewed', rule: 'strong-verb', prompt: 'weak-verb-bait', output: 'Reviewed pull requests and release notes for the team.' },
  { name: 'the weak verb Worked', rule: 'strong-verb', prompt: 'weak-verb-bait', output: 'Worked on the build scripts and release notes for the team.' },
  { name: 'two sentences', rule: 'bare-one-sentence', prompt: 'dash-bait', output: 'Built a CI pipeline. It runs lint, tests, and deploy in one workflow.' },
  { name: 'two lines', rule: 'bare-one-sentence', prompt: 'dash-bait', output: 'Built a CI pipeline that runs lint, tests, and deploy.\nIt runs on every push.' },
  { name: 'a list marker', rule: 'bare-one-sentence', prompt: 'dash-bait', output: '- Built a CI pipeline that runs lint, tests, and deploy.', also: ['past-tense-verb'] },
  { name: 'wrapping quotation marks', rule: 'bare-one-sentence', prompt: 'dash-bait', output: '"Built a CI pipeline that runs lint, tests, and deploy."', also: ['past-tense-verb'] },
  { name: 'a lead-in', rule: 'bare-one-sentence', prompt: 'dash-bait', output: 'Here is your bullet: Built a CI pipeline that runs lint, tests, and deploy.', also: ['past-tense-verb'] },
  { name: 'a project count without a plus sign', rule: 'count-floor', prompt: 'count-floor', output: 'Shipped new releases after 155 issues and 164+ pull requests.' },
  { name: 'a phone number', rule: 'no-phone', prompt: 'contact-details', output: 'Built a phone call tree, reachable at 404-555-0123.' },
  { name: 'an invented percentage', rule: 'no-invented-numbers', prompt: 'no-outcome', output: 'Investigated intermittent test failures and cut flaky tests by 40%.' },
  { name: 'an invented count', rule: 'no-invented-numbers', prompt: 'normal-test-suite', output: 'Built a Playwright suite of 624 checks for the portfolio site.' },
  { name: 'a leaked city', rule: 'no-leaked-strings', prompt: 'contact-details', output: 'Built a phone call tree for the team in Decatur.' },
  { name: 'a leaked address', rule: 'no-leaked-strings', prompt: 'contact-details', output: 'Built a phone call tree for the office at 12 fake street.' },
];

test.describe('bullet eval scorer', { tag: ['@req-365'] }, () => {
  test('a clean bullet passes every rule that applies, for every prompt', () => {
    expect(Object.keys(GOOD).sort()).toEqual(prompts.map((p) => p.id).sort());
    for (const prompt of prompts) {
      const result = score(GOOD[prompt.id], prompt);
      expect(result.results.filter((r) => r.status === 'fail'), `${prompt.id}: ${GOOD[prompt.id]}`).toEqual([]);
      expect(result.passed).toBe(true);
    }
  });

  for (const bad of BAD) {
    test(`fails ${bad.rule} on ${bad.name}`, () => {
      const result = score(bad.output, promptById(bad.prompt));
      expect(result.passed).toBe(false);
      expect(failedRules(result).sort()).toEqual([bad.rule, ...(bad.also ?? [])].sort());
      expect(result.results.find((r) => r.rule === bad.rule)!.detail, 'a failure says why').toBeTruthy();
    });
  }

  test('every rule has a bad sample that fails it, so a new rule cannot be added untested', () => {
    expect([...new Set(BAD.map((b) => b.rule))].sort()).toEqual(rules.map((r) => r.id).sort());
  });

  test('an empty or whitespace reply fails every rule that applies, instead of passing by default', () => {
    for (const output of ['', '   \n  ']) {
      const result = score(output, promptById('contact-details'));
      expect(result.passed).toBe(false);
      // Every rule fails except the count rule, which needs a count in the text to apply.
      expect(failedRules(result).sort()).toEqual(rules.map((r) => r.id).filter((id) => id !== 'count-floor').sort());
    }
    // Rules that need a forbidden string do not apply when the prompt has none.
    const plain = score('', promptById('dash-bait'));
    expect(plain.results.find((r) => r.rule === 'no-leaked-strings')!.status).toBe('n/a');
    expect(plain.results.find((r) => r.rule === 'past-tense-verb')!.status).toBe('fail');
  });

  test('a rule that does not apply is reported as n/a, not counted as a pass', () => {
    const noCount = score(GOOD['dash-bait'], promptById('dash-bait'));
    expect(noCount.results.find((r) => r.rule === 'count-floor')!.status).toBe('n/a');
    expect(noCount.results.find((r) => r.rule === 'no-leaked-strings')!.status).toBe('n/a');
    const withCount = score(GOOD['count-floor'], promptById('count-floor'));
    expect(withCount.results.find((r) => r.rule === 'count-floor')!.status).toBe('pass');
    const forbidden = score(GOOD['contact-details'], promptById('contact-details'));
    expect(forbidden.results.find((r) => r.rule === 'no-leaked-strings')!.status).toBe('pass');
  });

  test('numbers are compared as digits, with commas and a plus sign ignored', () => {
    expect(numbersIn('Shipped 1,200+ builds in 13 days, up 4.5 percent')).toEqual(['1200', '13', '4.5']);
    const prompt = { id: 'x', kind: 'normal', input: 'There were 1,200 builds in 13 days.' };
    expect(score('Shipped 1200+ builds in 13 days.', prompt).passed).toBe(true);
    expect(score('Shipped 1300+ builds in 13 days.', prompt).passed).toBe(false);
  });

  test('rules that cannot be checked in code are listed as manual review items', () => {
    expect(MANUAL_REVIEW.length).toBeGreaterThanOrEqual(4);
    expect(MANUAL_REVIEW.join(' ')).toMatch(/Faithful/);
    expect(MANUAL_REVIEW.join(' ')).toMatch(/outcome/);
    expect(MANUAL_REVIEW.join(' ')).toMatch(/confidential/i);
  });

  test('the dash, phone, verb, weak-verb, count, and sentence rules come from the shared copy rules file', () => {
    const source = fs.readFileSync(path.join(root, 'evals', 'lib', 'score.mjs'), 'utf8');
    expect(source).toContain("from '../../src/lib/copy-rules.js'");
    // No second copy of a rule: the scorer calls the shared functions and defines none of its own.
    expect(source).not.toMatch(/const (noDashes|noPhone|startsWithPastTenseVerb|notWeakVerb|isBareOneSentence|countsAreFloors|WEAK_VERBS)\b/);
    expect(source).not.toMatch(/\u2014|\u2013/);
  });
});

test.describe('shared copy rules added for the eval', { tag: ['@req-365'] }, () => {
  test('isBareOneSentence accepts one sentence and rejects everything else', () => {
    for (const ok of ['Built a thing.', 'Built a thing', 'Delivered v1.0 on two platforms in 13 days.', 'Built Node.js tooling for the team.']) {
      expect(isBareOneSentence(ok), ok).toBe(true);
    }
    for (const bad of ['', '  ', 'Built a thing. Then another.', 'Built a thing!', 'Did it work?', '- Built a thing', '* Built a thing', '1. Built a thing', '"Built a thing"', 'Sure, Built a thing', '**Built** a thing', 'Built\na thing']) {
      expect(isBareOneSentence(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  test('notWeakVerb rejects exactly the weak verbs', () => {
    expect(WEAK_VERBS).toEqual(['reviewed', 'asked', 'helped', 'worked']);
    for (const verb of WEAK_VERBS) expect(notWeakVerb(`${verb[0].toUpperCase()}${verb.slice(1)} the thing`)).toBe(false);
    expect(notWeakVerb('Built the thing')).toBe(true);
  });

  test('unflooredCounts finds exact counts of project things and ignores floors', () => {
    expect(unflooredCounts('Shipped 152 issues and 90+ pull requests.').map((c: { phrase: string }) => c.phrase)).toEqual(['152 issues']);
    expect(unflooredCounts('Shipped 152+ issues and 90+ pull requests.')).toEqual([]);
    expect(unflooredCounts('Added 20 Rubberduck unit tests.').map((c: { phrase: string }) => c.phrase)).toEqual(['20 Rubberduck unit tests']);
    expect(unflooredCounts('Cut a 4 hour manual build to 4 clicks.')).toEqual([]);
  });
});

test.describe('bullet eval prompts', { tag: ['@req-365'] }, () => {
  test('there are eight fixed prompts with unique ids, covering every kind of case', () => {
    expect(prompts).toHaveLength(8);
    expect(new Set(prompts.map((p) => p.id)).size).toBe(prompts.length);
    const kinds = new Set(prompts.map((p) => p.kind));
    for (const kind of ['normal', 'count', 'no-outcome', 'weak-verb', 'dash', 'forbidden']) expect(kinds.has(kind), kind).toBe(true);
    for (const p of prompts) expect(p.input.trim().length, p.id).toBeGreaterThan(30);
  });

  test('the bait prompts really contain the bait', () => {
    expect(promptById('dash-bait').input).toContain(EM);
    expect(promptById('dash-bait').input).toContain('--');
    const contact = promptById('contact-details');
    expect(contact.input).toMatch(/\d{3}-\d{3}-\d{4}/);
    expect(contact.forbidden!.length).toBeGreaterThan(0);
    // A forbidden string that is not in the input could never be repeated, so it would test nothing.
    for (const f of contact.forbidden!) expect(contact.input.toLowerCase()).toContain(f.toLowerCase());
    expect(promptById('weak-verb-bait').input.toLowerCase()).toMatch(/helped|reviewed|asked|worked/);
    expect(promptById('count-floor').input).toMatch(/\d+ issues/);
    expect(promptById('no-outcome').input.toLowerCase()).toMatch(/no results|nothing/);
  });

  test('only made-up contact details are used', () => {
    const all = prompts.map((p) => p.input).join('\n');
    const phones = all.match(/\d{3}-\d{3}-\d{4}/g) ?? [];
    expect(phones).toEqual(['404-555-0123']);
    expect(all).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});
