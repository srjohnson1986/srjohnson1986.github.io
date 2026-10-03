import { getCollection, type CollectionEntry } from 'astro:content';
import { tagLabel } from './projects';

export type Release = CollectionEntry<'releases'>;
export type ReleaseKind = Release['data']['kind'];
export type Role = NonNullable<Release['data']['roles']>[number];

export const KIND_LABELS: Record<ReleaseKind, string> = {
  album: 'Album',
  ep: 'EP',
  single: 'Single',
  split: 'Split',
};

export const ROLE_LABELS: Record<Role, string> = {
  produced: 'Produced',
  engineered: 'Engineered',
  mixed: 'Mixed',
  mastered: 'Mastered',
  performed: 'Performed',
};

/** Newest year first, then alphabetical by title. */
export async function getReleases(): Promise<Release[]> {
  const releases = await getCollection('releases');
  return releases.sort((a, b) => b.data.year - a.data.year || a.data.title.localeCompare(b.data.title));
}

export interface ReleaseFacets {
  years: number[];
  kinds: { kind: ReleaseKind; label: string; count: number }[];
  roles: { role: Role; label: string; count: number }[];
  tags: { tag: string; label: string; count: number }[];
}

/** Everything the Audio filters offer, derived from the releases so it can never go stale. */
export function getFacets(releases: Release[]): ReleaseFacets {
  const years = [...new Set(releases.map((r) => r.data.year))].sort((a, b) => b - a);

  const kindCounts = new Map<ReleaseKind, number>();
  const roleCounts = new Map<Role, number>();
  const tagCounts = new Map<string, number>();
  for (const { data } of releases) {
    kindCounts.set(data.kind, (kindCounts.get(data.kind) ?? 0) + 1);
    for (const role of data.roles ?? []) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    for (const tag of data.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const roleOrder = Object.keys(ROLE_LABELS) as Role[];
  return {
    years,
    kinds: [...kindCounts]
      .map(([kind, count]) => ({ kind, label: KIND_LABELS[kind], count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles: [...roleCounts]
      .map(([role, count]) => ({ role, label: ROLE_LABELS[role], count }))
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role)),
    tags: [...tagCounts]
      .map(([tag, count]) => ({ tag, label: tagLabel(tag), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
