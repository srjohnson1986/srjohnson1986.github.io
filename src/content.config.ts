import { defineCollection, reference } from 'astro:content';
import { file } from 'astro/loaders';
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
      bullets: z.array(reference('bullets')).min(1),
    })
    .refine((v) => new Set(v.bullets.map((b) => b.id)).size === v.bullets.length, 'A bullet is listed twice in this variant'),
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

export const collections = { roles, bullets, summaries, variants, skills, education };
