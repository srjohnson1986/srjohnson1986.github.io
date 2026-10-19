// Text edits for the resume YAML files. They change only the lines they own (`lanes:` on a bullet, `lane_rank:`
// on a role, a bullet's `text:` block) and leave comments, other fields, and the file's line endings alone, so
// a run shows up as a small git diff. Pure functions: text in, text out.

const WIDTH = 92; // the wrap width the existing text blocks use

/** Splits keeping track of the file's line ending, so it can be put back. */
function split(text) {
  return { eol: text.includes('\r\n') ? '\r\n' : '\n', lines: text.split(/\r?\n/) };
}

/** Wraps words into a folded block scalar body, four spaces in. */
export function wrapText(text) {
  const out = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (cur && 4 + cur.length + 1 + word.length > WIDTH) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  out.push(cur);
  return out.map((l) => `    ${l}`);
}

const flowLanes = (obj, laneOrder, fmt) =>
  `{${laneOrder.filter((l) => obj[l] !== undefined).map((l) => `${l}: ${fmt(obj[l])}`).join(', ')}}`;

/**
 * Sets or removes `lanes:` on every bullet and, when asked, replaces the wording.
 * @param {string} text bullets.yaml
 * @param {Map<string, Record<string, number[]>>} lanesById lane tags per bullet id (an empty object removes the line)
 * @param {Map<string, string>} textById new wording per bullet id
 * @param {string[]} laneOrder lane ids in display order
 */
export function editBullets(text, lanesById, textById, laneOrder) {
  const { eol, lines } = split(text);
  const starts = [];
  lines.forEach((l, i) => {
    if (l.startsWith('- id: ')) starts.push(i);
  });
  const out = lines.slice(0, starts[0] ?? lines.length);
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const id = lines[start].slice('- id: '.length).trim();
    let block = lines.slice(start, end);

    if (lanesById.has(id)) {
      const lanes = lanesById.get(id);
      block = block.filter((l) => !l.startsWith('  lanes:'));
      if (Object.keys(lanes).length) {
        const at = block.findIndex((l) => l.startsWith('  tags:'));
        if (at < 0) throw new Error(`bullet "${id}" has no tags: line to put lanes after`);
        block.splice(at + 1, 0, `  lanes: ${flowLanes(lanes, laneOrder, ([tier, pos]) => `[${tier}, ${pos}]`)}`);
      }
    }

    if (textById.has(id)) {
      const t = block.findIndex((l) => l === '  text: >-');
      if (t < 0) throw new Error(`bullet "${id}" has no folded text block to replace`);
      let e = t + 1;
      while (e < block.length && block[e].startsWith('    ')) e++;
      block.splice(t + 1, e - t - 1, ...wrapText(textById.get(id)));
    }
    out.push(...block);
  });
  return out.join(eol);
}

/**
 * Sets `lane_rank:` on every role.
 * @param {string} text roles.yaml
 * @param {Map<string, Record<string, number>>} ranksByRole
 * @param {string[]} laneOrder
 */
export function editRoles(text, ranksByRole, laneOrder) {
  const { eol, lines } = split(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- id: (\S+)\s*$/);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    // The entry is this line plus the indented lines right after it.
    let end = i + 1;
    while (end < lines.length && lines[end].startsWith('  ')) end++;
    const block = lines.slice(i, end).filter((l) => !l.startsWith('  lane_rank:'));
    const ranks = ranksByRole.get(m[1]);
    if (ranks && Object.keys(ranks).length) block.push(`  lane_rank: ${flowLanes(ranks, laneOrder, String)}`);
    out.push(...block);
    i = end - 1;
  }
  return out.join(eol);
}

const COMBOS_HEADER = `# Combined bullets: one bullet that can stand in for one or more bullets of the same role (one means a shorter wording of a single bullet) when a lane's
# resume runs over two pages. Each entry names the bullets it replaces and the lanes it may be used in;
# it is only usable in a lane where every bullet it replaces is also tagged for that lane (the build checks
# this, see src/lib/lane-data.js). Text follows the same copy rules as a bullet.
# This file is written by scripts/import-lanes.mjs from the Combined bullets in the bank.
# Edit them in the bank, not here.
`;

/** The whole combos.yaml. Always ends with a newline; the caller converts line endings if it needs to. */
export function renderCombos(combos, eol = '\n') {
  const body = combos
    .map((c) => [`- id: ${c.id}`, `  role: ${c.role}`, `  replaces: [${c.replaces.join(', ')}]`, `  lanes: [${c.lanes.join(', ')}]`, '  text: >-', ...wrapText(c.text)].join('\n'))
    .join('\n\n');
  return (COMBOS_HEADER + '\n' + (body || '[]') + '\n').replace(/\n/g, eol);
}
