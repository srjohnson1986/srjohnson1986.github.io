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

/**
 * A number that sorts pieces by date: year, then month, then day (2026.02.13 becomes 20260213).
 * The month and day come from the numbers at the start of the `date` text, which can also be a
 * range ("2024.12.13-15" counts as the 13th) or just year and month ("2025.10"). A part the text
 * does not give counts as 0, so a piece with only a year, or a date like "Summer 2025", comes
 * after the dated pieces of that year. A piece with no year at all comes last.
 */
function dateKey(piece: Artwork): number {
  const [, y, m, d] = piece.data.date?.match(/^(\d{4})(?:\.(\d{2}))?(?:\.(\d{2}))?/) ?? [];
  const year = piece.data.year ?? Number(y ?? 0);
  // Only trust the month and day when the date text is in the same year as `year`.
  const monthAndDay = Number(y) === year ? Number(m ?? 0) * 100 + Number(d ?? 0) : 0;
  return year * 10000 + monthAndDay;
}

/**
 * Newest first by date. Pieces with the same date keep the arrangement given by `order` (lower
 * first), then alphabetical by title.
 */
export async function getArtworks(): Promise<Artwork[]> {
  const pieces = await getCollection('artworks');
  return pieces.sort(
    (a, b) =>
      dateKey(b) - dateKey(a) ||
      (a.data.order ?? 0) - (b.data.order ?? 0) ||
      a.data.title.localeCompare(b.data.title),
  );
}

export interface ArtFacets {
  years: number[];
  formats: { format: keyof typeof FORMAT_LABELS; label: string }[];
  tags: { tag: string; count: number }[];
}

/** What the Art filters offer, derived from the pieces so it can never go stale. */
export function getFacets(pieces: Artwork[]): ArtFacets {
  const tagCounts = new Map<string, number>();
  for (const piece of pieces) for (const tag of piece.data.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

  return {
    years: [...new Set(pieces.flatMap((p) => (p.data.year ? [p.data.year] : [])))].sort((a, b) => b - a),
    // In the order of FORMAT_LABELS, leaving out shapes no piece uses.
    formats: (Object.keys(FORMAT_LABELS) as (keyof typeof FORMAT_LABELS)[])
      .filter((format) => pieces.some((p) => p.data.format === format))
      .map((format) => ({ format, label: FORMAT_LABELS[format] })),
    // Most used first, then alphabetical, like the other pages.
    tags: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
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
