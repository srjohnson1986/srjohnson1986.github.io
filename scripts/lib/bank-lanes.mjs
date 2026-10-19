// Reads the resume bullet bank (markdown) and works out the lane data to put in the YAML files.
// Pure functions: they read nothing from disk and write nothing. scripts/import-lanes.mjs does the I/O.
//
// What the bank carries (see the "Lane tags" note at the top of the bank):
//   - a role heading ends with a rank per lane:        ## Verizon Wireless (2012-2024) [QA1 SDET4 CON2 ...]
//   - a bullet ends with its id and a tier.position per lane it may be used in:
//         - Built a thing. [tpd-built-a-thing | QA1.20 SDET2.10]      (no lane = never used there)
//         - Whatever.      [tpd-other-thing | ]                         (empty list = never used in any lane)
//   - a bullet that is not in bullets.yaml yet has the id `new` and is matched by its text
//   - a combined bullet stands in for one or more bullets:
//         - Combined text. [tpd-combo-x replaces tpd-a tpd-b | QA SDET]
// The export escapes square brackets as \[ and \]; both forms are accepted.

import { checkLaneData } from '../../src/lib/lane-data.js';
import { noDashes, noPhone, startsWithPastTenseVerb } from '../../src/lib/copy-rules.js';

const BS = String.fromCharCode(92);

