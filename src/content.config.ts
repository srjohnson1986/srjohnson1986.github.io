import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const year = z.number().int().min(1990).max(2100);
const endYear = z.union([year, z.literal('present')]);
const kebab = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase-kebab-case (letters, digits, single hyphens)');

// Public copy rules from CLAUDE.md. A schema failure stops the build, so a bad
// entry can never reach the live site.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const noDashes = (s: string) => !s.includes(EN_DASH) && !s.includes(EM_DASH) && !s.includes('--');
const noPhone = (s: string) => !/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(s);
const copy = z
  .string()
  .trim()
  .min(1)
  .refine(noDashes, 'Use single hyphens only: no em dashes, en dashes, or double hyphens')
  .refine(noPhone, 'Do not publish phone numbers');

// A web link, which must be https. Used by projects (repo, demo) and releases (Bandcamp page).
const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), 'Use an https:// link');

// Resume bullets start with a past-tense verb ("Built", "Led"...). Regular verbs end in
// "ed"; the short list below covers the irregular ones. Add to it if a valid verb is rejected.
const IRREGULAR_PAST = new Set([
  'Built', 'Led', 'Wrote', 'Set', 'Kept', 'Split', 'Ran', 'Held', 'Made', 'Taught', 'Drove', 'Won', 'Sent', 'Brought',
]);
const startsWithPastTenseVerb = (s: string) => {
  const word = s.match(/^[A-Za-z]+/)?.[0] ?? '';
  return /^[A-Z][a-z]+ed$/.test(word) || IRREGULAR_PAST.has(word);
};

const dateOrder = (v: { start: number; end: number | 'present' }) => v.end === 'present' || v.end >= v.start;

// ---------------------------------------------------------------------------
// Resume collections (src/data/resume/*.yaml)
// ---------------------------------------------------------------------------

const roles = defineCollection({
  loader: file('src/data/resume/roles.yaml'),
  schema: z
    .strictObject({
      id: z.string(),
      title: copy,
      org: copy,
      // Alternate employer label for variants with org_labels: neutral.
      neutral_org: copy.optional(),
      kind: z.enum(['job', 'internship', 'volunteer', 'self-employed', 'project']),
      start: year,
      end: endYear,
      note: copy.optional(),
      // Optional progression within one employer, newest first.
      positions: z
        .array(
          z
            .strictObject({ title: copy, start: year, end: endYear, note: copy.optional() })
            .refine(dateOrder, 'Position end year is before its start year'),
        )
        .optional(),
    })
    .refine(dateOrder, 'Role end year is before its start year'),
});

const bullets = defineCollection({
  loader: file('src/data/resume/bullets.yaml'),
  schema: z.strictObject({
    id: z.string(),
    role: reference('roles'),
    theme: kebab,
    tags: z.array(kebab).min(1),
    // Only bullets with public: true may appear on the site or in a PDF.
    public: z.boolean(),
    text: copy.refine(startsWithPastTenseVerb, 'Start with a strong past-tense verb'),
  }),
});

const summaries = defineCollection({
  loader: file('src/data/resume/summaries.yaml'),
  schema: z.strictObject({ id: z.string(), text: copy }),
});

// A named list of bullets that several variants share. A variant pulls one in with `include`.
const bulletGroups = defineCollection({
  loader: file('src/data/resume/bullet-groups.yaml'),
  schema: z.strictObject({
    id: z.string(),
    // A short note on what the group is for. Not shown on the site.
    label: copy,
    bullets: z.array(reference('bullets')).min(1),
  }),
});

const variants = defineCollection({
  loader: file('src/data/resume/variants.yaml'),
  schema: z
    .strictObject({
      id: z.string(),
      // Display order on the Resume page (1 is first).
      order: z.number().int().min(1),
      label: copy,
      summary_id: reference('summaries'),
      // neutral: use each role's neutral_org where one exists. real: use real names.
      org_labels: z.enum(['neutral', 'real']),
      // Shared groups come first, in this order, then the variant's own bullets.
      include: z.array(reference('bulletGroups')).optional(),
      bullets: z.array(reference('bullets')).optional(),
    })
    .refine((v) => (v.include?.length ?? 0) + (v.bullets?.length ?? 0) > 0, 'A variant needs at least one bullet group or bullet'),
});

