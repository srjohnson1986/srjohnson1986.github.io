import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root, dist } from './helpers/data';
// @ts-expect-error - plain JavaScript module with no type declarations
import { planLane, applySteps } from '../src/lib/lane-fit.js';

// The lane resumes: one generic, auto-fitted resume per job lane, at /resume/print/lane-<id>/ and as a PDF. They are
// not linked from anywhere yet. The expected content is worked out here from the data files and the saved fit
// (lane-fit.yaml); the order of the cuts themselves is covered by lane-fit.spec.ts.

const load = <T>(file: string): T => yaml.load(fs.readFileSync(path.join(root, 'src', 'data', 'resume', file), 'utf8')) as T;

type Lane = { id: string; code: string; label: string; order: number; summary_id: string; org_labels: 'real' | 'neutral'; skills_from: string; role_floor?: Record<string, number> };
type Role = { id: string; org: string; neutral_org?: string; start: number; end: number | 'present'; lane_rank: Record<string, number> };
type Bullet = { id: string; role: string; public: boolean; text: string; lanes?: Record<string, number[]> };
type Combo = { id: string; role: string; replaces: string[]; lanes: string[]; text: string };
type Fit = { id: string; steps: number; fingerprint: string; pages: number };
type SkillGroup = { order: number; group: string; items: (string | { name: string; only?: string[] })[] };
type Item = { id: string; role: string; tier: number; text: string; kind: string; replaces?: string[] };

const lanes = load<Lane[]>('lanes.yaml').sort((a, b) => a.order - b.order);
const roles = load<Role[]>('roles.yaml');
const bullets = load<Bullet[]>('bullets.yaml');
const combos = load<Combo[]>('combos.yaml');
const fits = load<Fit[]>('lane-fit.yaml');
const summaries = load<{ id: string; text: string }[]>('summaries.yaml');
const skillGroups = load<SkillGroup[]>('skills.yaml').sort((a, b) => a.order - b.order);

// Plain code-point order, as the build uses.
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Newest first, written out again here rather than imported from the site.
const end = (r: Role) => (r.end === 'present' ? Infinity : r.end);
const rolesNewestFirst = [...roles].sort((a, c) => end(c) - end(a) || c.start - a.start || a.id.localeCompare(c.id));

function expectedItems(lane: Lane): Item[] {
  const plan = planLane({
    lane: lane.id,
    roleOrder: rolesNewestFirst.map((r) => r.id),
    roleRanks: Object.fromEntries(roles.map((r) => [r.id, r.lane_rank])),
    bullets: [...bullets].sort(byId),
    combos: [...combos].sort(byId),
    floors: lane.role_floor ?? {},
  });
  const fit = fits.find((f) => f.id === lane.id)!;
  return applySteps(plan, fit.steps) as Item[];
}

const expectedSkills = (lane: Lane) =>
  skillGroups
    .map((g) => ({ group: g.group, items: g.items.flatMap((i) => (typeof i === 'string' ? [i] : !i.only || i.only.includes(lane.skills_from) ? [i.name] : [])) }))
    .filter((g) => g.items.length > 0);

const countPages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

test.describe('lane resumes: the saved fit', { tag: ['@req-318'] }, () => {
  test('every lane has a saved fit that is on two pages or fewer', () => {
    expect(fits.map((f) => f.id).sort()).toEqual(lanes.map((l) => l.id).sort());
    for (const fit of fits) {
      expect(fit.fingerprint, fit.id).toMatch(/^[0-9a-f]{12}$/);
      expect(fit.pages, fit.id).toBeLessThanOrEqual(2);
    }
  });
});

