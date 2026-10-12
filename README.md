# Steve Johnson - personal site

**Live site:** https://srjohnson1986.github.io

My personal site, built with [Astro](https://astro.build) and hosted on GitHub Pages. It has two jobs:

1. **Help me get hired.** The Home and Resume pages are written for employers, and the resume is available as a web page and as downloadable PDFs for several kinds of role.
2. **Be a complete, organized record of my work** in software, audio, and art. Development & QA, Audio, and Art are full archives, not highlight reels, so they can be filtered and each item can be opened for the story behind it.

The repository is public on purpose. It is also a portfolio piece: the way the site is built, tested, and shipped is meant to be read.

## What is on the site

| Page | What it is |
| --- | --- |
| Home | A short introduction and entry points to the rest |
| Resume | Web versions of the resume, with a PDF download for each |
| Development & QA | An archive of software projects, filterable by tag, each with its own page: problem, what I built, stack, outcome, links |
| Audio | Recordings from my home studio, with a Bandcamp player for each release, filters by year, band, my role, and genre, plus studio rates |
| Art | Show flyers, newest first, with filters by year, format, band, venue, and tag, a larger view of every image, and the story behind each piece one click away |
| Creative | A short introduction to the creative side of the site, with a card for each page under it (Audio, Art, Jabroni Fest). Copy only for now |
| Jabroni Fest | The annual charity music festival and the smaller shows I help organize (it used to be called Events, and `/events/` still forwards here) |
| Contact | Email, LinkedIn, and GitHub, with no form |

## How it is built

- **Astro, static output, very little client-side JavaScript.** Four things use it: the filters on Development & QA, Audio, and Art (plus the Art sort and larger-image view), the theme button in the header, the Escape key that closes the Creative and Development & QA lists in the header (the lists themselves open with CSS alone), and a tiny inline script that applies a saved theme before the page paints. Without JavaScript the filters hide themselves and every item is simply listed, the Audio players still show, each Art image is a plain link to its larger version, and the page follows the system theme.
- **The data is the source of truth.** Everything lives in YAML files read through Astro content collections with strict schemas, so a bad entry fails the build instead of reaching the live site. The schemas enforce the site's own rules: copy uses single hyphens only, no phone numbers, resume bullets start with a past-tense verb, references must resolve, and a bullet must be marked public before it can appear.
- **One resume data set renders everything.** The web pages, a print layout, and every PDF come from the same roles, bullets, skills, and versions, so they cannot drift apart. Each version is a list of bullet references plus a summary and a mode for organization names (real or alternate).
- **PDFs are made in the build.** After the site is built, a script prints each print route to a PDF with headless Chromium through Playwright, and fails the build if a PDF is missing, broken, or runs past two pages.
- **Accessibility by default.** Native `details` and `button` controls instead of scripted ones, real headings and landmarks, a skip link, visible focus, alt text required for every image, light and dark themes that follow the visitor's system setting (with a header button to switch and remember a choice, which is the only part that needs a script), Creative and Development & QA lists in the header that open on hover or keyboard focus and close with Escape, and a phone menu that needs no script.
- **Plain CSS.** A small stylesheet with custom properties, no framework. The font is Atkinson Hyperlegible Next, chosen for legibility and installed from the `@fontsource` package so the build bundles it. It is served from this site, so nothing is requested from a third party.

### Project layout

```
src/
  pages/        one file per page (resume and development-qa use dynamic routes)
  components/   header, footer, the shared archive filters, the resume document, facts strip
  layouts/      the base layout
  lib/          loaders that join content collections and enforce cross-collection rules; copy-rules.js holds the text rules the schema and the bullet skill share
  styles/       global.css and the print stylesheet for the PDFs
  data/         site settings and navigation (site.ts), page text (intros.yaml), Home cards, events and studio info (YAML)
    resume/     roles, bullets, summaries, skills, education, and resume versions (YAML)
  content/      one YAML file per item: projects/, releases/, art/
  assets/       images for the art page
  content.config.ts   every collection and its schema
scripts/        PDF generation, the icon and link-preview image generators, and the smoke test runner
tests/          the Playwright suite
.claude/agents/ the test-reviewer subagent (see Testing)
.claude/skills/ the add-resume-bullet skill (see Adding a resume bullet with a skill)
docs/          exploratory testing charter, notes template, and session notes (see Exploratory testing)
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

- **Resume and PDFs:** every version renders with exactly its own bullets and skills, print routes carry the version's summary, bullets, and skills and no site chrome, and each PDF is a real PDF with a sensible page count that was printed from its own version (checked through the document title Chromium writes into the file).
- **Resume details:** `tests/resume-details.spec.ts` checks, on every version's web page and print route, that the roles come newest first with each role's bullets in order, that each role shows its dates, title, note, and positions, and that the education and certifications list matches `education.yaml`. With print media emulated (how the PDFs are made), each print route must also show every heading, bullet, skills group, and education entry, in dark text on a white page, within the page width. The date format and the role order are written out again in the test helpers rather than borrowed from the site, so a mistake in the site's version cannot agree with itself.
- **Links:** a crawl from the home page checks every link, in-page anchor, and image, requires that no page is orphaned, and checks that each page has a title, one heading, a main landmark, and no console errors.
- **Link previews and the sitemap:** every public page carries Open Graph tags that match its title, description, and address, the preview image exists at 1200 by 630, `robots.txt` points to the sitemap, and the sitemap lists every public page and none of the print routes. There are no Twitter or X tags.
- **Theme button:** it starts from the system setting, switches and remembers a choice across reloads and pages, works from the keyboard and with storage blocked, is absent without scripts, and never touches the print pages.
- **Page text:** each page's browser title and description, the lines at the top of each page, and the "nothing here" messages match `src/data/intros.yaml`.
- **Contact details and privacy:** `tests/contact.spec.ts` checks that the Contact page and the header of every resume page and print route show the email, LinkedIn, and GitHub links and the area, that the area is exactly "Atlanta area", and that no built page contains a phone number or a `tel:` link.
- **Jabroni Fest page:** `tests/jabroni-fest.spec.ts` checks that the page shows every name, summary, role, fact, "How it runs" point, and cause from `src/data/events.yaml`, and the page description is checked against the summary.
- **Project pages:** `tests/projects.spec.ts` checks that each Development & QA project page shows its title, year and type, summary, facts, problem, every "What I built" and outcome item, every stack chip, and the code and demo links it has (and no button for one it lacks), all read from the project's YAML file.
- **Fonts:** the Atkinson font is bundled, each weight the site uses really loads, and no font comes from another site.
- **Header:** the name, links, and theme button stay in the same place on every page, whatever the page length or the current link.
- **Art order and filters:** the gallery runs newest first by date, and the build rejects a date the sort cannot read. The collapsible panel sorts and filters by year, format, and tag, with bands and venues shown as proper names. Results survive a reload or a shared link, and cards in a row still line up after filtering.
- **Larger view on the Art page:** every image links to a larger version; with scripts on, a click opens it full page, closing with the X, Escape, or a click outside the picture, and focus returns to the image. With scripts off it is a plain link.
- **Site icons:** every public page links the SVG favicon, the ICO fallback, and the Apple touch icon, and each file exists with the right type and size.
- **Unknown addresses:** a mistyped address returns a real 404 status and shows the site's own page, with the navigation and a "Browse all pages" list that groups each section's pages beneath it.
- **Interactive behavior:** the filters, the art stories and series, the audio players (Bandcamp is stubbed, so the tests never use the network), and the wide and phone navigation, including the Creative and Development & QA lists (hover, keyboard, and Escape, with the projects in the same order as the Development & QA page) and the old `/events/` and `/development/` forwards.
- **Accessibility:** axe-core scans of every page in light, dark, and phone width, plus the pages' changing states and keyboard checks for the skip link and focus.
- **The README itself:** `tests/readme.spec.ts` checks that every npm command the README names exists in `package.json` (and the reverse), that its links and the project files it names exist, and that every spec file is described. It cannot judge whether a sentence is still true, so the pull request checklist covers that.
- **Bullet skill:** `tests/add-resume-bullet-skill.spec.ts` runs the skill's check mode against a clean bullet and one bullet per rule, and confirms nothing is written.
- **Smoke test:** a handful of checks against the deployed site.

A passing suite only means something if it can fail, so each area was checked by breaking the site on purpose (a dead link, a missing heading, a truncated PDF, pale text, players that load by themselves) and confirming the right tests failed.

### Reviewing the tests with a subagent

[`.claude/agents/test-reviewer.md`](.claude/agents/test-reviewer.md) defines a Claude Code subagent that reviews the Playwright tests themselves. It looks for four things:

- **Coverage gaps:** pages, data files, or resume versions that no test checks.
- **Weak assertions:** tests that would still pass if the feature broke, such as an existence-only check, or a hard-coded value where the site's data file should be the source.
- **Tests that cannot fail:** each comes with a deliberate break that would prove it works.
- **Likely flaky patterns:** fixed waits, order-dependent tests, and reliance on live third-party content.

It reports findings ranked High, Medium, and Low, each with a file, a line, and a suggested fix. It is read-only: it has only the Read, Grep, and Glob tools (Edit, Write, and Bash are denied), so it never changes a file. For the same reason it cannot run `git`, so give it the files to review. From the repository root in Claude Code:

```text
Use the test-reviewer agent on tests/links.spec.ts and tests/audio.spec.ts
Use the test-reviewer agent on the whole suite
```

For a pull request, pass it the specs the branch changed, which `git diff --name-only main...HEAD tests` lists. Its findings are leads to check against the code, not a gate: it is not part of CI, and it reads the tests without running them. If Claude Code says it cannot find the agent, restart the session so it picks up `.claude/agents/`.

## Exploratory testing with the Playwright MCP server

The Playwright suite checks what I thought to check. Exploratory testing finds what I did not: Claude Code drives a real browser against the live site, follows its nose, and reports anything a visitor or recruiter would trip over. Findings that a test would catch next time then become Playwright tests.

### What MCP is, and how Claude Code connects

The Model Context Protocol (MCP) is an open standard that lets an AI tool call outside programs through a small, uniform interface. An MCP server is such a program: it lists the tools it offers (for example "click this element" or "take a page snapshot"), and the client (Claude Code) calls them when the model decides to. Claude Code starts the server as a child process and talks to it over standard input and output, so nothing is exposed on the network.

### How the setup works here

[`.mcp.json`](.mcp.json) at the repository root is Claude Code's project-scoped MCP configuration, committed so a fresh clone gets the same tools. It starts the Playwright MCP server (`@playwright/mcp`) with `npx`:

- **Pinned version.** The package version is written out, so a new release cannot change the tools underneath a session. Bump it on purpose and re-run a short session.
- **No secrets.** The server needs no account or token, and the file contains none.
- **Headless, isolated Chromium.** `--isolated` gives each session a throwaway browser profile, so no cookies or sign-ins carry over and the site's theme choice starts fresh. Output such as screenshots goes to `.playwright-mcp/`, which is not committed.
- **Not a dependency.** `npx` downloads the server when it first runs; it is not in `package.json`. The browser is the same Chromium that `npx playwright install` already installs for the tests.

The server does not give Claude any more access than a browser has, but a browser can open any address, so Claude Code asks you to approve a project-scoped server the first time you open the project. Claude Code only loads it at the start of a session. On Windows, if Claude Code reports the server as failed to connect, change `"command": "npx"` to `"command": "cmd"` and put `"/c", "npx"` at the start of `args` in a local, uncommitted override (`claude mcp add --scope local`).

### Running an exploratory session

1. Clone the repository, run `claude` in it, and approve the `playwright` server when asked. Check it with `/mcp`.
2. Copy [`docs/exploratory/TEMPLATE.md`](docs/exploratory/TEMPLATE.md) and write a charter: the area, the tools, and what you want to find out. Keep it to one sentence, and set a time box (30 to 60 minutes).
3. Ask Claude to explore the live site to that charter, taking notes as it goes. The browser tools work from the page's accessibility tree rather than pixels, so they can read the page the way a screen reader does, press keys, resize the window, and read the console and network log.
4. Write the notes (covered, found, not covered) next to the template. Be factual: what was done, what happened, what was expected.
5. For each real finding, open an issue. If a test would catch it next time, write the Playwright test first, confirm it fails against the bug, then fix the bug in its own pull request. A deliberate break proves a test of something that is already fine.
6. List what stays manual, with the reason, in the notes.

Past sessions are in [`docs/exploratory/`](docs/exploratory/).

## Adding a resume bullet with a skill

[`.claude/skills/add-resume-bullet/`](.claude/skills/add-resume-bullet/SKILL.md) is a Claude Code skill that adds one resume bullet correctly. Claude reads its short description and uses it when you ask to add a bullet to the resume. You give it the text, the role, and the resume versions (`qa`, `consulting`, `creative`, `adoption`). It then:

1. Checks the bullet before writing anything. The build schema already rejects dashes, phone numbers, and a first word that is not a past-tense verb, and the skill runs those same rules from `src/lib/copy-rules.js` so a bad bullet is stopped early. It adds three things the build does not check: weak opening verbs (Reviewed, Asked, Helped, Worked), a plus sign on project counts (`152+ issues`), and a warning, with unused verbs as alternatives, when the opening verb is already used in the same role.
2. Writes the entry at the end of its role in `bullets.yaml`, keeps the "N bullets" comment right, and adds the id to each version you named in `variants.yaml`.
3. Runs `npm test`, then reports whether each affected version still renders and each PDF is still two pages or fewer.

To see the checks without writing anything, run `node .claude/skills/add-resume-bullet/check-bullet.mjs check --role tpd --versions qa --text "Built ..."`. It prints each problem and exits with 1 if any is an error. Numbers in a bullet still have to come from the private bank or from me; the skill only reminds you of that.

## Adding content

| To add | Where |
| --- | --- |
| A resume bullet, role, skill, or version | The YAML files in `src/data/resume/` |
| A bullet shared by several versions | Add it to a group in `src/data/resume/bullet-groups.yaml`; a version pulls the group in with `include` |
| A software project | A new YAML file in `src/content/projects/`, following the existing ones. Give it a short `navTitle` (30 characters or fewer): it is the name in the header list under Development & QA and the phone menu, and the project appears there on its own |
| A piece of art | See [src/content/art/README.md](src/content/art/README.md) |
| An audio release | See [src/content/releases/README.md](src/content/releases/README.md) |
| Page titles and descriptions, the lines at the top of each page, the 404 text, and the small messages (nothing here, no results). Write `{name}` and `{area}` to fill them from `site.ts`, and `[words](/page/)` for a link to a page or section of this site | `src/data/intros.yaml` |
| A card under "Explore" on the Home page | `src/data/home-cards.yaml` |
| Jabroni Fest or studio information | `src/data/events.yaml` and `src/data/studio.yaml` |
| A page in the navigation, or under Creative in the header list and phone menu | `src/data/site.ts` (an item with `children` is a section). The pages under Development & QA are the projects, so they are not listed there |

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

[Dependabot](.github/dependabot.yml) opens a pull request each Monday for npm and GitHub Actions updates, waiting 3 days after a release before proposing it. The [auto-merge workflow](.github/workflows/dependabot-auto-merge.yml) queues a merge on each one, so the CI check decides: green merges (and deploys), red waits. A weekly Claude routine, `website-dependency-repair`, runs in the Claude cloud rather than in this repository. It repairs red Dependabot pull requests by pushing a fix to their branch, and labels any it cannot fix `needs-human`. It never merges anything itself.

`npm audit` reports one known warning (two lines: the library and Astro, which uses it). It is `http-cache-semantics`, which Astro uses only to cache remote images during the build. This site uses no remote images, and nothing from the library is shipped to visitors. No fix exists: the advisory covers every release up to the newest (4.2.0), the newest Astro already depends on it, and the `npm audit fix --force` suggestion would downgrade Astro to version 2. This is checked again from time to time; once a patched release appears, Dependabot will offer it.

## Content and privacy rules

The repository is public, so some things are kept out on purpose: source material for the resume stays in a private, git-ignored folder and is never committed, only resume bullets marked public appear on the site, there is no phone number, and my location is given only as the Atlanta area.

## License

Everything in this repository is released under the [MIT License](LICENSE): the code, the tests, the workflows, and the site content, including the resume text and the written descriptions. Others are welcome to reuse and adapt it.

The license covers only what is in this repository. It does not cover third-party material that the site links to or embeds, such as Bandcamp players and the releases they play, or the names and marks of the bands, venues, and events shown on the flyers.
