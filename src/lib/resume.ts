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

export interface ResumeVariant {
  id: string;
  label: string;
  summary: string;
  orgLabels: 'neutral' | 'real';
  sections: ResumeSection[];
}

export function formatRange(start: number, end: number | 'present'): string {
  if (end === 'present') return `${start}-Present`;
  return start === end ? `${start}` : `${start}-${end}`;
}

const firstWord = (text: string) => text.match(/^[A-Za-z]+/)?.[0] ?? text;

/**
 * Builds every resume variant from the content collections and enforces the rules that a
 * single-collection schema cannot. Any violation throws, which fails `astro build`.
 *
 * Checked by the schemas in src/content.config.ts: field shapes, copy rules (single hyphens,
 * no phone numbers, past-tense verbs) and that every referenced id exists.
 * Checked here: every bullet used by a variant is `public: true`, and no two bullets in
 * one variant start with the same verb.
 */
export async function getResumeVariants(): Promise<ResumeVariant[]> {
  const [roleEntries, bulletEntries, summaryEntries, variantEntries] = await Promise.all([
    getCollection('roles'),
    getCollection('bullets'),
    getCollection('summaries'),
    getCollection('variants'),
  ]);

  const bulletsById = new Map<string, Bullet>(bulletEntries.map((b) => [b.id, b]));
  const summariesById = new Map(summaryEntries.map((s) => [s.id, s]));

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

    const sections: ResumeSection[] = [];
    for (const role of rolesNewestFirst) {
      const roleBullets = chosen.filter((b) => b.data.role.id === role.id);
      if (!roleBullets.length) continue;
      const useNeutral = variant.data.org_labels === 'neutral' && role.data.neutral_org;
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

    return {
      id: variant.id,
      label: variant.data.label,
      summary: summary!.data.text,
      orgLabels: variant.data.org_labels,
      sections,
    };
  });
}