for (const lane of lanes) {
  test.describe(`lane resume: ${lane.code}`, { tag: ['@req-318'] }, () => {
    const route = `/resume/print/lane-${lane.id}/`;

    test('the print route shows exactly the fitted bullets, by role newest first, in tier and position order', async ({ page }) => {
      await page.goto(route);
      const items = expectedItems(lane);

      const sections = page.locator('section.role');
      const expectedRoles = rolesNewestFirst.filter((r) => items.some((i) => i.role === r.id));
      await expect(sections).toHaveCount(expectedRoles.length);
      for (const [index, role] of expectedRoles.entries()) {
        const section = sections.nth(index);
        const org = lane.org_labels === 'neutral' && role.neutral_org ? role.neutral_org : role.org;
        await expect(section.locator('h3')).toHaveText(org);
        await expect(section.locator('ul.bullets li')).toHaveText(items.filter((i) => i.role === role.id).map((i) => i.text));
      }
      await expect(page.locator('li[hidden]')).toHaveCount(0);
    });

    test('shows every tier 1 bullet for the lane, on its own or inside a combined bullet', async ({ page }) => {
      await page.goto(route);
      const shown = new Set(expectedItems(lane).flatMap((i) => [i.id, ...(i.replaces ?? [])]));
      const tier1 = bullets.filter((b) => b.public && b.lanes?.[lane.id]?.[0] === 1);
      expect(tier1.length).toBeGreaterThan(0);
      for (const b of tier1) {
        expect(shown.has(b.id), `${b.id} is tier 1 for ${lane.code}`).toBe(true);
      }
      // ...and the page really contains the words: each tier 1 bullet's own text or the combined text that replaced it
      const text = (await page.locator('ul.bullets').allInnerTexts()).join('\n');
      for (const i of expectedItems(lane)) expect(text).toContain(i.text);
    });

    test('keeps the role floors, and shows only bullets tagged for the lane', async ({ page }) => {
      await page.goto(route);
      const items = expectedItems(lane);
      for (const [role, floor] of Object.entries(lane.role_floor ?? {})) {
        const available = bullets.filter((b) => b.public && b.role === role && b.lanes?.[lane.id]).length;
        expect(items.filter((i) => i.role === role).length, role).toBeGreaterThanOrEqual(Math.min(floor, available));
      }
      for (const i of items.filter((x) => x.kind === 'bullet')) {
        expect(bullets.find((b) => b.id === i.id)!.lanes?.[lane.id], i.id).toBeTruthy();
      }
    });

    test('carries the lane summary, its skills, real organization names, and the education list', async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('#resume-summary + p')).toHaveText(summaries.find((s) => s.id === lane.summary_id)!.text);
      const skills = expectedSkills(lane);
      await expect(page.locator('.skill-group dt')).toHaveText(skills.map((g) => g.group));
      await expect(page.locator('.skill-group dd')).toHaveText(skills.map((g) => g.items.join(', ')));
      await expect(page.locator('.education li')).not.toHaveCount(0);
      expect(lane.org_labels).toBe('real');
      await expect(page.locator('section.role h3').filter({ hasText: /Independent Recording Studio|Community Music Events|^Personal Project$/ })).toHaveCount(0);
    });

    test('has a PDF of two pages or fewer, printed from this lane', async () => {
      const file = path.join(dist, 'resume', `steve-johnson-resume-lane-${lane.id}.pdf`);
      const pdf = fs.readFileSync(file);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const pages = countPages(pdf);
      expect(pages).toBeGreaterThanOrEqual(1);
      expect(pages).toBeLessThanOrEqual(2);
      expect(pdf.toString('latin1')).toContain(lane.label);
    });

    test('with print media on, the content ends before the end of page 2', async ({ page }) => {
      await page.setViewportSize({ width: 701, height: 960 });
      await page.goto(route);
      await page.emulateMedia({ media: 'print' });
      const height = await page.locator('.resume').evaluate((el) => el.scrollHeight);
      expect(height).toBeLessThanOrEqual(2 * 960);
    });

    test('is kept out of search and not linked from anywhere', async ({ page, request }) => {
      await page.goto(route);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      const sitemap = await (await request.get('/sitemap-0.xml')).text();
      expect(sitemap).not.toContain(`lane-${lane.id}`);
      await page.goto('/resume/qa/');
      await expect(page.locator(`a[href*="lane-${lane.id}"]`)).toHaveCount(0);
    });
  });
}

test('the fit pages used to measure lanes are not part of the site', { tag: ['@req-318'] }, async ({ request }) => {
  for (const lane of lanes) {
    const response = await request.get(`/resume/lane-fit/${lane.id}/`, { failOnStatusCode: false });
    expect(response.status(), lane.id).toBe(404);
  }
});
