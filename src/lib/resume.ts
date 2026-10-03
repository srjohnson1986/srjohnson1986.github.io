import { getCollection, type CollectionEntry } from 'astro:content';

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
  bullets: { id: string; text: string; theme: string; tags: string[] }[];
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

/**
 * Builds every resume variant from the content collections and enforces the rules that a
 * single-collection schema cannot. Any violation throws, which fails `astro build`.
 *
 * Checked by the schemas in src/content.config.ts: field shapes, copy rules (single hyphens,
 * no phone numbers, past-tense verbs) and that every referenced id exists.
 * Checked here: every bullet used by a variant is `public: true`, no two bullets in
 * one variant start with the same verb, and no public bullet mentions a `training_only` skill.
 */
export async function getResumeVariants(options: { labels?: 'real' } = {}): Promise<ResumeVariant[]> {
  const [roleEntries, bulletEntries, summaryEntries, variantEntries, skillEntries, educationEntries] = await Promise.all([
    getCollection('roles'),
    getCollection('bullets'),
    getCollection('summaries'),
    getCollection('variants'),
    getCollection('skills'),
    getCollection('education'),
  ]);

  const bulletsById = new Map<string, Bullet>(bulletEntries.map((b) => [b.id, b]));
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
  if (claims.length) {
    throw new Error(
      `Training-only skills may not appear in public bullets:\n  - ${claims.join('\n  - ')}\n` +
        'Remove the mention, or drop training_only once a public project backs the skill.',
    );
  }

  const skillGroupsInOrder = [...skillEntries].sort((a, b) => a.data.order - b.data.order);
  const educationInOrder = [...educationEntries].sort((a, b) => a.data.order - b.data.order);
  const education: ResumeEducation[] = educationInOrder.map(({ data }) =>
    'degree' in data
      ? { title: data.degree, detail: data.school, dates: `${data.year}` }
      : {
          title: data.level ? `${data.certification} (${data.level})` : data.certification,
          dates: formatRange(data.since, 'present'),
        },
  );

  // Ongoing roles first, then by end year, then start year, then id. Astro does not
  // guarantee collection order, so every tie is broken explicitly to keep builds stable.
  const endKey = (r: Role) => (r.data.end === 'present' ? Infinity : r.data.end);
  const rolesNewestFirst: Role[] = [...roleEntries].sort(
    (a, b) => endKey(b) - endKey(a) || b.data.start - a.data.start || a.id.localeCompare(b.id),
  );
  const variantsInOrder = [...variantEntries].sort((a, b) => a.data.order - b.data.order);

  return variantsInOrder.map((variant): ResumeVariant => {
    const problems: string[] = [];

    const chosen: Bullet[] = [];
    for (const ref of variant.data.bullets) {
      const bullet = bulletsById.get(ref.id);
      if (!bullet) problems.push(`bullet "${ref.id}" does not exist`);
      else if (!bullet.data.public) problems.push(`bullet "${ref.id}" is not public: true`);
      else chosen.push(bullet);
    }

    const byVerb = new Map<string, string[]>();
    for (const b of chosen) {
      const verb = firstWord(b.data.text).toLowerCase();
      byVerb.set(verb, [...(byVerb.get(verb) ?? []), b.id]);
    }
    for (const [verb, ids] of byVerb) {
      if (ids.length > 1) problems.push(`"${verb}" starts more than one bullet (${ids.join(', ')}); vary the verbs`);
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
      const useNeutral = labelMode === 'neutral' && role.data.neutral_org;
      sections.push({
        roleId: role.id,
        org: useNeutral ? role.data.neutral_org! : role.data.org,
        title: role.data.title,
        note: role.data.note,
        positions: role.data.positions?.map((p) => ({
          title: p.title,
          dates: formatRange(p.start, p.end),
          note: p.note,
        })),
        dates: formatRange(role.data.start, role.data.end),
        bullets: roleBullets.map((b) => ({
          id: b.id,
          text: b.data.text,
          theme: b.data.theme,
          tags: b.data.tags,
        })),
      });
    }

    // Core Skills for this version: drop items limited to other versions, then drop empty groups.
    const skills: ResumeSkillGroup[] = skillGroupsInOrder
      .map(({ data }) => ({
        group: data.group,
        items: data.items.flatMap((item) => {
          if (typeof item === 'string') return [item];
          return !item.only || item.only.some((v) => v.id === variant.id) ? [item.name] : [];
        }),
      }))
      .filter((g) => g.items.length > 0);

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