const skills = defineCollection({
  loader: file('src/data/resume/skills.yaml'),
  schema: z.strictObject({
    id: z.string(),
    // Display order of the group in the Core Skills block (1 is first).
    order: z.number().int().min(1),
    group: copy,
    items: z
      .array(
        z.union([
          copy,
          z.strictObject({
            name: copy,
            // Limit the skill to these resume versions. Omit to show it on every version.
            only: z.array(reference('variants')).min(1).optional(),
            // Keep the skill listed, but no public bullet may mention it.
            training_only: z.boolean().optional(),
          }),
        ]),
      )
      .min(1),
  }),
});

const placeholderLevel = (s: string) => !/\b(todo|tbd|confirm)\b/i.test(s);

const education = defineCollection({
  loader: file('src/data/resume/education.yaml'),
  schema: z.union([
    z.strictObject({
      id: z.string(),
      order: z.number().int().min(1),
      degree: copy,
      school: copy,
      year: year,
    }),
    z.strictObject({
      id: z.string(),
      order: z.number().int().min(1),
      certification: copy,
      since: year,
      // Leave unset until the exact level is confirmed. Placeholder text fails the build.
      level: copy.refine(placeholderLevel, 'This looks like a placeholder: confirm the level before publishing it').optional(),
    }),
  ]),
});

// A headline number with its label, shown in a strip on project pages and the Events page.
const fact = z.strictObject({ value: copy, label: copy });

// ---------------------------------------------------------------------------
// Events (src/data/events.yaml)
// ---------------------------------------------------------------------------

const events = defineCollection({
  loader: file('src/data/events.yaml'),
  schema: z.strictObject({
    id: z.string(),
    name: copy,
    summary: copy,
    role: copy,
    facts: z.array(fact).min(1).max(6),
    howItRuns: z.array(copy).min(1),
    cause: z.strictObject({ name: copy, description: copy }),
  }),
});

// ---------------------------------------------------------------------------
// Art (src/content/art/<piece>.yaml, images in src/assets/art/)
// ---------------------------------------------------------------------------

const artworks = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/art' }),
  schema: ({ image }) => {
    // Required for every image, and long enough to describe it to someone who cannot see it.
    const alt = copy.refine((s) => s.length >= 12, 'Describe the artwork in the alt text (at least 12 characters)');
    // A list of labels with no repeats. `what` names the list in the error message.
    const labels = (what: string) =>
      // YAML reads an unquoted 529 as a number, so a number is accepted and turned into its text.
      z
        .array(z.coerce.string().pipe(kebab))
        .min(1)
        .refine((list) => new Set(list).size === list.length, `${what} is listed twice`);

    return z.strictObject({
      title: copy,
      // Leave out when the year is not known. Pieces without a year sort after dated ones.
      year: year.optional(),
      // Optional date text shown instead of the year, for example 2026.02.13.
      date: copy.optional(),
      // Position among pieces of the same year (lower first). Defaults to 0.
      order: z.number().int().optional(),
      // The group the piece appears under on the Art page.
      medium: z.enum(['show-flyer', 'illustration', 'other']),
      // Optional shape label. The layout itself follows the image's real proportions.
      format: z.enum(['poster-11x17', 'square', 'social']).optional(),
      // Path relative to this file, for example ../../assets/art/my-flyer.jpg
      image: image(),
      alt,
      // Optional short text, shown under "Read more".
      caption: copy.optional(),
      // Optional labels for finding pieces, all lowercase-kebab-case. They are kept in three lists
      // to make the files easier to edit (bands on the flyer, venues, and anything else such as a
      // technique), but the Art page shows them together as one Tags group in the Filters panel.
      bands: labels('A band').optional(),
      venues: labels('A venue').optional(),
      tags: labels('A tag').optional(),
      // Optional paragraphs. A piece with a story gets an expand and collapse control.
      story: z.array(copy).min(1).optional(),
      // Optional further images for a series. They open inside the expand and collapse control.
      more: z
        .array(z.strictObject({ image: image(), alt, caption: copy.optional() }))
        .min(1)
        .optional(),
    }).superRefine((piece, ctx) => {
      // The three lists are shown together, so one name in two of them would be a repeated choice.
      const everyLabel = [...(piece.bands ?? []), ...(piece.venues ?? []), ...(piece.tags ?? [])];
      const repeated = everyLabel.filter((label, i) => everyLabel.indexOf(label) !== i);
      if (repeated.length > 0) {
        ctx.addIssue({ code: 'custom', message: `"${repeated[0]}" is in more than one of bands, venues, and tags`, path: ['tags'] });
      }

      // The Art page is sorted by the numbers at the start of `date`, so a date the sort cannot read,
      // or one in a different year than `year`, would quietly put the piece in the wrong place.
      if (piece.date === undefined) return;
      const bad = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['date'] });
      const m = piece.date.match(/^(\d{4})(?:\.(\d{2})(?:\.(\d{2})(?:-(\d{2}))?)?)?$/);
      if (!m) return bad(`Write the date as 2026, 2026.02, 2026.02.13, or a range like 2026.02.13-15, not "${piece.date}"`);
      const [, y, month, day, last] = m;
      if (piece.year === undefined) return bad('A piece with a date also needs a year');
      if (Number(y) !== piece.year) return bad(`The date is in ${y} but the year is ${piece.year}`);
      if (month !== undefined && (Number(month) < 1 || Number(month) > 12)) return bad(`${month} is not a month`);
      const daysInMonth = month === undefined ? 0 : new Date(Number(y), Number(month), 0).getDate();
      if (day !== undefined && (Number(day) < 1 || Number(day) > daysInMonth)) return bad(`${y}.${month} has no day ${day}`);
      if (last !== undefined && (Number(last) <= Number(day) || Number(last) > daysInMonth)) {
        return bad(`The end of the range (${last}) must come after the start (${day}) and fall in the same month`);
      }
    });
  },
});

