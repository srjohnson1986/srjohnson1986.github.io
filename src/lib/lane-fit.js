// The fit plan for a lane resume: which bullets start on the page, and the order in which to give them up until
// the resume fits on two pages. Plain JavaScript with no Astro imports, so the build, the fit script
// (scripts/fit-lanes.mjs), and the tests (tests/lane-fit.spec.ts) all run the very same code.
//
// The rules, in order (see the lane work in CLAUDE.md):
//   1. Start with every public bullet tagged for the lane. Inside a role: tier 1 first, then tier 2, then
//      tier 3, and by position inside a tier.
//   2. Swap in combined bullets first. One combined bullet replaces the one to three bullets it covers (one means a shorter wording of a single bullet).
//   3. Then cut tier 3, starting with the least relevant role for the lane and working up. Inside a role,
//      cut the lowest position (the largest position number) first.
//   4. Then cut tier 2 the same way.
//   5. Never cut tier 1. A role is also never taken below its floor.
//
// The plan is a list of steps. State k is the starting list with the first k steps applied, and every step
// only removes content, so the fit script can search for the smallest k that fits instead of rendering
// every state. This file does no rendering and has no idea what "fits" means.

import { createHash } from 'node:crypto';

/**
 * @typedef {{ id: string, role: string, public: boolean, text: string, lanes?: Record<string, number[]> }} PlanBullet
 * @typedef {{ id: string, role: string, replaces: string[], lanes: string[], text: string }} PlanCombo
 * @typedef {{ key: string, kind: 'bullet' | 'combo', id: string, role: string, tier: number, pos: number, order: number, text: string, replaces?: string[] }} Item
 * @typedef {{ type: 'swap', combo: string, replaces: string[], item: Item } | { type: 'cut', id: string, role: string, tier: number }} Step
 * @typedef {{ lane: string, initial: Item[], steps: Step[] }} Plan
 */

const norm = (s) => s.replace(/\s+/g, ' ').trim();
// Plain code-point order, so every machine sorts the same way whatever its locale.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {object} input
 * @param {string} input.lane lane id, for example "qa"
 * @param {string[]} input.roleOrder role ids, newest first (the order roles are printed in); used to break rank ties
 * @param {Record<string, Record<string, number>>} input.roleRanks role id -> lane id -> rank (1 is most relevant)
 * @param {PlanBullet[]} input.bullets in a fixed order: it breaks position ties, so the caller must not leave it to chance (the build sorts by id)
 * @param {PlanCombo[]} [input.combos]
 * @param {Record<string, number>} [input.floors] role id -> the fewest items the role keeps
 * @returns {Plan}
 */
