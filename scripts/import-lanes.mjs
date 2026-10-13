// Reads lane tags, role ranks, and combined bullets from the resume bullet bank and (optionally) writes them into
// the committed YAML files. The site builds in CI without access to private/, so this runs on your machine.
//
//   node scripts/import-lanes.mjs                  check: print a report, write nothing
//   node scripts/import-lanes.mjs --write          also update bullets.yaml, roles.yaml, and combos.yaml
//   node scripts/import-lanes.mjs --write --apply-text   also copy changed bullet wording from the bank
//
//   --bank <path>       the bank markdown (default private/bank-export.md; refresh it from the artifact first)
//   --data-dir <path>   the folder with roles.yaml, bullets.yaml, lanes.yaml (default src/data/resume)
//
// Exit code 1 when the bank has hard problems. Nothing is written in that case, even with --write.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { planFromBank, normalize } from './lib/bank-lanes.mjs';
import { editBullets, editRoles, renderCombos } from './lib/yaml-write.mjs';
import { checkLaneData } from '../src/lib/lane-data.js';
import { noDashes, noPhone, startsWithPastTenseVerb } from '../src/lib/copy-rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

const write = flag('--write');
const applyText = flag('--apply-text');
const bankPath = path.resolve(root, option('--bank') ?? 'private/bank-export.md');
const dataDir = path.resolve(root, option('--data-dir') ?? 'src/data/resume');