// ---------------------------------------------------------------------------
// Studio information (src/data/studio.yaml), shown at the bottom of the Audio page
// ---------------------------------------------------------------------------

const studio = defineCollection({
  loader: file('src/data/studio.yaml'),
  schema: z.strictObject({
    id: z.string(),
    heading: copy,
    // The studio's story, shown near the top of the Audio page. One paragraph per entry.
    story: z.array(copy).min(1),
    rates: z.array(z.strictObject({ price: copy, description: copy })).min(1),
    // What the client is handed at the end.
    included: copy,
    prep: z.strictObject({ heading: copy, intro: copy, steps: z.array(copy).min(1) }),
  }),
});

// ---------------------------------------------------------------------------
// Page introductions (src/data/intros.yaml), the words at the top of the Home and Art pages
// ---------------------------------------------------------------------------

const intros = defineCollection({
  loader: file('src/data/intros.yaml'),
  schema: z
    .strictObject({
      // Which page the text is for.
      id: z.enum(['home', 'art', 'audio', 'contact', 'events', 'development', 'not-found']),
      // The page's title in the browser tab and in link previews, and its description.
      title: copy,
      description: copy,
      // The line under the page's heading.
      lead: copy,
      // One paragraph per entry, in order (Home and Art).
      paragraphs: z.array(copy).min(1).optional(),
      // Shown before the lead, only when an email address is published (Contact).
      email_note: copy.optional(),
      // The closing line under the contact details, which links to the resume (Contact).
      closing: copy.optional(),
      // The line pointing down to the studio rates (Audio).
      studio_link: copy.optional(),
      // Shown instead of the gallery or list when there is nothing to show (Art, Audio).
      empty: copy.optional(),
      // Shown when the filters match nothing (Art, Audio, Development).
      no_match: copy.optional(),
      // The 404 page's heading, its button to the home page, and the heading above its list of sections.
      heading: copy.optional(),
      button: copy.optional(),
      links_heading: copy.optional(),
    })
    .superRefine((entry, ctx) => {
      const need = (field: keyof typeof entry) => {
        if (entry[field] === undefined) ctx.addIssue({ code: 'custom', message: `The ${entry.id} entry needs "${field}"`, path: [field] });
      };
      if (entry.id === 'home' || entry.id === 'art') need('paragraphs');
      if (entry.id === 'art') {
        need('empty');
        need('no_match');
      }
      if (entry.id === 'audio') {
        need('studio_link');
        need('empty');
        need('no_match');
      }
      if (entry.id === 'development') need('no_match');
      if (entry.id === 'contact') {
        need('email_note');
        need('closing');
      }
      if (entry.id === 'not-found') {
        need('heading');
        need('button');
        need('links_heading');
      }

      // Only {name} and {area} may be written in braces, and a [words](link) may only point to a page
      // or section of this site.
      for (const [field, value] of Object.entries(entry)) {
        const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
        for (const text of texts) {
          if (typeof text !== 'string') continue;
          for (const m of text.matchAll(/\{([^}]*)\}/g)) {
            if (m[1] !== 'name' && m[1] !== 'area') ctx.addIssue({ code: 'custom', message: `Unknown placeholder {${m[1]}}. Use {name} or {area}`, path: [field] });
          }
          for (const m of text.matchAll(/\]\(([^)]*)\)/g)) {
            if (!/^(\/[a-z0-9-]*(\/[a-z0-9-]+)*\/?|#[a-z0-9-]+)$/.test(m[1])) {
              ctx.addIssue({ code: 'custom', message: `A link may only point to a page or section of this site, not "${m[1]}"`, path: [field] });
            }
          }
        }
      }
    }),
});

