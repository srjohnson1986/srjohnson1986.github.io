import { nav, withProjectPages, type NavItem } from '../data/site';
import { getProjects } from './projects';

/** The full navigation: the pages in src/data/site.ts, with a page for each project under Development & QA. */
export async function getNav(): Promise<NavItem[]> {
  const projects = await getProjects();
  return withProjectPages(
    nav,
    projects.map((p) => ({ id: p.id, navTitle: p.data.navTitle })),
  );
}
