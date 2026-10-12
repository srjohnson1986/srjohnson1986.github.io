// Reads the same data files the site is built from, so a test can state what a page should
// contain without repeating it by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { nav as baseNav, flattenNav, withProjectPages } from '../../src/data/site';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const dist = path.join(root, 'dist');

const load = <T>(file: string): T => yaml.load(fs.readFileSync(path.join(root, file), 'utf8')) as T;

export type Year = number | 'present';
export interface Role {
  id: string;
  title: string;
  org: string;
  neutral_org?: string;
  kind: string;
  start: number;
  end: Year;
  note?: string;
  /** Roles held in turn at one employer. When present, the page lists these instead of the one title. */
  positions?: { title: string; start: number; end: Year; note?: string }[];
}
/** One entry of education.yaml: a degree (with school and year) or a certification (since a year). */
export interface Education {
  id: string;
  order: number;
  degree?: string;
  school?: string;
  year?: number;
  certification?: string;
  level?: string;
  since?: number;
}
export interface Bullet {
  id: string;
  role: string;
  text: string;
  public: boolean;
}
export interface Variant {
  id: string;
  order: number;
  label: string;
  summary_id: string;
  org_labels: 'neutral' | 'real';
  include?: string[];
  /** The variant's own bullets, after its included groups. Use `variantBulletIds` for the full list. */
  bullets?: string[];
}
export interface BulletGroup {
  id: string;
  label: string;
  bullets: string[];
}
export interface Summary {
  id: string;
  text: string;
}
export type SkillItem = string | { name: string; only?: string[]; training_only?: boolean };
export interface SkillGroup {
  id: string;
  order: number;
  group: string;
  items: SkillItem[];
}

export const roles = load<Role[]>('src/data/resume/roles.yaml');
export const education = load<Education[]>('src/data/resume/education.yaml').sort((a, b) => a.order - b.order);

/**
 * A date range as the resume prints it: "2012-2024", "2011" when it starts and ends in one year, and
 * "2026-Present" while it goes on. This is written out here, apart from the site's own version, so a
 * test compares the page with something the site did not compute. (resume-details.spec.ts pins it
 * with literal examples.)
 */
export const dateRange = (start: number, end: Year): string =>
  end === 'present' ? `${start}-Present` : start === end ? `${start}` : `${start}-${end}`;

/**
 * Roles in the order the resume lists them: ongoing roles first, then the latest end year, then the
 * latest start year, then by id. Also written out here apart from the site's version.
 */
export const rolesNewestFirst = [...roles].sort((a, b) => {
  const end = (r: Role) => (r.end === 'present' ? Infinity : r.end);
  return end(b) - end(a) || b.start - a.start || a.id.localeCompare(b.id);
});
export const bullets = load<Bullet[]>('src/data/resume/bullets.yaml');
export const summaries = load<Summary[]>('src/data/resume/summaries.yaml');
export const skillGroups = load<SkillGroup[]>('src/data/resume/skills.yaml');
export const bulletGroups = load<BulletGroup[]>('src/data/resume/bullet-groups.yaml');
export const variants = load<Variant[]>('src/data/resume/variants.yaml').sort((a, b) => a.order - b.order);

// The full bullet list of a version: each included group in order, then its own bullets. This
// mirrors how the site expands groups, so the tests state what a version should show.
export const variantBulletIds = (v: Variant): string[] => [
  ...(v.include ?? []).flatMap((g) => bulletGroups.find((x) => x.id === g)?.bullets ?? []),
  ...(v.bullets ?? []),
];

interface Intro {
  id: string;
  title: string;
  description: string;
  lead: string;
  closing?: string;
  studio_link?: string;
  empty?: string;
  no_match?: string;
  paragraphs?: string[];
  cards?: { title: string; blurb: string; href: string }[];
  email_note?: string;
  heading?: string;
  button?: string;
  links_heading?: string;
}
export const intros = Object.fromEntries(load<Intro[]>('src/data/intros.yaml').map((i) => [i.id, i])) as Record<string, Intro>;

