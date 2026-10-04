// Which bands a release belongs to, for the Band dropdown on the Audio page. Plain functions with
// no Astro imports, so the tests use the exact same rules as the page.

/** The bands a release is filed under: its `bands` list, or just its artist. */
export const bandsOf = (data: { artist: string; bands?: string[] }): string[] => data.bands ?? [data.artist];

/** A band name as a short, space-free value for the filter ("Mëdusa" becomes "medusa", "breaux!" becomes "breaux"). */
export const bandSlug = (band: string): string =>
  band
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
