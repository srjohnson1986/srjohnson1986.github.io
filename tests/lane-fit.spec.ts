import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { planLane, applySteps, fingerprint } from '../src/lib/lane-fit.js';

// src/lib/lane-fit.js decides which bullets a lane resume starts with and the order they are given up in to
// fit two pages. It does no rendering, so these specs run it on small made-up data (one rule at a time) and
// on the real data for all six lanes. They read only files, so they need no browser and no build.

type Bullet = { id: string; role: string; public: boolean; text: string; lanes?: Record<string, number[]> };
type Combo = { id: string; role: string; replaces: string[]; lanes: string[]; text: string };
type Item = { id: string; kind: string; role: string; tier: number; pos: number; replaces?: string[]; text: string };
type Step = { type: 'swap' | 'cut'; id?: string; combo?: string; role?: string; tier?: number };
type Plan = { lane: string; initial: Item[]; steps: Step[] };
type Input = { lane: string; roleOrder: string[]; roleRanks: Record<string, Record<string, number>>; bullets: Bullet[]; combos?: Combo[]; floors?: Record<string, number> };

const plan = (input: Input) => planLane(input) as Plan;
const apply = (p: Plan, k: number) => applySteps(p, k) as Item[];
const ids = (items: Item[]) => items.map((i) => i.id);
const cutIds = (p: Plan) => p.steps.filter((s) => s.type === 'cut').map((s) => s.id);

// A bullet with a short generated text. `tag` is [tier, position] for lane "qa".
const b = (id: string, role: string, tag: number[] | null, extra: Partial<Bullet> = {}): Bullet => ({
  id,
  role,
  public: true,
  text: `Did the thing called ${id} for a while.`,
  lanes: tag ? { qa: tag } : undefined,
  ...extra,
});

// Three roles, newest first. For QA the relevance ranks are r1 = 1 (best), r3 = 2, r2 = 3 (least relevant).
const base = (bullets: Bullet[], more: Partial<Input> = {}): Input => ({
  lane: 'qa',
  roleOrder: ['r1', 'r2', 'r3'],
  roleRanks: { r1: { qa: 1 }, r2: { qa: 3 }, r3: { qa: 2 } },
  bullets,
  ...more,
});

const spread: Bullet[] = [
  b('r1-t3-a', 'r1', [3, 10]),
  b('r1-t1-b', 'r1', [1, 20]),
  b('r1-t2-a', 'r1', [2, 10]),
  b('r1-t1-a', 'r1', [1, 10]),
  b('r1-t3-b', 'r1', [3, 20]),
  b('r2-t1-a', 'r2', [1, 10]),
  b('r2-t2-a', 'r2', [2, 10]),
  b('r2-t3-a', 'r2', [3, 10]),
  b('r2-t3-b', 'r2', [3, 20]),
  b('r3-t1-a', 'r3', [1, 10]),
  b('r3-t3-a', 'r3', [3, 10]),
  b('r3-t2-a', 'r3', [2, 10]),
];

test.describe('lane fit plan: the starting list', () => {
  test('keeps public bullets tagged for the lane, tier first and then position, inside each role', () => {
    const p = plan(base(spread));
    expect(ids(p.initial.filter((i) => i.role === 'r1'))).toEqual(['r1-t1-a', 'r1-t1-b', 'r1-t2-a', 'r1-t3-a', 'r1-t3-b']);
    expect(p.initial).toHaveLength(spread.length);
  });

  test('leaves out bullets that are not public, not tagged for the lane, or tagged only for another lane', () => {
    const p = plan(
      base([
        b('keep', 'r1', [1, 10]),
        b('hidden', 'r1', [1, 20], { public: false }),
        b('untagged', 'r1', null),
        { ...b('other-lane', 'r1', null), lanes: { sdet: [1, 10] } },
      ]),
    );
    expect(ids(p.initial)).toEqual(['keep']);
  });

  test('breaks position ties by the order the bullets are written in the file', () => {
    const p = plan(base([b('second', 'r1', [2, 10]), b('first-in-file-wins', 'r1', [2, 10]), b('top', 'r1', [1, 99])].reverse()));
    expect(ids(p.initial)).toEqual(['top', 'first-in-file-wins', 'second']);
  });
});

