// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
  },
  integrations: [
    sitemap({
      // Not meant to be found in search: the print routes (they feed the PDFs), the 404 page, /resume/,
      // which only redirects to the first resume version, and /events/, which redirects to Jabroni Fest.
      filter: (page) =>
        !page.includes('/resume/print/') &&
        !page.endsWith('/404.html') &&
        !page.endsWith('/404/') &&
        !page.endsWith('/resume/') &&
        !page.endsWith('/events/'),
    }),
  ],
});
