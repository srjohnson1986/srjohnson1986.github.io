#!/usr/bin/env node
// Checks a new resume bullet against the owner's rules, and (in "add" mode) writes it.
//
//   node .claude/skills/add-resume-bullet/check-bullet.mjs check --role tpd --versions qa,consulting --text "Built ..."
//   node .claude/skills/add-resume-bullet/check-bullet.mjs add   --role tpd --versions qa --theme x --tags a,b --text "Built ..."
//
// "check" never writes. "add" runs the same checks and writes only when none fail.
//
// What this script checks is only what the build does NOT already enforce. The schema in
// src/content.config.ts already rejects dashes, phone numbers, and a first word that is not a
// past-tense verb; those three rules are imported from src/lib/copy-rules.js (the schema uses the
// same file), so they are run here only to stop a bad entry BEFORE it is written. The build still
// has the last word: it also checks that the role, theme, tags, and every referenced bullet are valid.
//
// Exit code: 0 = no errors (warnings are allowed), 1 = at least one error, 2 = bad command line.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { noDashes, noPhone, startsWithPastTenseVerb, WEAK_VERBS, unflooredCounts } from '../../../src/lib/copy-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dataDir = path.join(root, 'src', 'data', 'resume');
const file = (name) => path.join(dataDir, name);

// ---- The rules this script adds ------------------------------------------------------------------
// The weak-verb list and the project-count check live in src/lib/copy-rules.js (shared with the AI bullet
// eval in evals/); edit them there. The suggested strong verbs below are only suggestions.

// Strong verbs offered as alternatives. Each must pass the schema's past-tense check (see the test).
export const STRONG_VERBS = [
  'Accelerated', 'Architected', 'Audited', 'Authored', 'Automated', 'Built', 'Consolidated', 'Coordinated',
  'Delivered', 'Designed', 'Diagnosed', 'Drove', 'Engineered', 'Established', 'Implemented', 'Improved',
  'Introduced', 'Launched', 'Led', 'Migrated', 'Modernized', 'Optimized', 'Orchestrated', 'Owned',
  'Pioneered', 'Reduced', 'Refactored', 'Resolved', 'Shipped', 'Simplified', 'Spearheaded', 'Standardized',
  'Streamlined', 'Transformed', 'Wrote',
];

// ---- Helpers --------------------------------------------------------------------------------------

const load = (name) => yaml.load(fs.readFileSync(file(name), 'utf8'));
const firstWord = (text) => text.match(/^[A-Za-z]+/)?.[0] ?? '';
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Words left out of a generated bullet id (the existing ids drop them too).
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from', 'that', 'by', 'as', 'its', 'their', 'each', 'every']);
const makeId = (role, text) => {
  const words = text.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) ?? [];
  const kept = words.filter((w) => !STOP.has(w.toLowerCase())).slice(0, 5);
  return `${role}-${kebab(kept.join('-'))}`;
};

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const opts = { mode, flags: new Set() };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);
    const key = arg.slice(2);
    if (key === 'exact-ok' || key === 'allow-new-labels') opts.flags.add(key);
    else if (['role', 'versions', 'text', 'theme', 'tags', 'id'].includes(key)) {
      if (rest[i + 1] === undefined) throw new Error(`--${key} needs a value`);
      opts[key] = rest[++i];
    } else throw new Error(`Unknown option --${key}`);
  }
  if (mode !== 'check' && mode !== 'add') throw new Error('The first argument must be "check" or "add"');
  return opts;
}

// ---- The checks -----------------------------------------------------------------------------------

