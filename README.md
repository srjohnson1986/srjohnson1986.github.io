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
| Development | An archive of software projects, filterable by tag, each with its own page: problem, what I built, stack, outcome, links |
| Audio | Recordings from my home studio, with a Bandcamp player for each release, filters by year, band, my role, and genre, plus studio rates |
| Art | Show flyers, newest first, with filters by year, format, band, venue, and tag, a larger view of every image, and the story behind each piece one click away |
| Events | The charity music festival and shows I help organize |
| Contact | Email, LinkedIn, and GitHub, with no form |

## How it is built

- **Astro, static output, very little client-side JavaScript.** Three things use it: the filters on Development, Audio, and Art (plus the Art sort and larger-image view), the theme button in the header, and a tiny inline script that applies a saved theme before the page paints. Without JavaScript the filters hide themselves and every item is simply listed, the Audio players still show, each Art image is a plain link to its larger version, and the page follows the system theme.
- **The data is the source of truth.** Everything lives in YAML files read through Astro content collections with strict schemas, so a bad entry fails the build instead of reaching the live site. The schemas enforce the site's own rules: copy uses single hyphens only, no phone numbers, resume bullets start with a past-tense verb, references must resolve, and a bullet must be marked public before it can appear.
- **One resume data set renders everything.** The web pages, a print layout, and every PDF come from the same roles, bullets, skills, and versions, so they cannot drift apart. Each version is a list of bullet references plus a summary and a mode for organization names (real or alternate).
- **PDFs are made in the build.** After the site is built, a script prints each print route to a PDF with headless Chromium through Playwright, and fails the build if a PDF is missing, broken, or runs past two pages.
- **Accessibility by default.** Native `details` and `button` controls instead of scripted ones, real headings and landmarks, a skip link, visible focus, alt text required for every image, light and dark themes that follow the visitor's system setting (with a header button to switch and remember a choice, which is the only part that needs a script), and a phone menu that needs no script.
- **Plain CSS.** A small stylesheet with custom properties, no framework. The font is Atkinson Hyperlegible Next, chosen for legibility and installed from the `@fontsource` package so the build bundles it. It is served from this site, so nothing is requested from a third party.

### Project layout

```
src/
  pages/        one file per page (resume and development use dynamic routes)
  components/   header, footer, the shared archive filters, the resume document, facts strip
  layouts/      the base layout
  lib/          loaders that join content collections and enforce cross-collection rules
  styles/       global.css and the print stylesheet for the PDFs
  data/         site settings and navigation (site.ts), page text (intros.yaml), Home cards, events and studio info (YAML)
    resume/     roles, bullets, summaries, skills, education, and resume versions (YAML)
  content/      one YAML file per item: projects/, releases/, art/
  assets/       images for the art page
  content.config.ts   every collection and its schema
scripts/        PDF generation, the icon and link-preview image generators, and the smoke test runner
tests/          the Playwright suite
.vscode/        maps each YAML file to its schema, for autocomplete and checking in VS Code
.github/        workflows, Dependabot settings, and issue and pull request templates
```

## Getting started

You need Node 22.12 or newer.

```bash
npm install
npx playwright install chromium-headless-shell   # once: the browser used for PDFs and tests
npm run dev                                      # local dev server
```

In VS Code, the YAML files autocomplete and flag mistakes as you type, using schemas that Astro generates into `.astro/collections/` (not committed). On a fresh clone, run `npm run astro -- sync` once to create them; `dev` and `build` also refresh them.

