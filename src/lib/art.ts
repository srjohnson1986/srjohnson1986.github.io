import { getCollection, type CollectionEntry } from 'astro:content';

export type Artwork = CollectionEntry<'artworks'>;
export type Medium = Artwork['data']['medium'];

// Order here is the order of the groups on the Art page. Empty groups are not shown.
export const MEDIUM_LABELS: Record<Medium, string> = {
  'show-flyer': 'Show flyers',
  illustration: 'Illustrations',
  other: 'Other work',
};

export const FORMAT_LABELS = {
  'poster-11x17': '11x17 poster',
  square: 'Square',
  social: 'Social media',
} as const;

/** Newest year first, then alphabetical by title. */
export async function getArtworks(): Promise<Artwork[]> {
  const pieces = await getCollection('artworks');
  return pieces.sort((a, b) => b.data.year - a.data.year || a.data.title.localeCompare(b.data.title));
}

export interface ArtGroup {
  medium: Medium;
  label: string;
  pieces: Artwork[];
}

/** Pieces grouped by medium, in the order of MEDIUM_LABELS, leaving out groups with no pieces. */
export function groupByMedium(pieces: Artwork[]): ArtGroup[] {
  return (Object.keys(MEDIUM_LABELS) as Medium[])
    .map((medium) => ({
      medium,
      label: MEDIUM_LABELS[medium],
      pieces: pieces.filter((p) => p.data.medium === medium),
    }))
    .filter((group) => group.pieces.length > 0);
}
