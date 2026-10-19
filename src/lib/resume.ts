import { getCollection, type CollectionEntry } from 'astro:content';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { checkLaneData } from './lane-data.js';
import { planLane, applySteps, fingerprint, compareItems } from './lane-fit.js';

type Role = CollectionEntry<'roles'>;
type Bullet = CollectionEntry<'bullets'>;

export interface ResumeSection {
  roleId: string;
  /** Employer or project name, already switched to the neutral label when the variant asks for it. */
  org: string;
  title: string;
  note?: string;
  positions?: { title: string; dates: string; note?: string }[];
  dates: string;
  bullets: { id: string; text: string; theme: string; tags: string[]; /** lane pages only: the id used to find the item */ key?: string; /** lane fit page only: a candidate that is not on the page in the starting state */ hidden?: boolean }[];
}

export interface ResumeSkillGroup {
  group: string;
  items: string[];
}

export interface ResumeEducation {
  title: string;
  detail?: string;
  dates: string;
}

export interface ResumeVariant {
  id: string;
  label: string;
  summary: string;
  orgLabels: 'neutral' | 'real';
  skills: ResumeSkillGroup[];
  sections: ResumeSection[];
  education: ResumeEducation[];
}

export function formatRange(start: number, end: number | 'present'): string {
  if (end === 'present') return `${start}-Present`;
  return start === end ? `${start}` : `${start}-${end}`;
}

const firstWord = (text: string) => text.match(/^[A-Za-z]+/)?.[0] ?? text;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pages are built one at a time, so remember what was already reported to warn once per message.
const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
};

type Skill = CollectionEntry<'skills'>;
type Education = CollectionEntry<'education'>;

// Ongoing roles first, then by end year, then start year, then id. Astro does not
// guarantee collection order, so every tie is broken explicitly to keep builds stable.
function sortRolesNewestFirst(roleEntries: Role[]): Role[] {
  const endKey = (r: Role) => (r.data.end === 'present' ? Infinity : r.data.end);
  return [...roleEntries].sort((a, b) => endKey(b) - endKey(a) || b.data.start - a.data.start || a.id.localeCompare(b.id));
}

function buildEducation(educationEntries: Education[]): ResumeEducation[] {
  return [...educationEntries]
    .sort((a, b) => a.data.order - b.data.order)
    .map(({ data }) =>
      'degree' in data
        ? { title: data.degree, detail: data.school, dates: `${data.year}` }
        : {
            title: data.level ? `${data.certification} (${data.level})` : data.certification,
            dates: formatRange(data.since, 'present'),
          },
    );
}

/** One role's block on a resume: employer, dates, positions, and the bullets already chosen for it. */
function makeSection(role: Role, bullets: ResumeSection['bullets'], labelMode: 'neutral' | 'real'): ResumeSection {
  const useNeutral = labelMode === 'neutral' && role.data.neutral_org;
  return {
    roleId: role.id,
    org: useNeutral ? role.data.neutral_org! : role.data.org,
    title: role.data.title,
    note: role.data.note,
    positions: role.data.positions?.map((p) => ({ title: p.title, dates: formatRange(p.start, p.end), note: p.note })),
    dates: formatRange(role.data.start, role.data.end),
    bullets,
  };
}