export function planLane({ lane, roleOrder, roleRanks, bullets, combos = [], floors = {} }) {
  /** @type {Item[]} */
  const initial = [];
  bullets.forEach((b, order) => {
    const tag = b.lanes?.[lane];
    if (!b.public || !tag) return;
    initial.push({ key: `b:${b.id}`, kind: 'bullet', id: b.id, role: b.role, tier: tag[0], pos: tag[1], order, text: norm(b.text) });
  });
  initial.sort(compareItems);

  const rank = (role) => roleRanks[role]?.[lane] ?? Number.MAX_SAFE_INTEGER;
  // Most relevant first; equal ranks fall back to print order (newest first), so the older role gives up bullets first.
  const rolesMostRelevantFirst = [...new Set(initial.map((i) => i.role))].sort(
    (a, b) => rank(a) - rank(b) || roleOrder.indexOf(a) - roleOrder.indexOf(b) || cmp(a, b),
  );
  const cutRoleOrder = [...rolesMostRelevantFirst].reverse();

  const byId = new Map(initial.map((i) => [i.id, i]));
  const counts = new Map();
  for (const item of initial) counts.set(item.role, (counts.get(item.role) ?? 0) + 1);
  const floorOf = (role) => floors[role] ?? 0;

  /** @type {Step[]} */
  const steps = [];
  /** @type {Item[]} */
  let current = [...initial];

  // ---- 2. combined bullets, biggest saving first
  const usable = combos
    .filter((c) => c.lanes.includes(lane) && c.replaces.every((id) => byId.has(id)))
    .map((c) => ({ combo: c, saving: c.replaces.reduce((s, id) => s + byId.get(id).text.length, 0) - norm(c.text).length }))
    .filter((c) => c.saving > 0) // a combined bullet that is not shorter would not help
    .sort((a, b) => b.saving - a.saving || cmp(a.combo.id, b.combo.id));
  const taken = new Set();
  for (const { combo } of usable) {
    if (combo.replaces.some((id) => taken.has(id))) continue; // one bullet can only be swapped out once
    const replaced = combo.replaces.map((id) => byId.get(id));
    const after = (counts.get(combo.role) ?? 0) - (replaced.length - 1);
    if (after < floorOf(combo.role)) continue;
    const tier = Math.min(...replaced.map((i) => i.tier));
    const pos = Math.min(...replaced.filter((i) => i.tier === tier).map((i) => i.pos));
    const order = Math.min(...replaced.map((i) => i.order));
    const item = { key: `c:${combo.id}`, kind: 'combo', id: combo.id, role: combo.role, tier, pos, order, text: norm(combo.text), replaces: combo.replaces };
    current = current.filter((i) => !combo.replaces.includes(i.id));
    current.push(item);
    counts.set(combo.role, after);
    for (const id of combo.replaces) taken.add(id);
    steps.push({ type: 'swap', combo: combo.id, replaces: [...combo.replaces], item });
  }
  current.sort(compareItems);

  // ---- 3 and 4. cut tier 3, then tier 2, least relevant role first
  for (const tier of [3, 2]) {
    for (const role of cutRoleOrder) {
      const cuttable = current
        .filter((i) => i.role === role && i.tier === tier)
        .sort((a, b) => b.pos - a.pos || b.order - a.order); // lowest position first
      for (const item of cuttable) {
        if ((counts.get(role) ?? 0) - 1 < floorOf(role)) break; // the role is at its floor
        counts.set(role, counts.get(role) - 1);
        steps.push({ type: 'cut', id: item.id, role, tier });
      }
    }
  }

  return { lane, initial, steps };
}

/** Role, then tier, then position, then the bullets' order in the list the caller passed. */
export function compareItems(a, b) {
  return cmp(a.role, b.role) || a.tier - b.tier || a.pos - b.pos || a.order - b.order;
}

/**
 * The list of items after the first k steps (0 is the starting list), sorted by tier then position within each role.
 * @param {Plan} plan
 * @param {number} k
 * @returns {Item[]}
 */
export function applySteps(plan, k) {
  if (!Number.isInteger(k) || k < 0 || k > plan.steps.length) throw new RangeError(`k must be a whole number from 0 to ${plan.steps.length}`);
  let items = [...plan.initial];
  for (const step of plan.steps.slice(0, k)) {
    if (step.type === 'cut') {
      items = items.filter((i) => i.id !== step.id);
    } else {
      items = items.filter((i) => !step.replaces.includes(i.id));
      items.push(step.item);
    }
  }
  return items.sort(compareItems);
}

/**
 * A short fingerprint of everything in the plan that changes what a lane resume looks like, plus whatever else the
 * caller says matters (summary, skills, the print stylesheet). If it changes, the saved fit is out of date.
 * @param {Plan} plan
 * @param {unknown} [extra]
 */
export function fingerprint(plan, extra = null) {
  const data = {
    lane: plan.lane,
    items: plan.initial.map((i) => [i.kind, i.id, i.role, i.tier, i.pos, i.text]),
    steps: plan.steps.map((s) => (s.type === 'swap' ? ['swap', s.combo, s.replaces, s.item.text] : ['cut', s.id])),
    extra,
  };
  return createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 12);
}