| Command | What it does |
| --- | --- |
| `npm run astro -- sync` | Generates the collection schemas that VS Code uses for the YAML files |
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
- **Theme button:** it starts from the system setting, switches and remembers a choice across reloads and pages, works from the keyboard and with storage blocked, is absent without scripts, and never touches the print pages.
- **Page text:** each page's browser title and description, the lines at the top of each page, and the "nothing here" messages match `src/data/intros.yaml`.
- **Fonts:** the Atkinson font is bundled, each weight the site uses really loads, and no font comes from another site.
- **Header:** the name, links, and theme button stay in the same place on every page, whatever the page length or the current link.
- **Art order and filters:** the gallery runs newest first by date, and the build rejects a date the sort cannot read. The collapsible panel sorts and filters by year, format, and tag, with bands and venues shown as proper names. Results survive a reload or a shared link, and cards in a row still line up after filtering.
- **Larger view on the Art page:** every image links to a larger version; with scripts on, a click opens it full page, closing with the X, Escape, or a click outside the picture, and focus returns to the image. With scripts off it is a plain link.
- **Site icons:** every public page links the SVG favicon, the ICO fallback, and the Apple touch icon, and each file exists with the right type and size.
- **Unknown addresses:** a mistyped address returns a real 404 status and shows the site's own page, with the navigation and links back into the site.
- **Interactive behavior:** the filters, the art stories and series, the audio players (Bandcamp is stubbed, so the tests never use the network), and the wide and phone navigation.
- **Accessibility:** axe-core scans of every page in light, dark, and phone width, plus the pages' changing states and keyboard checks for the skip link and focus.
- **The README itself:** `tests/readme.spec.ts` checks that every npm command the README names exists in `package.json` (and the reverse), that its links and the project files it names exist, and that every spec file is described. It cannot judge whether a sentence is still true, so the pull request checklist covers that.
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
| Page titles and descriptions, the lines at the top of each page, the 404 text, and the small messages (nothing here, no results). Write `{name}` and `{area}` to fill them from `site.ts`, and `[words](/page/)` for a link to a page or section of this site | `src/data/intros.yaml` |
| A card under "Explore" on the Home page | `src/data/home-cards.yaml` |
| Events or studio information | `src/data/events.yaml` and `src/data/studio.yaml` |
| A page in the navigation | `src/data/site.ts` |

Run `npm run build` after any change. If an entry breaks a rule, the build stops and says which file and which field.

## Workflow and deployment

- **Issue first.** Every change starts as a GitHub issue, gets its own branch, and reaches `main` through a pull request. The conventions are written down in [CLAUDE.md](CLAUDE.md).
- **Keep this README current.** Each pull request either updates the README when it changes something the README describes (a page, a feature, a command, a dependency, a test area) or says in its description why no update was needed. The [pull request template](.github/pull_request_template.md) has a checkbox for it.
- **CI** ([ci.yml](.github/workflows/ci.yml)) builds the site and runs the full test suite on every pull request.
- **Deploy** ([deploy.yml](.github/workflows/deploy.yml)) builds the site and publishes it to GitHub Pages on every push to `main`.
- **Smoke test** ([smoke.yml](.github/workflows/smoke.yml)) checks the live site after every deployment, weekly, and on demand. It is a separate workflow so a failure can never block a deployment.

This site was built with an AI coding agent (Claude Code) working inside that workflow, with its changes going through pull requests and the checks above.

## Dependencies

The site depends only on Astro, its official sitemap integration (`@astrojs/sitemap`), which writes `sitemap-index.xml` at build time, and the Atkinson Hyperlegible Next font package (`@fontsource/atkinson-hyperlegible-next`). Playwright (which also prints the PDFs in the build), axe-core, and js-yaml (which lets the tests read the data files) are development tools and are not shipped to visitors. The link-preview image `public/images/social-preview.jpg` is generated from the Home photo by `node scripts/make-social-image.mjs`; run it again if the photo, the name, or the colors change. The site icons (an "SJ" monogram in the accent color) come from `node scripts/make-icons.mjs`.

[Dependabot](.github/dependabot.yml) opens a pull request each week for npm and GitHub Actions updates, so the CI check vets every update before it can merge.

`npm audit` reports one known warning (two lines: the library and Astro, which uses it). It is `http-cache-semantics`, which Astro uses only to cache remote images during the build. This site uses no remote images, and nothing from the library is shipped to visitors. No fix exists: the advisory covers every release up to the newest (4.2.0), the newest Astro already depends on it, and the `npm audit fix --force` suggestion would downgrade Astro to version 2. This is checked again from time to time; once a patched release appears, Dependabot will offer it.

## Content and privacy rules

The repository is public, so some things are kept out on purpose: source material for the resume stays in a private, git-ignored folder and is never committed, only resume bullets marked public appear on the site, there is no phone number, and my location is given only as the Atlanta area.

## License

Everything in this repository is released under the [MIT License](LICENSE): the code, the tests, the workflows, and the site content, including the resume text and the written descriptions. Others are welcome to reuse and adapt it.

The license covers only what is in this repository. It does not cover third-party material that the site links to or embeds, such as Bandcamp players and the releases they play, or the names and marks of the bands, venues, and events shown on the flyers.