export interface HomeCard {
  id: string;
  order: number;
  title: string;
  blurb: string;
  href?: string;
}
export const homeCards = load<HomeCard[]>('src/data/home-cards.yaml').sort((a, b) => a.order - b.order);
export interface EventOrg {
  id: string;
  name: string;
  summary: string;
  role: string;
  facts: { value: string; label: string }[];
  howItRuns: string[];
  cause: { name: string; description: string };
}
/** The organizations on the Jabroni Fest page, in the order the page lists them (by id). */
export const events = load<EventOrg[]>('src/data/events.yaml').sort((a, b) => a.id.localeCompare(b.id));
export const studio = load<{ id: string; heading: string; story: string[] }[]>('src/data/studio.yaml')[0];
export const bulletById = new Map(bullets.map((b) => [b.id, b]));
export const roleById = new Map(roles.map((r) => [r.id, r]));
export const summaryById = new Map(summaries.map((s) => [s.id, s]));

const loadDir = <T>(dir: string): (T & { slug: string })[] =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => ({ ...load<T>(path.join(dir, f)), slug: f.replace(/\.yaml$/, '') }));

export interface Project {
  slug: string;
  title: string;
  navTitle: string;
  summary: string;
  year: number;
  featured?: boolean;
  type: string;
  tags: string[];
  stack: string[];
  problem: string;
  built: string[];
  outcome: string[];
  facts?: { value: string; label: string }[];
  links: { repo?: string; demo?: string };
}
export interface Release {
  slug: string;
  title: string;
  artist: string;
  bands?: string[];
  year: number;
  type: string;
  roles?: string[];
  tags: string[];
  bandcamp: string;
  embed: string;
}
export interface Artwork {
  slug: string;
  title: string;
  year?: number;
  date?: string;
  format?: string;
  bands?: string[];
  venues?: string[];
  story?: string[];
  caption?: string;
  tags?: string[];
  more?: { image: string; alt: string; caption?: string }[];
  alt: string;
}

export const projects = loadDir<Project>('src/content/projects');
/** The projects in the order the Development page lists them: newest year first, featured first within a year, then by title. (A test checks the page really uses this order.) */
export const projectsInArchiveOrder = [...projects].sort(
  (a, b) => b.year - a.year || Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.title.localeCompare(b.title),
);
/** The whole navigation as the site builds it: the pages in site.ts, with a page for each project under Development. */
export const nav = withProjectPages(
  baseNav,
  projectsInArchiveOrder.map((p) => ({ id: p.slug, navTitle: p.navTitle })),
);
/** The navigation as one flat list: each section followed by its pages. */
export const navPages = flattenNav(nav);
export const releases = loadDir<Release>('src/content/releases');
// A name like 529 can be written without quotes in YAML and is read as a number; the site treats it as text.
const asText = (list?: unknown[]) => list?.map(String);
export const artworks = loadDir<Artwork>('src/content/art').map((a) => ({
  ...a,
  bands: asText(a.bands),
  venues: asText(a.venues),
  tags: asText(a.tags),
}));

/** The skills a given resume version should show, group by group, in display order. */
export function expectedSkills(variantId: string): { group: string; items: string[] }[] {
  return [...skillGroups]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({
      group: g.group,
      items: g.items.flatMap((item) =>
        typeof item === 'string' ? [item] : !item.only || item.only.includes(variantId) ? [item.name] : [],
      ),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Pages that only forward the visitor to another page. They are built, but they are not real pages:
 * they are not in the sitemap, not scanned, and (for the retired ones) nothing links to them.
 * "/resume/" forwards to the first resume version and the navigation links to it. "/events/" is the
 * old address of the Jabroni Fest page, and "/development/" with a page for each project under it is
 * the old address of Development & QA. They are kept so old links still work, and nothing links to them.
 */
export const retiredPages = ['/events/', '/development/', ...projects.map((p) => `/development/${p.slug}/`)];
export const redirectPages = ['/resume/', ...retiredPages];

/** Every page in the built site as a URL path, such as "/" or "/resume/qa/". */
export function builtPages(): string[] {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'index.html') {
        const rel = path.relative(dist, path.dirname(full)).split(path.sep).join('/');
        pages.push(rel ? `/${rel}/` : '/');
      }
    }
  };
  if (!fs.existsSync(dist)) throw new Error('dist/ not found. Run "npm run build" first (or use "npm test").');
  walk(dist);
  return pages.sort();
}