/** Core Skills as shown on one resume version: drop items limited to other versions, then drop empty groups. */
function skillsFor(skillGroupsInOrder: Skill[], variantId: string): ResumeSkillGroup[] {
  return skillGroupsInOrder
    .map(({ data }) => ({
      group: data.group,
      items: data.items.flatMap((item) => {
        if (typeof item === 'string') return [item];
        if (item.lane_only) return [];
        return !item.only || item.only.some((v) => v.id === variantId) ? [item.name] : [];
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Core Skills as shown on one lane resume: the names the lane lists, group by group, in the lane's order.
 * Each name must exist in that group in skills.yaml, so a skill is spelled in one place and the
 * training-only rule still covers it.
 */
function laneSkills(skillGroupsInOrder: Skill[], laneId: string, wanted: Record<string, string[]>): ResumeSkillGroup[] {
  const groupIds = new Set(skillGroupsInOrder.map((g) => g.id));
  for (const id of Object.keys(wanted)) {
    if (!groupIds.has(id)) throw new Error(`Lane "${laneId}" lists skills for the group "${id}", which is not in skills.yaml`);
  }
  return skillGroupsInOrder.flatMap(({ id, data }) => {
    const names = wanted[id];
    if (!names) return [];
    const known = new Set(data.items.map((item) => (typeof item === 'string' ? item : item.name)));
    for (const name of names) {
      if (!known.has(name)) throw new Error(`Lane "${laneId}" lists the skill "${name}", which is not in the "${data.group}" group in skills.yaml`);
    }
    if (new Set(names).size !== names.length) throw new Error(`Lane "${laneId}" lists a skill twice in "${data.group}"`);
    return [{ group: data.group, items: names }];
  });
}

/**
 * Builds every resume variant from the content collections and enforces the rules that a
 * single-collection schema cannot. Any violation throws, which fails `astro build`.
 *
 * Checked by the schemas in src/content.config.ts: field shapes, copy rules (single hyphens,
 * no phone numbers, past-tense verbs) and that every referenced id exists.
 * Checked here: every bullet used by a variant is `public: true`, and no public bullet mentions a
 * `training_only` skill. Two bullets in one variant that start with the same verb only produce a
 * warning: varied verbs are the goal, but the owner does not want uniqueness forced.
 */
export async function getResumeVariants(options: { labels?: 'real' } = {}): Promise<ResumeVariant[]> {
  const [roleEntries, bulletEntries, summaryEntries, variantEntries, skillEntries, educationEntries, laneEntries, comboEntries] =
    await Promise.all([
      getCollection('roles'),
      getCollection('bullets'),
      getCollection('summaries'),
      getCollection('variants'),
      getCollection('skills'),
      getCollection('education'),
      getCollection('lanes'),
      getCollection('combos'),
    ]);

  const bulletsById = new Map<string, Bullet>(bulletEntries.map((b) => [b.id, b]));
  // Astro warns when it loads an empty collection, and no version may share a group (bullet-groups.yaml can be empty),
  // so groups are only loaded when a version includes one.
  const groupEntries = variantEntries.some((v) => v.data.include?.length) ? await getCollection('bulletGroups') : [];
  const groupsById = new Map(groupEntries.map((g) => [g.id, g]));
  const summariesById = new Map(summaryEntries.map((s) => [s.id, s]));

  // Astro only logs a bad reference() and carries on, so the build would still pass and the
  // affected bullet or skill would silently vanish. Check them here so the build fails instead.
  const roleIds = new Set(roleEntries.map((r) => r.id));
  const variantIds = new Set(variantEntries.map((v) => v.id));
  const dangling: string[] = [];
  for (const bullet of bulletEntries) {
    if (!roleIds.has(bullet.data.role.id)) {
      dangling.push(`bullet "${bullet.id}" uses role "${bullet.data.role.id}", which is not in roles.yaml`);
    }
  }
  for (const group of skillEntries) {
    for (const item of group.data.items) {
      if (typeof item === 'string') continue;
      for (const only of item.only ?? []) {
        if (!variantIds.has(only.id)) {
          dangling.push(`skill "${item.name}" is limited to variant "${only.id}", which is not in variants.yaml`);
        }
      }
    }
  }
  if (dangling.length) throw new Error(`Broken references in the resume data:\n  - ${dangling.join('\n  - ')}`);

  // The per-lane data (lanes, lane ranks, and combined bullets). The checks live in src/lib/lane-data.js so the
  // tests run the same code.
  const laneProblems = checkLaneData({
    lanes: laneEntries.map((l) => ({ id: l.id, code: l.data.code })),
    roles: roleEntries.map((r) => ({ id: r.id, lane_rank: r.data.lane_rank })),
    bullets: bulletEntries.map((b) => ({ id: b.id, role: b.data.role.id, public: b.data.public, lanes: b.data.lanes })),
    combos: comboEntries.map((c) => ({ id: c.id, role: c.data.role.id, replaces: c.data.replaces.map((r) => r.id), lanes: c.data.lanes })),
  });
  if (laneProblems.length) throw new Error(`Problems in the lane data:\n  - ${laneProblems.join('\n  - ')}`);

  // Skills flagged training_only in skills.yaml stay in the list, but a public bullet may not
  // name them, so a mention fails the build.
  const trainingOnly = skillEntries
    .flatMap((g) => g.data.items)
    .flatMap((item) => (typeof item === 'object' && item.training_only ? [item.name] : []));
  const claims: string[] = [];
  for (const bullet of bulletEntries) {
    if (!bullet.data.public) continue;
    for (const skill of trainingOnly) {
      if (new RegExp(`\\b${escapeRegExp(skill)}\\b`, 'i').test(bullet.data.text)) {
        claims.push(`bullet "${bullet.id}" mentions ${skill}, which is marked training_only in skills.yaml`);
      }
    }
  }
  for (const combo of comboEntries) {
    for (const skill of trainingOnly) {
      if (new RegExp(`\\b${escapeRegExp(skill)}\\b`, 'i').test(combo.data.text)) {
        claims.push(`combined bullet "${combo.id}" mentions ${skill}, which is marked training_only in skills.yaml`);
      }
    }
  }
  if (claims.length) {
    throw new Error(
      `Training-only skills may not appear in public bullets:\n  - ${claims.join('\n  - ')}\n` +
        'Remove the mention, or drop training_only once a public project backs the skill.',
    );
  }

  const skillGroupsInOrder = [...skillEntries].sort((a, b) => a.data.order - b.data.order);
  const education = buildEducation(educationEntries);

  const rolesNewestFirst = sortRolesNewestFirst(roleEntries);
  const variantsInOrder = [...variantEntries].sort((a, b) => a.data.order - b.data.order);

  return variantsInOrder.map((variant): ResumeVariant => {
    const problems: string[] = [];

    // The variant's bullet ids: each included group in order, then the variant's own list.
    const listed: string[] = [];
    for (const ref of variant.data.include ?? []) {
      const group = groupsById.get(ref.id);
      if (!group) problems.push(`bullet group "${ref.id}" does not exist`);
      else listed.push(...group.data.bullets.map((b) => b.id));
    }
    listed.push(...(variant.data.bullets ?? []).map((b) => b.id));

    const seen = new Set<string>();
    const chosen: Bullet[] = [];
    for (const id of listed) {
      if (seen.has(id)) {
        problems.push(`bullet "${id}" is listed twice (check the groups this variant includes)`);
        continue;
      }
      seen.add(id);
      const bullet = bulletsById.get(id);
      if (!bullet) problems.push(`bullet "${id}" does not exist`);
      else if (!bullet.data.public) problems.push(`bullet "${id}" is not public: true`);
      else chosen.push(bullet);
    }

    const byVerb = new Map<string, string[]>();
    for (const b of chosen) {
      const verb = firstWord(b.data.text).toLowerCase();
      byVerb.set(verb, [...(byVerb.get(verb) ?? []), b.id]);
    }
    for (const [verb, ids] of byVerb) {
      if (ids.length > 1) warnOnce(`Resume variant "${variant.id}": "${verb}" starts more than one bullet (${ids.join(', ')}). Consider varying the verbs.`);
    }

    const summary = summariesById.get(variant.data.summary_id.id);
    if (!summary) problems.push(`summary "${variant.data.summary_id.id}" does not exist`);

    if (problems.length) {
      throw new Error(`Resume variant "${variant.id}" is invalid:\n  - ${problems.join('\n  - ')}`);
    }

    // The public web pages always pass { labels: 'real' } (real names on the site itself).
    // PDFs and print routes omit it, so each variant's own org_labels setting applies.
    const labelMode = options.labels ?? variant.data.org_labels;

    const sections: ResumeSection[] = [];
    for (const role of rolesNewestFirst) {
      const roleBullets = chosen.filter((b) => b.data.role.id === role.id);
      if (!roleBullets.length) continue;
      sections.push(
        makeSection(
          role,
          roleBullets.map((b) => ({ id: b.id, text: b.data.text, theme: b.data.theme, tags: b.data.tags })),
          labelMode,
        ),
      );
    }

    // Core Skills for this version: drop items limited to other versions, then drop empty groups.
    const skills = skillsFor(skillGroupsInOrder, variant.id);

    return {
      id: variant.id,
      label: variant.data.label,
      summary: summary!.data.text,
      orgLabels: labelMode,
      skills,
      sections,
      education,
    };
  });
}

// ---------------------------------------------------------------------------
// Lane resumes: one generic resume per job lane, trimmed to two pages
// ---------------------------------------------------------------------------

type Item = import('./lane-fit.js').Item;
type Plan = import('./lane-fit.js').Plan;

export interface LaneResume extends ResumeVariant {
  laneId: string;
  /** Hash of everything that decides this lane's layout. The saved fit (lane-fit.yaml) must carry the same one. */
  fingerprint: string;
  /** Only on the fit page: the plan scripts/fit-lanes.mjs searches for the smallest number of steps that fits. */
  plan?: Plan;
}

// The print stylesheet decides where lines and pages break, so changing it means the fit has to be measured again.
// Line endings are normalized first: a Windows checkout has CRLF and the CI runner has LF, and they must give the same hash.
const printCssHash = () =>
  createHash('sha1')
    .update(fs.readFileSync('src/styles/print.css', 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 12);

// Plain code-point order, so every machine sorts ids the same way whatever its locale.
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Builds the lane resumes from lanes.yaml, the lane tags on bullets, the combined bullets, and each lane's saved
 * fit (lane-fit.yaml). Throws if a lane's saved fit is missing or no longer matches the data: run
 * `npm run fit-lanes` to measure it again.
 *
 * With { candidates: true } it instead returns every candidate item for each lane, with the combined bullets
 * hidden, plus the plan. That is the page scripts/fit-lanes.mjs measures; it is never part of the published site.
 */
export async function getLaneResumes(options: { candidates?: boolean } = {}): Promise<LaneResume[]> {
  // The variants run every check on the shared resume data first (public bullets, training-only skills, lane data).
  await getResumeVariants();
  const [roleEntries, bulletEntries, summaryEntries, skillEntries, educationEntries, laneEntries, comboEntries, fitEntries] = await Promise.all([
    getCollection('roles'),
    getCollection('bullets'),
    getCollection('summaries'),
    getCollection('skills'),
    getCollection('education'),
    getCollection('lanes'),
    getCollection('combos'),
    getCollection('laneFit'),
  ]);

  const rolesNewestFirst = sortRolesNewestFirst(roleEntries);
  const roleOrder = rolesNewestFirst.map((r) => r.id);
  const roleRanks = Object.fromEntries(roleEntries.map((r) => [r.id, r.data.lane_rank ?? {}]));
  // Position ties are broken by the order of this list, so it is sorted by id to give every machine the same answer.
  const bulletsById = new Map(bulletEntries.map((b) => [b.id, b]));
  const planBullets = [...bulletEntries]
    .sort(byId)
    .map((b) => ({ id: b.id, role: b.data.role.id, public: b.data.public, text: b.data.text, lanes: b.data.lanes }));
  const planCombos = [...comboEntries]
    .sort(byId)
    .map((c) => ({ id: c.id, role: c.data.role.id, replaces: c.data.replaces.map((r) => r.id), lanes: c.data.lanes, text: c.data.text }));
  const summariesById = new Map(summaryEntries.map((s) => [s.id, s]));
  const skillGroupsInOrder = [...skillEntries].sort((a, b) => a.data.order - b.data.order);
  const education = buildEducation(educationEntries);
  const css = printCssHash();

  return [...laneEntries]
    .sort((a, b) => a.data.order - b.data.order)
    .map((lane): LaneResume => {
      const plan = planLane({
        lane: lane.id,
        roleOrder,
        roleRanks,
        bullets: planBullets,
        combos: planCombos,
        floors: lane.data.role_floor ?? {},
      });
      if (plan.initial.length === 0) throw new Error(`Lane "${lane.id}" has no bullets tagged for it`);

      const summary = summariesById.get(lane.data.summary_id.id);
      if (!summary) throw new Error(`Lane "${lane.id}" uses summary "${lane.data.summary_id.id}", which does not exist`);
      const skills = laneSkills(skillGroupsInOrder, lane.id, lane.data.skills);
      const print = fingerprint(plan, { summary: summary.data.text, skills, labels: lane.data.org_labels, css });

      let items: Item[];
      if (options.candidates) {
        items = [...plan.initial, ...plan.steps.flatMap((s) => (s.type === 'swap' ? [s.item] : []))].sort(compareItems);
      } else {
        const saved = fitEntries.find((e) => e.id === lane.id);
        if (!saved) throw new Error(`Lane "${lane.id}" has no saved fit in lane-fit.yaml. Run "npm run fit-lanes".`);
        if (saved.data.fingerprint !== print) {
          throw new Error(
            `Lane "${lane.id}" is out of date: the bullets, tags, ranks, wording, summary, skills, or print stylesheet changed since it was fitted. Run "npm run fit-lanes" to fit it again.`,
          );
        }
        if (saved.data.steps > plan.steps.length) throw new Error(`Lane "${lane.id}" has a saved fit of ${saved.data.steps} steps but its plan has only ${plan.steps.length}`);
        items = applySteps(plan, saved.data.steps);
      }

      const sections: ResumeSection[] = [];
      for (const role of rolesNewestFirst) {
        const roleItems = items.filter((i) => i.role === role.id);
        if (!roleItems.length) continue;
        sections.push(
          makeSection(
            role,
            roleItems.map((i) => {
              const bullet = i.kind === 'bullet' ? bulletsById.get(i.id) : undefined;
              return {
                id: i.id,
                key: i.id,
                text: i.text,
                theme: bullet?.data.theme ?? 'combined-bullet',
                tags: bullet?.data.tags ?? [],
                hidden: options.candidates && i.kind === 'combo' ? true : undefined,
              };
            }),
            lane.data.org_labels,
          ),
        );
      }

      return {
        id: `lane-${lane.id}`,
        laneId: lane.id,
        label: lane.data.label,
        summary: summary.data.text,
        orgLabels: lane.data.org_labels,
        skills,
        sections,
        education,
        fingerprint: print,
        plan: options.candidates ? plan : undefined,
      };
    });
}

/** One resume the public site shows: its web address, its PDF, and the content. */
export interface SiteResume {
  /** The address segment: /resume/<route>/. A lane's own id (qa, sdet, con, adp, pmba, it), or a hand-written version's id. */
  route: string;
  label: string;
  /** The PDF file name under /resume/. */
  pdf: string;
  resume: ResumeVariant;
}

/**
 * Every resume on the public site, in the order the version switcher lists them: the six lane resumes in
 * lanes.yaml order, then the hand-written versions in variants.yaml order. The fit script builds a throwaway
 * copy of the site with LANE_FIT=1, where the lane resumes cannot be built yet, so it gets the hand-written versions only.
 */
export async function getSiteResumes(): Promise<SiteResume[]> {
  const lanes = process.env.LANE_FIT === '1' ? [] : await getLaneResumes();
  const variants = await getResumeVariants({ labels: 'real' });
  return [
    ...lanes.map((l) => ({ route: l.laneId, label: l.label, pdf: `steve-johnson-resume-${l.id}.pdf`, resume: l as ResumeVariant })),
    ...variants.map((v) => ({ route: v.id, label: v.label, pdf: `steve-johnson-resume-${v.id}.pdf`, resume: v })),
  ];
}
