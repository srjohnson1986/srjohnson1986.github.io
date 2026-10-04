# Steve Johnson - personal site

**Live site:** https://srjohnson1986.github.io

My personal site, built with [Astro](https://astro.build) and hosted on GitHub Pages. It has two jobs:

1. **Help me get hired.** The Home and Resume pages are written for employers, and the resume is available as a web page and as downloadable PDFs for several kinds of role.
2. **Be a complete, organized record of my work** in software, audio, and art. Development, Audio, and Art are full archives, not highlight reels, so they can be filtered and each item can be opened for the story behind it.

The repository is public on purpose. It is also a portfolio piece: the way the site is built, tested, and shipped is meant to be read.

## What is on the site

| Page | What it is |
| --- | --- |
| Home | A short introduction and entry points to the rest |
| Resume | Web versions of the resume, with a PDF download for each |
| Development | A filterable archive of software projects, each with its own page: problem, what I built, stack, outcome, links |
| Audio | Recordings from my home studio, with a Bandcamp player for each release, plus studio rates |
| Art | Show flyers, with the story behind each piece one click away |
| Events | The charity music festival and shows I help organize |
| Contact | Email, LinkedIn, and GitHub, with no form |

## How it is built

- **Astro, static output, almost no client-side JavaScript.** Only two pages ship any: Development (the archive filters) and Audio (the filters). Every other page, including Art, ships none. Without JavaScript the filters hide themselves and every item is simply listed, and each release keeps a plain link to Bandcamp.
- **The data is the source of truth.** Everything lives in YAML files read through Astro content collections with strict schemas, so a bad entry fails the build instead of reaching the live site. The schemas enforce the site's own rules: copy uses single hyphens only, no phone numbers, resume bullets start with a past-tense verb, references must resolve, and a bullet must be marked public before it can appear.
- **One resume data set renders everything.** The web pages, a print layout, and every PDF come from the same roles, bullets, skills, and versions, so they cannot drift apart. Each version is a list of bullet references plus a summary and a mode for organization names (real or alternate).
- **PDFs are made in the build.** After the site is built, a script prints each print route to a PDF with headless Chromium through Playwright, and fails the build if a PDF is missing, broken, or runs past two pages.
- **Accessibility by default.** Native `details` and `button` controls instead of scripted ones, real headings and landmarks, a skip link, visible focus, alt text required for every image, light and dark themes, and a phone menu that needs no script.
- **Plain CSS.** A small stylesheet with custom properties, no framework. Fonts are the system fonts, so nothing is requested from a third party.

### Project layout

```
src/
  pages/        one file per page (resume and development use dynamic routes)
  components/   header, footer, the shared archive filters, the resume document, facts strip
  layouts/      the base layout
  lib/          loaders that join content collections and enforce cross-collection rules
  styles/       global.css and the print stylesheet for the PDFs
  data/         site settings and navigation (site.ts), events and studio info (YAML)
    resume/     roles, bullets, summaries, skills, education, and resume versions (YAML)
  content/      one YAML file per item: projects/, releases/, art/
  assets/       images for the art page
  content.config.ts   every collection and its schema
scripts/        PDF generation and the smoke test runner
tests/          the Playwright suite
.github/        workflows and issue and pull request templates
```

## Getting started

You need Node 22.12 or newer.

```bash
npm install
npx playwright install chromium-headless-shell   # once: the browser used for PDFs and tests
npm run dev                                      # local dev server
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Local development server (PDFs are only made by a full build) |
| `npm run build` | Builds the site into `dist/` and prints the resume PDFs |
| `npm run build:site` | Builds the pages only, without the PDFs |
| `npm run preview` | Serves the built site locally |
| `npm test` | Builds, then runs the whole test suite against the local build |
| `npm run test:only` | Runs the suite without rebuilding |
| `npm run test:smoke` | Runs only the short smoke checks against the live site |

## Testing

The Playwright suite runs against the built site and is public on purpose. It reads the same data files the site is built from, so a test can say what a page should contain without a second hand-copied list.

- **Resume and PDFs:** every version renders with exactly its own bullets and skills, print routes carry no site chrome, and each PDF is a real PDF with a sensible page count.
- **Links:** a crawl from the home page checks every link, in-page anchor, and image, requires that no page is orphaned, and checks that each page has a title, one heading, a main landmark, and no console errors.
- **Link previews and the sitemap:** every public page carries Open Graph tags that match its title, description, and address, the preview image exists at 1200 by 630, `robots.txt` points to the sitemap, and the sitemap lists every public page and none of the print routes. There are no Twitter or X tags.
- **Unknown addresses:** a mistyped address returns a real 404 status and shows the site's own page, with the navigation and links back into the site.
- **Interactive behavior:** the filters, the art stories and series, the audio players (Bandcamp is stubbed, so the tests never use the network), and the wide and phone navigation.
- **Accessibility:** axe-core scans of every page in light, dark, and phone width, plus the pages' changing states and keyboard checks for the skip link and focus.
- **Smoke test:** a handful of checks against the deployed site.

A passing suite only means something if it can fail, so each area was checked by breaking the site on purpose (a dead link, a missing heading, a truncated PDF, pale text, players that load by themselves) and confirming the right tests failed.

## Adding content

| To add | Where |
| --- | --- |
| A resume bullet, role, skill, or version | The YAML files in `src/data/resume/` |
| A bullet shared by several versions | Add it to a group in `src/data/resume/bullet-groups.yaml`; a version pulls the group in with `include` |
| A software project | A new YAML file in `src/content/projects/`, following the existing ones |
| A piece of art | See [src/content/art/README.md](src/content/art/README.md) |
| An audio release | See [src/content/releases/README.md](src/content/releases/README.md) |
| Events or studio information | `src/data/events.yaml` and `src/data/studio.yaml` |
| A page in the navigation, or a Home card | `src/data/site.ts` |

Run `npm run build` after any change. If an entry breaks a rule, the build stops and says which file and which field.

## Workflow and deployment

- **Issue first.** Every change starts as a GitHub issue, gets its own branch, and reaches `main` through a pull request. The conventions are written down in [CLAUDE.md](CLAUDE.md).
- **CI** ([ci.yml](.github/workflows/ci.yml)) builds the site and runs the full test suite on every pull request.
- **Deploy** ([deploy.yml](.github/workflows/deploy.yml)) builds the site and publishes it to GitHub Pages on every push to `main`.
- **Smoke test** ([smoke.yml](.github/workflows/smoke.yml)) checks the live site after every deployment, weekly, and on demand. It is a separate workflow so a failure can never block a deployment.

This site was built with an AI coding agent (Claude Code) working inside that workflow, with its changes going through pull requests and the checks above.

## Dependencies

The site depends only on Astro and its official sitemap integration (`@astrojs/sitemap`), which writes `sitemap-index.xml` at build time. The link-preview image `public/images/social-preview.jpg` is generated from the Home photo by `node scripts/make-social-image.mjs`; run it again if the photo, the name, or the colors change.

[Dependabot](.github/dependabot.yml) opens a pull request each week for npm and GitHub Actions updates, so the CI check vets every update before it can merge.

`npm audit` reports one known warning (two lines: the library and Astro, which uses it). It is `http-cache-semantics`, which Astro uses only to cache remote images during the build. This site uses no remote images, and nothing from the library is shipped to visitors. No fix exists: the advisory covers every release up to the newest (4.2.0), the newest Astro already depends on it, and the `npm audit fix --force` suggestion would downgrade Astro to version 2. This is checked again from time to time; once a patched release appears, Dependabot will offer it.

## Content and privacy rules

The repository is public, so some things are kept out on purpose: source material for the resume stays in a private, git-ignored folder and is never committed, only resume bullets marked public appear on the site, there is no phone number, and my location is given only as the Atlanta area.

## License

Everything in this repository is released under the [MIT License](LICENSE): the code, the tests, the workflows, and the site content, including the resume text and the written descriptions. Others are welcome to reuse and adapt it.

The license covers only what is in this repository. It does not cover third-party material that the site links to or embeds, such as Bandcamp players and the releases they play, or the names and marks of the bands, venues, and events shown on the flyers.
