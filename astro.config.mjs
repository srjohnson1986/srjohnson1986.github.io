// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // A user site (repo named <user>.github.io) is served from the domain root,
  // so no `base` path is needed. `site` is used for canonical URLs and the sitemap.
  site: 'https://srjohnson1986.github.io',
  integrations: [
    sitemap({
      // Not meant to be found in search: the print routes (they feed the PDFs), the 404 page, and
      // /resume/, which only redirects to the first resume version.
      filter: (page) =>
        !page.includes('/resume/print/') && !page.endsWith('/404.html') && !page.endsWith('/404/') && !page.endsWith('/resume/'),
    }),
  ],
});
