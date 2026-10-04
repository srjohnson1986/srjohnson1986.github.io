import { getCollection, type CollectionEntry } from 'astro:content';
import { tagLabel } from './projects';
import { bandsOf, bandSlug } from './band';

export type Release = CollectionEntry<'releases'>;
export type ReleaseType = Release['data']['type'];
export type Role = NonNullable<Release['data']['roles']>[number];

export const TYPE_LABELS: Record<ReleaseType, string> = {
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
  wrote: 'Wrote',
  performed: 'Performed',
};

/** Newest year first, then alphabetical by title. */
export async function getReleases(): Promise<Release[]> {
  const releases = await getCollection('releases');
  return releases.sort((a, b) => b.data.year - a.data.year || a.data.title.localeCompare(b.data.title));
}

export interface ReleaseFacets {
  years: number[];
  bands: { band: string; slug: string }[];
  roles: { role: Role; label: string; count: number }[];
  tags: { tag: string; label: string; count: number }[];
}

/** Everything the Audio filters offer, derived from the releases so it can never go stale. */
export function getFacets(releases: Release[]): ReleaseFacets {
  const years = [...new Set(releases.map((r) => r.data.year))].sort((a, b) => b - a);

  const bandNames = new Map<string, string>(); // slug -> name
  const roleCounts = new Map<Role, number>();
  const tagCounts = new Map<string, number>();
  for (const { data } of releases) {
    for (const band of bandsOf(data)) bandNames.set(bandSlug(band), band);
    for (const role of data.roles ?? []) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    for (const tag of data.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const roleOrder = Object.keys(ROLE_LABELS) as Role[];
  return {
    years,
    bands: [...bandNames]
      .map(([slug, band]) => ({ band, slug }))
      .sort((a, b) => a.band.localeCompare(b.band, 'en', { sensitivity: 'base' })),
    roles: [...roleCounts]
      .map(([role, count]) => ({ role, label: ROLE_LABELS[role], count }))
      .sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role)),
    tags: [...tagCounts]
      .map(([tag, count]) => ({ tag, label: tagLabel(tag), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/**
 * The address of a release's Bandcamp player in the light or the dark colors. Bandcamp draws the
 * player from the colors in its address, so the dark version uses the site's dark card and accent
 * colors (src/styles/global.css) and the light version is the address exactly as it is in the data.
 */
export function embedFor(embed: string, scheme: 'light' | 'dark'): string {
  if (scheme === 'light') return embed;
  return embed.replace(/\/bgcol=[0-9a-f]+/i, '/bgcol=1b1b20').replace(/\/linkcol=[0-9a-f]+/i, '/linkcol=e0a070');
}
