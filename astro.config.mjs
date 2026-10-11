// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';

// The Development & QA section used to live at /development/. The index and every project page
// forward to the new address. The project forwards are made from the project files, so none has to
// be added by hand. (A project added after the move gets a forward that nobody has linked to, which
// is harmless.)
const projectsDir = new URL('./src/content/projects/', import.meta.url);
const oldProjectPages = Object.fromEntries(
  fs
    .readdirSync(projectsDir)
    .filter((file) => file.endsWith('.yaml'))
    .map((file) => file.replace(/\.yaml$/, ''))
    .map((id) => [`/development/${id}`, `/development-qa/${id}/`]),
);

// https://astro.build/config
export default defineConfig({
  // A user site (repo named <user>.github.io) is served from the domain root,
  // so no `base` path is needed. `site` is used for canonical URLs and the sitemap.
  site: 'https://srjohnson1986.github.io',
  // The festival page used to be called Events. Old links and search results to /events/ land on
  // the new address. (Astro writes a small page that forwards the visitor, since GitHub Pages
  // cannot send a real redirect.)
  redirects: {
    '/events': '/jabroni-fest/',
    '/development': '/development-qa/',
    ...oldProjectPages,
  },
  integrations: [
    sitemap({
      // Not meant to be found in search: the print routes (they feed the PDFs), the 404 page, /resume/,
      // which only redirects to the first resume version, /events/, which redirects to Jabroni Fest, and the old /development/ pages, which redirect to /development-qa/.
      filter: (page) =>
        !page.includes('/resume/print/') &&
        !page.endsWith('/404.html') &&
        !page.endsWith('/404/') &&
        !page.endsWith('/resume/') &&
        !page.endsWith('/events/') &&
        !page.includes('/development/'),
    }),
  ],
});
