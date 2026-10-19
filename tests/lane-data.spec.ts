import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { checkLaneData } from '../src/lib/lane-data.js';

// The lane data (lanes.yaml, the `lanes` field on bullets, `lane_rank` on roles, combos.yaml) is checked by
// src/lib/lane-data.js, the same code the build runs. These specs run it on the real data files and on one
// broken case per rule. They read only files, so they need no browser and no build.

type LaneData = {
  lanes: { id: string; code: string }[];
  roles: { id: string; lane_rank?: Record<string, number> }[];
  bullets: { id: string; role: string; public: boolean; lanes?: Record<string, number[]> }[];
  combos: { id: string; role: string; replaces: string[]; lanes: string[] }[];
};

const check = (data: LaneData) => checkLaneData(data) as string[];
const load = (file: string) => yaml.load(fs.readFileSync(path.join(root, 'src', 'data', 'resume', file), 'utf8')) as never;

// A small sound data set to break one rule at a time.
const sound = (): LaneData => ({
  lanes: [
    { id: 'qa', code: 'QA' },
    { id: 'sdet', code: 'SDET' },
  ],
  roles: [
    { id: 'a', lane_rank: { qa: 1, sdet: 2 } },
    { id: 'b', lane_rank: { qa: 2, sdet: 1 } },
  ],
  bullets: [
    { id: 'a1', role: 'a', public: true, lanes: { qa: [1, 10], sdet: [2, 10] } },
    { id: 'a2', role: 'a', public: true, lanes: { qa: [2, 10], sdet: [3, 10] } },
    { id: 'a3', role: 'a', public: true, lanes: { qa: [3, 10] } },
    { id: 'b1', role: 'b', public: true, lanes: { qa: [1, 10] } },
  ],
  combos: [{ id: 'a-combo', role: 'a', replaces: ['a1', 'a2'], lanes: ['qa', 'sdet'] }],
});

test.describe('lane data checks', { tag: ['@req-320'] }, () => {
  test('the real data files pass', () => {
    const data: LaneData = {
      lanes: load('lanes.yaml'),
      roles: load('roles.yaml'),
      bullets: load('bullets.yaml'),
      combos: load('combos.yaml'),
    };
    expect(data.lanes.length).toBeGreaterThan(0);
    expect(check(data)).toEqual([]);
  });

  test('accepts a sound set, and accepts data with no lane tags and no ranks at all', () => {
    expect(check(sound())).toEqual([]);
    const bare = sound();
    bare.roles = bare.roles.map((r) => ({ id: r.id }));
    bare.bullets = bare.bullets.map((b) => ({ id: b.id, role: b.role, public: b.public }));
    bare.combos = [];
    expect(check(bare)).toEqual([]);
  });

  test('accepts a combo that replaces a single bullet (a shorter wording of it)', () => {
    const one = sound();
    one.combos[0].replaces = ['a1'];
    expect(check(one)).toEqual([]);
  });

  const broken: [string, (d: LaneData) => void, RegExp][] = [
    ['a lane id listed twice', (d) => d.lanes.push({ id: 'qa', code: 'QAX' }), /lane id "qa" twice/],
    ['a lane code listed twice', (d) => d.lanes.push({ id: 'other', code: 'QA' }), /lane code "QA" twice/],
    ['a lane floor for a role that does not exist', (d) => ((d.lanes[0] as { role_floor?: Record<string, number> }).role_floor = { zzz: 2 }), /lane "qa" sets a role_floor for "zzz"/],
    ['a bullet tagged for an unknown lane', (d) => (d.bullets[0].lanes!.nope = [1, 1]), /"a1" is tagged for lane "nope"/],
    ['a role ranking an unknown lane', (d) => (d.roles[0].lane_rank!.nope = 1), /role "a" ranks lane "nope"/],
    ['a role missing a rank once others have ranks', (d) => delete d.roles[1].lane_rank!.sdet, /role "b" has no lane_rank for "sdet"/],
    ['a role with no ranks at all once others have ranks', (d) => delete d.roles[1].lane_rank, /role "b" has no lane_rank for "qa"/],
    ['a combo that replaces a bullet that does not exist', (d) => d.combos[0].replaces.push('ghost'), /replaces "ghost".*not in bullets.yaml/],
    ['a combo that replaces no bullets', (d) => (d.combos[0].replaces = []), /replaces no bullets/],
    ['a combo that lists a bullet twice', (d) => (d.combos[0].replaces = ['a1', 'a1']), /replaced bullet twice/],
    ['a combo that mixes roles', (d) => (d.combos[0].replaces = ['a1', 'b1']), /role "a" but replaces "b1" from role "b"/],
    ['a combo that replaces a bullet that is not public', (d) => (d.bullets[1].public = false), /"a2", which is not public/],
    ['a combo used in a lane where a replaced bullet is not tagged', (d) => delete d.bullets[1].lanes!.sdet, /lane "sdet".*"a2", is not tagged/],
    ['a combo with an unknown lane', (d) => d.combos[0].lanes.push('nope'), /lists lane "nope"/],
    ['a combo with no lanes', (d) => (d.combos[0].lanes = []), /lists no lanes/],
    ['a combo with an unknown role', (d) => (d.combos[0].role = 'zzz'), /role "zzz".*not in roles.yaml/],
    ['a combo with the same id as a bullet', (d) => (d.combos[0].id = 'a3'), /same id as a bullet/],
    ['a combo listed twice', (d) => d.combos.push({ ...d.combos[0], replaces: ['a1', 'a3'] }), /"a-combo" is listed twice/],
    [
      'two combos replacing the same bullet in one lane',
      (d) => d.combos.push({ id: 'a-combo-2', role: 'a', replaces: ['a2', 'a3'], lanes: ['qa'] }),
      /"a2" is replaced by two combos in lane "qa"/,
    ],
  ];
  for (const [name, breakIt, message] of broken) {
    test(`rejects ${name}`, () => {
      const data = sound();
      breakIt(data);
      expect(check(data).join('\n')).toMatch(message);
    });
  }
});