test.describe('lane fit plan: the cut order', () => {
  test('cuts tier 3 before tier 2, least relevant role first, and the lowest position first inside a role', () => {
    const p = plan(base(spread));
    expect(cutIds(p)).toEqual([
      // tier 3: r2 (rank 3), then r3 (rank 2), then r1 (rank 1); the highest position number goes first
      'r2-t3-b', 'r2-t3-a', 'r3-t3-a', 'r1-t3-b', 'r1-t3-a',
      // tier 2, in the same role order
      'r2-t2-a', 'r3-t2-a', 'r1-t2-a',
    ]);
  });

  test('never cuts tier 1: with no floors only the tier 1 bullets are left', () => {
    const p = plan(base(spread));
    expect(p.steps.every((s) => s.type === 'cut' && s.tier !== 1)).toBe(true);
    expect(ids(apply(p, p.steps.length)).sort()).toEqual(['r1-t1-a', 'r1-t1-b', 'r2-t1-a', 'r3-t1-a']);
  });

  test('equal ranks fall back to print order, so the older role gives up bullets first', () => {
    const p = plan(base(spread, { roleRanks: { r1: { qa: 1 }, r2: { qa: 2 }, r3: { qa: 2 } } }));
    // r2 is newer than r3 in roleOrder, so r3 is older and goes first
    expect(cutIds(p).slice(0, 3)).toEqual(['r3-t3-a', 'r2-t3-b', 'r2-t3-a']);
  });

  test('a role with no rank for the lane is treated as the least relevant', () => {
    const p = plan(base(spread, { roleRanks: { r1: { qa: 1 }, r3: { qa: 2 } } }));
    expect(cutIds(p).slice(0, 2)).toEqual(['r2-t3-b', 'r2-t3-a']);
  });

  test('a role floor stops the cuts in that role and the rest carry on', () => {
    const p = plan(base(spread, { floors: { r2: 3 } }));
    // r2 has 4 bullets and a floor of 3, so only one can go
    expect(cutIds(p).filter((id) => id!.startsWith('r2'))).toEqual(['r2-t3-b']);
    expect(ids(apply(p, p.steps.length)).filter((id) => id.startsWith('r2'))).toHaveLength(3);
    expect(cutIds(p)).toContain('r3-t3-a');
    expect(cutIds(p)).toContain('r1-t2-a');
  });

  test('a floor larger than the tier 1 count keeps lower tiers too, and tier 1 still never goes', () => {
    const p = plan(base(spread, { floors: { r1: 4 } }));
    expect(ids(apply(p, p.steps.length)).filter((id) => id.startsWith('r1'))).toHaveLength(4);
    expect(ids(apply(p, p.steps.length))).toEqual(expect.arrayContaining(['r1-t1-a', 'r1-t1-b']));
  });

  test('the same input always gives the same plan', () => {
    expect(plan(base(spread))).toEqual(plan(base(spread)));
  });
});

