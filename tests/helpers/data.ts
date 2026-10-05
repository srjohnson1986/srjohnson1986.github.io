// Reads the same data files the site is built from, so a test can state what a page should
// contain without repeating it by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const dist = path.join(root, 'dist');

const load = <T>(file: string): T => yaml.load(fs.readFileSync(path.join(root, file), 'utf8')) as T;

export interface Role {
  id: string;
  title: string;
  org: string;
  neutral_org?: string;
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
  year: number;
  type: string;
  tags: string[];
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
