import { getCollection, type CollectionEntry } from 'astro:content';

export type Project = CollectionEntry<'projects'>;
export type ProjectType = Project['data']['type'];

export const TYPE_LABELS: Record<ProjectType, string> = {
  app: 'App',
  tool: 'Tool',
  website: 'Website',
  library: 'Library',
  script: 'Script',
};

// Tags are stored as lowercase-kebab-case. Most read fine with the hyphens turned into spaces;
// these are the ones that need their own capitalization.
const TAG_LABELS: Record<string, string> = {
  'ai-assisted': 'AI-assisted',
  'ci-cd': 'CI/CD',
  pwa: 'PWA',
  vba: 'VBA',
};

export const tagLabel = (tag: string): string => TAG_LABELS[tag] ?? tag.replace(/-/g, ' ');

/** Newest year first; within a year, featured projects first, then alphabetical by title. */
export async function getProjects(): Promise<Project[]> {
  const projects = await getCollection('projects');
  return projects.sort(
    (a, b) =>
      b.data.year - a.data.year ||
      Number(Boolean(b.data.featured)) - Number(Boolean(a.data.featured)) ||
      a.data.title.localeCompare(b.data.title),
  );
}

export interface ProjectFacets {
  tags: { tag: string; label: string; count: number }[];
}

/** Everything the archive filters offer, derived from the projects so it can never go stale. */
export function getFacets(projects: Project[]): ProjectFacets {
  const tagCounts = new Map<string, number>();
  for (const { data } of projects) {
    for (const tag of data.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return {
    tags: [...tagCounts]
      .map(([tag, count]) => ({ tag, label: tagLabel(tag), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