/** Removes markdown escaping (a backslash before punctuation) and collapses whitespace. */
export function normalize(s) {
  return s.split(BS).join('').replace(/\s+/g, ' ').trim();
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A trailing [ ... ] group, escaped or not: returns [textBefore, insideNormalized] or null.
function splitTag(line) {
  let end = line.trimEnd();
  if (end.endsWith(BS + ']')) end = end.slice(0, -2);
  else if (end.endsWith(']')) end = end.slice(0, -1);
  else return null;
  const open = end.lastIndexOf('[');
  if (open < 0) return null;
  const start = end[open - 1] === BS ? open - 1 : open;
  return [end.slice(0, start), normalize(end.slice(open + 1))];
}

/**
 * @param {object} input
 * @param {string} input.bank the bank markdown
 * @param {{ id: string, code: string, order?: number }[]} input.lanes
 * @param {{ id: string, org: string }[]} input.roles
 * @param {{ id: string, role: string, public: boolean, text: string }[]} input.bullets
 */
export function planFromBank({ bank, lanes, roles, bullets }) {
  const problems = [];
  const warnings = [];
  const laneByCode = new Map(lanes.map((l) => [l.code, l]));
  const bulletsById = new Map(bullets.map((b) => [b.id, b]));
  const bulletsByText = new Map();
  for (const b of bullets) {
    const key = normalize(b.text);
    bulletsByText.set(key, [...(bulletsByText.get(key) ?? []), b]);
  }

  const roleRanks = new Map(); // role id -> { lane id: rank }
  const tagged = []; // every tagged bullet line
  let currentRole = null;

  const lines = bank.split(/\r?\n/);
  lines.forEach((line, index) => {
    const n = index + 1;

    // ---- role headings carry the rank of the role in each lane
    const heading = line.match(/^## (.*)$/);
    if (heading) {
      currentRole = null;
      const split = splitTag(heading[1]);
      const title = normalize(split ? split[0] : heading[1]);
      const role = roles.find((r) => new RegExp(`^${escapeRegExp(r.org)}(?: - | \\(|$)`, 'i').test(title));
      if (!role) return;
      currentRole = role.id;
      const ranks = {};
      const seen = new Set();
      for (const token of split && split[1] ? split[1].split(/\s+/) : []) {
        const m = token.match(/^([A-Z]+)(\d+)$/);
        const lane = m && laneByCode.get(m[1]);
        if (!lane) problems.push(`line ${n}: role heading "${title}" has a bad rank "${token}" (use a lane code and a number, like QA3)`);
        else if (Number(m[2]) < 1) problems.push(`line ${n}: role "${role.id}" ranks ${m[1]} as ${m[2]}; ranks start at 1`);
        else if (seen.has(m[1])) problems.push(`line ${n}: role "${role.id}" ranks ${m[1]} twice`);
        else {
          seen.add(m[1]);
          ranks[lane.id] = Number(m[2]);
        }
      }
      const missing = lanes.filter((l) => !(l.id in ranks)).map((l) => l.code);
      if (missing.length) problems.push(`line ${n}: role heading "${title}" is missing a rank for ${missing.join(', ')}`);
      if (roleRanks.has(role.id)) problems.push(`line ${n}: role "${role.id}" has a second ranked heading`);
      roleRanks.set(role.id, ranks);
      return;
    }

    // ---- bullet lines
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (!item) return;
    const split = splitTag(item[1]);
    if (!split || !split[1].includes('|')) return; // untagged items (titles, copies in story sections, skills) are ignored
    const [textPart, inner] = split;
    const text = normalize(textPart);
    const combo = inner.match(/^(\S+)\s+replaces\s+(.+?)\s*\|\s*(.*)$/);
    const plain = inner.match(/^(\S+)\s*\|\s*(.*)$/);
    if (!combo && !plain) {
      problems.push(`line ${n}: unreadable tag "[${inner}]" (expected [id | tags] or [id replaces id id | lanes])`);
      return;
    }
    const entry = combo
      ? { line: n, kind: 'combo', id: combo[1], replaces: combo[2].trim().split(/\s+/), tagText: combo[3].trim(), text, section: currentRole }
      : { line: n, kind: 'bullet', id: plain[1], tagText: plain[2].trim(), text, section: currentRole };

    // lane tags
    entry.lanes = {};
    for (const token of entry.tagText ? entry.tagText.split(/\s+/) : []) {
      if (entry.kind === 'combo') {
        const lane = laneByCode.get(token);
        if (!lane) problems.push(`line ${n}: combined bullet ${entry.id} lists unknown lane "${token}"`);
        else if (entry.lanes[lane.id]) problems.push(`line ${n}: combined bullet ${entry.id} lists ${token} twice`);
        else entry.lanes[lane.id] = true;
        continue;
      }
      const m = token.match(/^([A-Z]+)(\d+)\.(\d+)$/);
      const lane = m && laneByCode.get(m[1]);
      if (!lane) problems.push(`line ${n}: ${entry.id === 'new' ? 'a new bullet' : entry.id} has a bad lane tag "${token}" (expected a lane code, a tier, a dot, and a position, like QA1.20)`);
      else if (![1, 2, 3].includes(Number(m[2]))) problems.push(`line ${n}: ${entry.id} has tier ${m[2]} in ${m[1]}; tiers are 1, 2, or 3`);
      else if (Number(m[3]) < 1) problems.push(`line ${n}: ${entry.id} has position ${m[3]} in ${m[1]}; positions start at 1`);
      else if (entry.lanes[lane.id]) problems.push(`line ${n}: ${entry.id} lists ${m[1]} twice`);
      else entry.lanes[lane.id] = [Number(m[2]), Number(m[3])];
    }
    tagged.push(entry);
  });

  // ---- role headings: every role needs one
  for (const role of roles) {
    if (!roleRanks.has(role.id)) problems.push(`role "${role.id}" (${role.org}) has no ranked heading in the bank`);
  }

  // ---- resolve ids
  const resolvedNew = [];
  const byBullet = new Map(); // bullet id -> entry
  const combos = [];
  for (const entry of tagged) {
    if (entry.kind === 'combo') {
      combos.push(entry);
      continue;
    }
    let bullet = bulletsById.get(entry.id);
    if (entry.id === 'new') {
      const matches = bulletsByText.get(entry.text) ?? [];
      if (matches.length === 1) {
        bullet = matches[0];
        resolvedNew.push({ line: entry.line, id: bullet.id });
      } else {
        problems.push(
          matches.length > 1
            ? `line ${entry.line}: a new bullet matches ${matches.length} bullets in bullets.yaml (${matches.map((m) => m.id).join(', ')})`
            : `line ${entry.line}: a new bullet is not in bullets.yaml yet. Add it first ("${entry.text.slice(0, 60)}...")`,
        );
        continue;
      }
    } else if (!bullet) {
      problems.push(`line ${entry.line}: id "${entry.id}" is not in bullets.yaml`);
      continue;
    }
    entry.bullet = bullet;
    if (entry.section && entry.section !== bullet.role) {
      warnings.push(`line ${entry.line}: ${bullet.id} sits under the ${entry.section} heading but bullets.yaml says ${bullet.role}; the id decides`);
    }
    const prior = byBullet.get(bullet.id);
    if (prior) {
      const same = JSON.stringify(prior.lanes) === JSON.stringify(entry.lanes);
      if (same) warnings.push(`${bullet.id} is tagged on lines ${prior.line} and ${entry.line} with the same tags`);
      else problems.push(`${bullet.id} is tagged on lines ${prior.line} and ${entry.line} with different tags`);
      continue;
    }
    byBullet.set(bullet.id, entry);
  }

  // ---- every public bullet in the repo needs a tagged line, or it would silently get no lanes
  for (const bullet of bullets) {
    if (bullet.public && !byBullet.has(bullet.id)) problems.push(`bullet "${bullet.id}" has no tagged line in the bank`);
  }

  // ---- the lane data this would produce
  const bulletLanes = new Map(); // bullet id -> { lane id: [tier, position] }
  for (const [id, entry] of byBullet) bulletLanes.set(id, entry.lanes);

  // ---- combined bullets
  const comboPlans = [];
  for (const entry of combos) {
    const replaced = entry.replaces.map((id) => bulletsById.get(id));
    const roleIds = new Set(replaced.filter(Boolean).map((b) => b.role));
    if (roleIds.size !== 1) {
      if (roleIds.size > 1) problems.push(`line ${entry.line}: combined bullet ${entry.id} replaces bullets from different roles (${[...roleIds].join(', ')})`);
      // unknown ids and the rest are reported by the shared checker below
    }
    const role = [...roleIds][0] ?? entry.id.split('-')[0];
    for (const rule of [
      [noDashes(entry.text), 'uses an em dash, en dash, or double hyphen'],
      [noPhone(entry.text), 'contains a phone number'],
      [startsWithPastTenseVerb(entry.text), 'does not start with a past-tense verb'],
    ]) {
      if (!rule[0]) problems.push(`line ${entry.line}: combined bullet ${entry.id} ${rule[1]}`);
    }
    const source = replaced.map((b) => (b ? normalize(b.text) : '')).join(' ');
    const fresh = (entry.text.match(/\$?\d[\d,.]*\+?%?/g) ?? []).filter((x) => !source.includes(x.replace(/[.,]$/, '')));
    if (fresh.length) warnings.push(`line ${entry.line}: combined bullet ${entry.id} has numbers that are not in the bullets it replaces: ${fresh.join(', ')}`);
    comboPlans.push({ id: entry.id, role, replaces: entry.replaces, lanes: lanes.filter((l) => entry.lanes[l.id]).map((l) => l.id), text: entry.text });
  }

  // ---- text drift
  const textUpdates = new Map();
  for (const [id, entry] of byBullet) {
    if (normalize(entry.bullet.text) !== entry.text) textUpdates.set(id, entry.text);
  }

  // ---- run the build's own lane checks on what would be written
  const proposed = {
    lanes: lanes.map((l) => ({ id: l.id, code: l.code })),
    roles: roles.map((r) => ({ id: r.id, lane_rank: roleRanks.get(r.id) })),
    bullets: bullets.map((b) => ({ id: b.id, role: b.role, public: b.public, lanes: bulletLanes.get(b.id) })),
    combos: comboPlans,
  };
  const laneProblems = checkLaneData(proposed);
  problems.push(...laneProblems);

  // ---- soft observations
  const empties = [...byBullet.values()].filter((e) => Object.keys(e.lanes).length === 0);
  const ties = [];
  const seenPos = new Map();
  for (const [id, entry] of byBullet) {
    for (const [lane, [tier, pos]] of Object.entries(entry.lanes)) {
      const key = `${entry.bullet.role} ${lane} tier ${tier} position ${pos}`;
      seenPos.set(key, [...(seenPos.get(key) ?? []), id]);
    }
  }
  for (const [key, ids] of seenPos) if (ids.length > 1) ties.push(`${key}: ${ids.join(', ')}`);

  return { problems, warnings, roleRanks, bulletLanes, combos: comboPlans, textUpdates, resolvedNew, empties: empties.map((e) => e.bullet.id), ties, byBullet, laneProblems };
}