const die = (message) => {
  console.error(`import-lanes: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(bankPath)) {
  die(`${path.relative(root, bankPath)} not found. Refresh it from the bank artifact first (see CLAUDE.md), or pass --bank <path>.`);
}
const readYaml = (file, optional = false) => {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) {
    if (optional) return null;
    die(`${path.relative(root, p)} not found.`);
  }
  return yaml.load(fs.readFileSync(p, 'utf8'));
};

const lanes = [...readYaml('lanes.yaml')].sort((a, b) => a.order - b.order);
const roles = readYaml('roles.yaml');
const bullets = readYaml('bullets.yaml');
const laneOrder = lanes.map((l) => l.id);
const codeOf = new Map(lanes.map((l) => [l.id, l.code]));

const bank = fs.readFileSync(bankPath, 'utf8');
const plan = planFromBank({ bank, lanes, roles, bullets });

// With --apply-text, the new wording has to pass the same copy rules the schema enforces.
const textProblems = [];
if (applyText) {
  for (const [id, text] of plan.textUpdates) {
    if (!noDashes(text)) textProblems.push(`${id}: the bank wording uses an em dash, en dash, or double hyphen`);
    if (!noPhone(text)) textProblems.push(`${id}: the bank wording contains a phone number`);
    if (!startsWithPastTenseVerb(text)) textProblems.push(`${id}: the bank wording does not start with a past-tense verb`);
  }
}
const problems = [...plan.problems, ...textProblems];

// ---------------------------------------------------------------- report
function wordDiff(a, b) {
  const x = a.split(' ');
  const y = b.split(' ');
  const L = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      ops.push(['=', x[i]]);
      i++;
      j++;
    }
    else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', x[i++]]);
    else ops.push(['+', y[j++]]);
  }
  while (i < x.length) ops.push(['-', x[i++]]);
  while (j < y.length) ops.push(['+', y[j++]]);
  const clean = ops;
  const hunks = [];
  let cur = null;
  clean.forEach(([t, w], k) => {
    if (t === '=') {
      if (cur) {
        cur.after.push(w);
        if (cur.after.length >= 3) {
          hunks.push(cur);
          cur = null;
        }
      }
      return;
    }
    if (cur?.after.length) {
      hunks.push(cur);
      cur = null;
    }
    cur ??= { before: clean.slice(Math.max(0, k - 3), k).filter((o) => o[0] === '=').map((o) => o[1]), rm: [], add: [], after: [] };
    (t === '-' ? cur.rm : cur.add).push(w);
  });
  if (cur) hunks.push(cur);
  return hunks.map((h) => `...${h.before.slice(-3).join(' ')} [${h.rm.join(' ')} => ${h.add.join(' ')}] ${h.after.slice(0, 3).join(' ')}...`);
}

const out = [];
const P = (s = '') => out.push(s);
const revFile = path.join(path.dirname(bankPath), 'bank-export.rev.txt');
const rev = fs.existsSync(revFile) ? fs.readFileSync(revFile, 'utf8').split('\n').find((l) => l.startsWith('Artifact revision')) : null;

P(`import-lanes: ${path.relative(root, bankPath)}${rev ? ` (${rev.toLowerCase()})` : ''}`);
P(
  `${plan.byBullet.size} tagged bullets, ${plan.combos.length} combined, ${plan.roleRanks.size} ranked roles; ` +
    `${problems.length} problem(s), ${plan.warnings.length} warning(s)`,
);
if (problems.length) {
  P('\nPROBLEMS (nothing will be written):');
  for (const p of problems) P(`  - ${p}`);
}
if (plan.warnings.length) {
  P('\nWarnings:');
  for (const w of plan.warnings) P(`  - ${w}`);
}
if (plan.resolvedNew.length) {
  P(`\nMatched by text (the bank says "new"): ${plan.resolvedNew.length}. You can replace "new" in the bank with these ids:`);
  for (const r of plan.resolvedNew) P(`  - line ${r.line}: ${r.id}`);
}
P(`\nEmpty lane lists (never used in a lane): ${plan.empties.length}`);
for (const id of plan.empties) P(`  - ${id}`);
P(`\nPosition ties (allowed; the order in the bank breaks them): ${plan.ties.length}`);
for (const t of plan.ties.slice(0, 10)) P(`  - ${t}`);

P(`\nBullet wording that differs from bullets.yaml: ${plan.textUpdates.size}${applyText ? '' : ' (add --apply-text with --write to copy it)'}`);
for (const [id, text] of plan.textUpdates) {
  const old = bullets.find((b) => b.id === id);
  P(`  - ${id}`);
  for (const d of wordDiff(normalize(old.text), text)) P(`      ${d}`);
}

P('\nTier counts per lane (tier 1 / 2 / 3), bullets only:');
for (const lane of lanes) {
  const t = [0, 0, 0];
  for (const l of plan.bulletLanes.values()) if (l[lane.id]) t[l[lane.id][0] - 1]++;
  P(`  - ${lane.code.padEnd(5)} ${t.join(' / ')}   (${t[0] + t[1] + t[2]} bullets)`);
}
if (plan.combos.length) {
  P('\nCombined bullets:');
  for (const c of plan.combos) P(`  - ${c.id} (${c.role}) replaces ${c.replaces.length}, lanes ${c.lanes.map((l) => codeOf.get(l)).join(' ')}`);
}

// ---------------------------------------------------------------- write
if (write && problems.length === 0) {
  const read = (f) => fs.readFileSync(path.join(dataDir, f), 'utf8');
  const bulletsText = editBullets(read('bullets.yaml'), plan.bulletLanes, applyText ? plan.textUpdates : new Map(), laneOrder);
  const rolesText = editRoles(read('roles.yaml'), plan.roleRanks, laneOrder);
  const combosPath = path.join(dataDir, 'combos.yaml');
  const combosExist = fs.existsSync(combosPath);
  const eol = read('bullets.yaml').includes('\r\n') ? '\r\n' : '\n';
  const combosText = combosExist || plan.combos.length ? renderCombos(plan.combos, eol) : null;

  // Check the result by reading it back, with the same checks the build runs.
  const newBullets = yaml.load(bulletsText);
  const newRoles = yaml.load(rolesText);
  const newCombos = combosText ? yaml.load(combosText) : [];
  const readBack = checkLaneData({ lanes, roles: newRoles, bullets: newBullets, combos: newCombos });
  for (const b of newBullets) {
    const want = plan.bulletLanes.get(b.id);
    const ordered = (o) => JSON.stringify(laneOrder.filter((l) => o?.[l]).map((l) => [l, o[l]]));
    if (want && ordered(b.lanes) !== ordered(want)) readBack.push(`read-back mismatch on bullet ${b.id}`);
  }
  if (readBack.length) die(`the result failed its own check, nothing written:\n  - ${readBack.join('\n  - ')}`);

  const changed = [];
  const put = (file, text) => {
    const p = path.join(dataDir, file);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) {
      fs.writeFileSync(p, text);
      changed.push(file);
    }
  };
  put('bullets.yaml', bulletsText);
  put('roles.yaml', rolesText);
  if (combosText) put('combos.yaml', combosText);
  P(changed.length ? `\nWrote: ${changed.join(', ')}` : '\nNothing to change: the YAML already matches the bank.');
} else if (write) {
  P('\nNothing written: fix the problems above and run again.');
}

console.log(out.join('\n'));
process.exit(problems.length ? 1 : 0);