/** Returns { errors, warnings, notes, id } without touching any file. */
export function checkBullet({ role, versions, text, theme, tags, id, exactOk = false, allowNewLabels = false, requireLabels = false }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();

  // 1. Rules the schema already enforces. Run here only so a bad bullet is stopped before it is written.
  if (!clean) errors.push('The bullet text is empty.');
  if (clean && !noDashes(clean)) errors.push('Use single hyphens only: no em dashes, en dashes, or double hyphens. (Same rule as the schema.)');
  if (clean && !noPhone(clean)) errors.push('Do not publish phone numbers. (Same rule as the schema.)');
  if (clean && !startsWithPastTenseVerb(clean)) {
    errors.push(`"${firstWord(clean)}" is not a past-tense verb. Start with one, such as "${STRONG_VERBS.slice(0, 3).join('", "')}". (Same rule as the schema; if a valid irregular verb is rejected, add it to IRREGULAR_PAST in src/lib/copy-rules.js.)`);
  }

  // 2. Rules the schema does NOT enforce.
  const verb = firstWord(clean);
  if (verb && WEAK_VERBS.includes(verb.toLowerCase())) {
    errors.push(`"${verb}" is not a strong action verb (weak verbs: ${WEAK_VERBS.map((v) => v[0].toUpperCase() + v.slice(1)).join(', ')}). Start with what you changed or delivered instead.`);
  }

  if (!exactOk) {
    for (const { phrase, number, between, noun } of unflooredCounts(clean)) {
      errors.push(`"${phrase}": write a project count as a floor with a plus sign, for example "${number}+${between} ${noun}". (If the count is final because the project is finished, say so and use --exact-ok.)`);
    }
  }

  // 3. Where it goes.
  const roles = load('roles.yaml');
  const bullets = load('bullets.yaml');
  const variants = load('variants.yaml');
  const groups = load('bullet-groups.yaml');

  if (!role || !roles.some((r) => r.id === role)) errors.push(`Unknown role "${role ?? ''}". Roles: ${roles.map((r) => r.id).join(', ')}.`);
  const versionList = (versions ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (versionList.length === 0) errors.push('Name at least one resume version.');
  for (const v of versionList) {
    if (!variants.some((x) => x.id === v)) errors.push(`Unknown resume version "${v}". Versions: ${variants.map((x) => x.id).join(', ')}.`);
  }
  if (new Set(versionList).size !== versionList.length) errors.push('A resume version is named twice.');

  // Existing ids start with a short prefix per role (tpd-, vz-, ps-...); reuse the one this role already has.
  const prefixes = new Set(bullets.filter((b) => b.role === role).map((b) => b.id.split('-')[0]));
  const prefix = prefixes.size === 1 ? [...prefixes][0] : (role ?? 'role');
  const finalId = id ?? makeId(prefix, clean);
  if (bullets.some((b) => b.id === finalId)) errors.push(`A bullet with the id "${finalId}" already exists. Pass --id with a different one.`);

  const sameRole = bullets.filter((b) => b.role === role);
  if (requireLabels) {
    const knownThemes = new Set(bullets.map((b) => b.theme));
    const knownTags = new Set(bullets.flatMap((b) => b.tags));
    if (!theme) errors.push(`Choose a theme. Used in this role: ${[...new Set(sameRole.map((b) => b.theme))].join(', ') || '(none)'}.`);
    else if (!knownThemes.has(theme) && !allowNewLabels) errors.push(`The theme "${theme}" is not used by any bullet yet. Known themes: ${[...knownThemes].join(', ')}. (Use --allow-new-labels to create one; the build checks its format.)`);
    const tagList = (tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    if (tagList.length === 0) errors.push(`Choose at least one tag. Known tags: ${[...knownTags].join(', ')}.`);
    for (const t of tagList) {
      if (!knownTags.has(t) && !allowNewLabels) errors.push(`The tag "${t}" is not used by any bullet yet. Known tags: ${[...knownTags].join(', ')}. (Use --allow-new-labels to create one.)`);
    }
  }

  // 4. Warnings (never block): the opening verb is already used in the same role or a chosen version.
  if (verb) {
    const lower = verb.toLowerCase();
    const sameVerb = sameRole.filter((b) => firstWord(b.text).toLowerCase() === lower);
    if (sameVerb.length > 0) {
      const usedInRole = new Set(sameRole.map((b) => firstWord(b.text).toLowerCase()));
      const alternatives = STRONG_VERBS.filter((v) => !usedInRole.has(v.toLowerCase()) && !WEAK_VERBS.includes(v.toLowerCase()) && startsWithPastTenseVerb(v)).slice(0, 6);
      warnings.push(
        `"${verb}" already starts ${sameVerb.length} other bullet${sameVerb.length > 1 ? 's' : ''} in the ${role} role (${sameVerb.map((b) => b.id).join(', ')}). ` +
          `Unused verbs in this role: ${alternatives.join(', ')}.`,
      );
    }
    const bulletsById = new Map(bullets.map((b) => [b.id, b]));
    for (const v of versionList) {
      const variant = variants.find((x) => x.id === v);
      if (!variant) continue;
      const ids = [...(variant.include ?? []).flatMap((g) => groups.find((x) => x.id === g)?.bullets ?? []), ...(variant.bullets ?? [])];
      const clash = ids.filter((i) => firstWord(bulletsById.get(i)?.text ?? '').toLowerCase() === lower);
      if (clash.length > 0) warnings.push(`In the "${v}" version, "${verb}" also starts ${clash.join(', ')}. The build will print a repeated-verb warning (it never fails on it).`);
    }
  }

  // 5. A reminder, not a check: numbers must be real.
  const numbers = clean.match(/\$?\d[\d,.]*\+?%?/g);
  if (numbers) notes.push(`Numbers in this bullet (${numbers.join(', ')}) must come from the resume bullet bank or from you. This script cannot verify them.`);

  return { errors, warnings, notes, id: finalId, clean, versionList };
}

// ---- Writing --------------------------------------------------------------------------------------

const wrap = (text, width) => {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
};

/** Writes the entry to bullets.yaml and the version lists, preserving comments and line endings. */
function writeBullet({ id, role, theme, tags, clean, versionList }) {
  const bulletsPath = file('bullets.yaml');
  const variantsPath = file('variants.yaml');
  const originalBullets = fs.readFileSync(bulletsPath, 'utf8');
  const originalVariants = fs.readFileSync(variantsPath, 'utf8');
  const eol = originalBullets.includes('\r\n') ? '\r\n' : '\n';

  // bullets.yaml: after the last entry of this role (the role's block order matches roles.yaml).
  const lines = originalBullets.split(/\r?\n/);
  let lastRoleLine = -1;
  lines.forEach((l, i) => {
    if (l === `  role: ${role}`) lastRoleLine = i;
  });
  if (lastRoleLine === -1) throw new Error(`No existing bullet for role "${role}" to place the new one after; add the first one by hand.`);
  let end = lastRoleLine;
  while (end + 1 < lines.length && lines[end + 1].trim() !== '') end++;
  const entry = [
    `- id: ${id}`,
    `  role: ${role}`,
    `  theme: ${theme}`,
    `  tags: [${tags.join(', ')}]`,
    '  public: true',
    '  text: >-',
    ...wrap(clean, 90).map((l) => `    ${l}`),
  ];
  lines.splice(end + 1, 0, '', ...entry);
  // Keep the "(role) - N bullets" count in the block header right.
  let nextBullets = lines.join(eol);
  const count = yaml.load(nextBullets).filter((b) => b.role === role).length;
  nextBullets = nextBullets.replace(new RegExp(`(\\(${role}\\) - )\\d+( bullets)`), `$1${count}$2`);

  // variants.yaml: end of this role's run inside the version's own `bullets:` list.
  const bulletRole = new Map(yaml.load(originalBullets).map((b) => [b.id, b.role]));
  const vlines = originalVariants.split(/\r?\n/);
  for (const v of versionList) {
    const start = vlines.findIndex((l) => l === `- id: ${v}`);
    if (start === -1) throw new Error(`Version "${v}" not found in variants.yaml`);
    let stop = start + 1;
    while (stop < vlines.length && !/^- id:/.test(vlines[stop])) stop++;
    const block = vlines.slice(start, stop);
    const listStart = block.findIndex((l) => l === '  bullets:');
    if (listStart === -1) throw new Error(`Version "${v}" has no bullets list in variants.yaml; add the bullet by hand.`);
    let lastItem = -1;
    let lastSameRole = -1;
    for (let i = listStart + 1; i < block.length; i++) {
      const m = block[i].match(/^ {4}- (\S+)\s*$/);
      if (!m) {
        if (block[i].trim() === '') continue;
        break;
      }
      lastItem = i;
      if (bulletRole.get(m[1]) === role) lastSameRole = i;
    }
    const at = start + (lastSameRole !== -1 ? lastSameRole : lastItem) + 1;
    vlines.splice(at, 0, `    - ${id}`);
  }

  // Write both files only after both edits succeeded, then confirm the result still parses.
  const nextVariants = vlines.join(eol);
  const check = yaml.load(nextBullets).find((b) => b.id === id);
  const listed = yaml.load(nextVariants).filter((x) => versionList.includes(x.id) && x.bullets.includes(id));
  if (!check || listed.length !== versionList.length) throw new Error('The edited files did not parse as expected; nothing was written.');
  fs.writeFileSync(bulletsPath, nextBullets);
  fs.writeFileSync(variantsPath, nextVariants);
}

// ---- Command line ---------------------------------------------------------------------------------

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\nUsage: check-bullet.mjs <check|add> --role <id> --versions <a,b> --text "..." [--theme t --tags a,b] [--id x] [--exact-ok] [--allow-new-labels]`);
    process.exit(2);
  }
  const result = checkBullet({
    role: opts.role,
    versions: opts.versions,
    text: opts.text,
    theme: opts.theme,
    tags: opts.tags,
    id: opts.id,
    exactOk: opts.flags.has('exact-ok'),
    allowNewLabels: opts.flags.has('allow-new-labels'),
    requireLabels: opts.mode === 'add',
  });
  for (const e of result.errors) console.log(`ERROR  ${e}`);
  for (const w of result.warnings) console.log(`WARN   ${w}`);
  for (const n of result.notes) console.log(`NOTE   ${n}`);
  if (result.errors.length > 0) {
    console.log(`\nNothing was written. Fix the ${result.errors.length} error${result.errors.length > 1 ? 's' : ''} above and run again.`);
    process.exit(1);
  }
  if (opts.mode === 'check') {
    console.log(`\nOK  no errors. Nothing was written (check mode). Planned id: ${result.id}`);
  } else {
    writeBullet({ id: result.id, role: opts.role, theme: opts.theme, tags: opts.tags.split(',').map((t) => t.trim()).filter(Boolean), clean: result.clean, versionList: result.versionList });
    console.log(`\nWROTE  ${result.id} to src/data/resume/bullets.yaml and to: ${result.versionList.join(', ')} (src/data/resume/variants.yaml)`);
  }
}