test.describe('lane fit plan: combined bullets', () => {
  const longOnes = [
    b('p1', 'r1', [2, 10], { text: 'Wrote a long first sentence about the plans that goes on for quite some time.' }),
    b('p2', 'r1', [3, 10], { text: 'Wrote a long second sentence about the risks that also goes on for a while.' }),
    b('p3', 'r1', [3, 20], { text: 'Wrote a long third sentence about the exit rules and how they were agreed.' }),
    b('q1', 'r2', [3, 10], { text: 'Ran a first check with a long description of what was checked and why.' }),
    b('q2', 'r2', [3, 20], { text: 'Ran a second check with a long description of what was checked and why.' }),
    b('keep', 'r2', [1, 10]),
  ];
  const short = (id: string, role: string, replaces: string[], extra: Partial<Combo> = {}): Combo => ({ id, role, replaces, lanes: ['qa'], text: 'Wrote the plans and risks.', ...extra });

  test('swaps come first, and the combined bullet takes the best tier and position of the bullets it replaces', () => {
    const p = plan(base(longOnes, { combos: [short('combo-p', 'r1', ['p1', 'p2', 'p3'])] }));
    expect(p.steps[0]).toMatchObject({ type: 'swap', combo: 'combo-p', replaces: ['p1', 'p2', 'p3'] });
    const after = apply(p, 1);
    expect(ids(after.filter((i) => i.role === 'r1'))).toEqual(['combo-p']);
    expect(after.find((i) => i.id === 'combo-p')).toMatchObject({ kind: 'combo', tier: 2, pos: 10 });
    // every later step is a cut: no swap comes after a cut
    const firstCut = p.steps.findIndex((s) => s.type === 'cut');
    expect(p.steps.slice(firstCut).every((s) => s.type === 'cut')).toBe(true);
  });

  test('the biggest saving is swapped first', () => {
    const p = plan(
      base(longOnes, {
        combos: [short('small-saving', 'r2', ['q1', 'q2'], { text: 'Ran both checks, each with a long description of what was checked and why.' }), short('big-saving', 'r1', ['p1', 'p2', 'p3'])],
      }),
    );
    expect(p.steps.filter((s) => s.type === 'swap').map((s) => s.combo)).toEqual(['big-saving', 'small-saving']);
  });

  test('a combined bullet takes the best tier of its parts when it is cut, and one with a tier 1 part is never cut', () => {
    const p = plan(base(longOnes, { combos: [short('combo-q', 'r2', ['q1', 'q2']), short('combo-mixed', 'r1', ['p1', 'p2'])] }));
    expect(p.steps.find((s) => s.id === 'combo-q')).toMatchObject({ type: 'cut', tier: 3 }); // two tier 3 parts
    expect(p.steps.find((s) => s.id === 'combo-mixed')).toMatchObject({ type: 'cut', tier: 2 }); // tier 2 and tier 3 parts
    const withTier1 = plan(base([...longOnes, b('t1', 'r1', [1, 5], { text: longOnes[0].text })], { combos: [short('combo-t1', 'r1', ['t1', 'p2'])] }));
    expect(cutIds(withTier1)).not.toContain('combo-t1');
    expect(ids(apply(withTier1, withTier1.steps.length))).toContain('combo-t1');
  });

  test('ignores a combined bullet that is not for the lane, replaces a bullet the lane does not use, or is not shorter', () => {
    const p = plan(
      base(longOnes, {
        combos: [
          short('other-lane', 'r1', ['p1', 'p2'], { lanes: ['sdet'] }),
          short('missing-part', 'r1', ['p1', 'not-in-lane']),
          short('not-shorter', 'r1', ['p2', 'p3'], { text: longOnes[1].text + ' ' + longOnes[2].text + ' and more words to be longer than both.' }),
        ],
      }),
    );
    expect(p.steps.filter((s) => s.type === 'swap')).toEqual([]);
  });

  test('a bullet is only swapped out once, and a swap that would take a role below its floor is skipped', () => {
    const overlap = plan(base(longOnes, { combos: [short('first', 'r1', ['p1', 'p2', 'p3']), short('second', 'r1', ['p2', 'p3'], { text: 'Wrote.' })] }));
    expect(overlap.steps.filter((s) => s.type === 'swap')).toHaveLength(1);
    const floor = plan(base(longOnes, { combos: [short('combo-p', 'r1', ['p1', 'p2', 'p3'])], floors: { r1: 2 } }));
    expect(floor.steps.filter((s) => s.type === 'swap')).toEqual([]);
  });
});