// ---------------------------------------------------------------------------
// Home cards (src/data/home-cards.yaml), the "Explore" cards on the Home page
// ---------------------------------------------------------------------------

const homeCards = defineCollection({
  loader: file('src/data/home-cards.yaml'),
  schema: z.strictObject({
    id: kebab,
    // Position on the Home page (1 is first).
    order: z.number().int().min(1),
    title: copy,
    blurb: copy,
    // The page the card opens, such as /audio/. Leave out while the page is not built yet.
    href: z
      .string()
      .regex(/^\/[a-z0-9-]*(\/[a-z0-9-]+)*\/?$/, 'Use a page path on this site, such as /audio/')
      .optional(),
  }),
});

// ---------------------------------------------------------------------------
// Audio releases (src/content/releases/<release>.yaml)
// ---------------------------------------------------------------------------

// The player address from Bandcamp's Share / Embed dialog. Only genuine Bandcamp player
// addresses are accepted, so a release can never be made to embed anything else.
const bandcampPlayer = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'bandcamp.com' && url.pathname.startsWith('/EmbeddedPlayer/');
    } catch {
      return false;
    }
  }, 'Use the player address from the Bandcamp Share / Embed dialog (https://bandcamp.com/EmbeddedPlayer/...)');

const releases = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/releases' }),
  schema: z.strictObject({
    title: copy,
    artist: copy,
    // The bands the release is filed under in the Band dropdown. Leave out when it is just the artist;
    // list each band for a split (artist "Seagulls and Karbomb" has bands Seagulls and Karbomb).
    bands: z.array(copy).min(1).optional(),
    year,
    type: z.enum(['album', 'ep', 'single', 'split']),
    // The owner's credited roles on this release. Leave out when the release lists none.
    roles: z.array(z.enum(['produced', 'engineered', 'mixed', 'mastered', 'wrote', 'performed'])).min(1).optional(),
    tags: z.array(kebab).min(1),
    // The release page on Bandcamp. A record of where the release lives; the page shows the player.
    bandcamp: httpsUrl,
    // The player, loaded only when a visitor asks for it.
    embed: bandcampPlayer,
    // Height of the player in pixels, as given in the Bandcamp embed code. Defaults to 120.
    embedHeight: z.number().int().min(40).max(700).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Development projects (src/content/projects/<project>.yaml)
// ---------------------------------------------------------------------------

const projects = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/projects' }),
  schema: z.strictObject({
    title: copy,
    // One sentence, shown on the archive card and as the page description.
    summary: copy,
    year,
    type: z.enum(['app', 'tool', 'website', 'library', 'script']),
    // Filter tags, lowercase-kebab-case. Reuse existing tags before inventing new ones.
    tags: z.array(kebab).min(1),
    stack: z.array(copy).min(1),
    // Featured projects sort first within their year.
    featured: z.boolean().optional(),
    // The three prose sections of the project page. Stack and links have their own fields.
    problem: copy,
    built: z.array(copy).min(1),
    outcome: z.array(copy).min(1),
    // Optional headline numbers. Only figures from the source bank or given by the owner.
    facts: z.array(fact).max(6).optional(),
    links: z
      .strictObject({ repo: httpsUrl.optional(), demo: httpsUrl.optional() })
      .refine((l) => Boolean(l.repo || l.demo), 'Give at least a repo or a demo link'),
  }),
});

export const collections = { roles, bullets, bulletGroups, summaries, variants, skills, education, events, artworks, studio, intros, homeCards, releases, projects };