test.describe('lane fit plan: states and the fingerprint', () => {
  test('state 0 is the starting list, each state only removes content, and the last k is checked', () => {
    const p = plan(base(spread));
    expect(ids(apply(p, 0))).toEqual(ids(p.initial));
    let size = Infinity;
    for (let k = 0; k <= p.steps.length; k++) {
      const chars = apply(p, k).reduce((s, i) => s + i.text.length, 0);
      expect(chars).toBeLessThanOrEqual(size);
      size = chars;
    }
    expect(() => apply(p, -1)).toThrow(RangeError);
    expect(() => apply(p, p.steps.length + 1)).toThrow(RangeError);
    expect(() => apply(p, 1.5)).toThrow(RangeError);
  });

  test('the fingerprint is stable, and changes with wording, order, tags, and the extra detail', () => {
    const p = plan(base(spread));
    const same = fingerprint(p, { summary: 'x' });
    expect(fingerprint(plan(base(spread)), { summary: 'x' })).toBe(same);
    expect(fingerprint(p, { summary: 'y' })).not.toBe(same);
    const reworded = spread.map((s) => (s.id === 'r1-t1-a' ? { ...s, text: s.text + ' More words.' } : s));
    expect(fingerprint(plan(base(reworded)), { summary: 'x' })).not.toBe(same);
    const retagged = spread.map((s) => (s.id === 'r2-t3-a' ? { ...s, lanes: { qa: [3, 30] } } : s));
    expect(fingerprint(plan(base(retagged)), { summary: 'x' })).not.toBe(same);
    const reranked = base(spread, { roleRanks: { r1: { qa: 3 }, r2: { qa: 1 }, r3: { qa: 2 } } });
    expect(fingerprint(plan(reranked), { summary: 'x' })).not.toBe(same);
  });
});

// ---------------------------------------------------------------- the real data
const load = <T>(file: string): T => yaml.load(fs.readFileSync(path.join(root, 'src', 'data', 'resume', file), 'utf8')) as T;

test.describe('lane fit plan: the real data', () => {
  const lanes = load<{ id: string; code: string }[]>('lanes.yaml');
  const roles = load<{ id: string; start: number; end: number | 'present'; lane_rank: Record<string, number> }[]>('roles.yaml');
  const bullets = load<Bullet[]>('bullets.yaml');
  const combos = load<Combo[]>('combos.yaml');
  // Newest first, written out again here rather than imported from the site.
  const end = (r: { end: number | 'present' }) => (r.end === 'present' ? Infinity : r.end);
  const roleOrder = [...roles].sort((a, c) => end(c) - end(a) || c.start - a.start || a.id.localeCompare(c.id)).map((r) => r.id);
  const roleRanks = Object.fromEntries(roles.map((r) => [r.id, r.lane_rank]));
  const floors = { tpd: 2, verizon: 2 };

  for (const lane of lanes) {
    test(`${lane.code}: the plan keeps every tier 1 bullet in every state and respects the floors`, () => {
      const p = plan({ lane: lane.id, roleOrder, roleRanks, bullets, combos, floors });
      const tier1 = bullets.filter((x) => x.public && x.lanes?.[lane.id]?.[0] === 1).map((x) => x.id);
      expect(tier1.length).toBeGreaterThan(0);
      expect(ids(p.initial.filter((i) => i.tier === 1)).sort()).toEqual([...tier1].sort());
      for (const k of [0, Math.floor(p.steps.length / 2), p.steps.length]) {
        const state = apply(p, k);
        const stateIds = new Set(state.flatMap((i) => [i.id, ...(i.replaces ?? [])]));
        for (const id of tier1) expect(stateIds.has(id), `${id} at step ${k}`).toBe(true);
        for (const [role, floor] of Object.entries(floors)) {
          const had = p.initial.filter((i) => i.role === role).length;
          expect(state.filter((i) => i.role === role).length).toBeGreaterThanOrEqual(Math.min(floor, had));
        }
      }
      // only combined bullets that are for this lane are ever swapped in
      for (const s of p.steps.filter((x) => x.type === 'swap')) {
        expect(combos.find((c) => c.id === s.combo)!.lanes).toContain(lane.id);
      }
    });
  }

  test('every lane has something to cut', () => {
    for (const lane of lanes) {
      expect(plan({ lane: lane.id, roleOrder, roleRanks, bullets, combos, floors }).steps.length, lane.code).toBeGreaterThan(0);
    }
  });
});
