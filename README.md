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

- **Astro, static output, very little client-side JavaScript.** Four things use it: the filters on Development & QA, Audio, and Art (plus the Art sort and larger-image view), the theme button in the header, the Escape key that closes the Creative and Development & QA lists and the phone menu in the header (the lists and the menu themselves open with CSS and native `details` alone), and a tiny inline script that applies a saved theme before the page paints. Without JavaScript the filters hide themselves and every item is simply listed, the Audio players still show, each Art image is a plain link to its larger version, and the page follows the system theme.
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
  data/         site settings and navigation (site.ts), page text (intros.yaml), Home cards, events and studio info (YAML), and the project totals (site-stats.json)
    resume/     roles, bullets, summaries, skills, education, resume versions, the lane list, and the lane data imported from the bank (YAML)
  content/      one YAML file per item: projects/, releases/, art/
  assets/       images for the art page
  content.config.ts   every collection and its schema
scripts/        PDF generation, the icon and link-preview image generators, the smoke test runner, the requirements traceability report, and the site-totals collection (site-stats.mjs) and Postman collection builder
contracts/      JSON Schemas for the GitHub API answers the site-totals script uses and for src/data/site-stats.json
postman/        the Postman collection of the live API checks, run with Newman
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
| `npm run fit-lanes` | Measures each lane resume and saves how many cuts it takes to fit two pages (`-- --check` only verifies the saved fits; see Lane resumes) |
| `npm run traceability` | Builds the requirements traceability matrix from the last full test run and GitHub, and fails if a requirement has no test or a tag has no requirement (see Requirements traceability) |
| `npm run import-lanes` | Checks the private resume bullet bank and reports what it would import (lane tags, role ranks, combined bullets); add `-- --write` to update the YAML (see Importing lane data from the bank) |

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
- **Project pages:** `tests/projects.spec.ts` checks that each Development & QA project page shows its title, year and type, summary, facts, problem, every "What I built" and outcome item, every stack chip, and the code, demo, and report links it has (and no button for one it lacks), all read from the project's YAML file.
- **Fonts:** the Atkinson font is bundled, each weight the site uses really loads, and no font comes from another site.
- **Header:** the name, links, and theme button stay in the same place on every page, whatever the page length or the current link.
- **Art order and filters:** the gallery runs newest first by date, and the build rejects a date the sort cannot read. The collapsible panel sorts and filters by year, format, and tag, with bands and venues shown as proper names. Results survive a reload or a shared link (a value in a link that a drop-down does not offer is ignored, so no drop-down is ever blank on Audio or Art), and cards in a row still line up after filtering.
- **Larger view on the Art page:** every image links to a larger version; with scripts on, a click opens it full page, closing with the X, Escape, or a click outside the picture, and focus returns to the image. With scripts off it is a plain link.
- **Site icons:** every public page links the SVG favicon, the ICO fallback, and the Apple touch icon, and each file exists with the right type and size.
- **Unknown addresses:** a mistyped address returns a real 404 status and shows the site's own page, with the navigation and a "Browse all pages" list that groups each section's pages beneath it.
- **Interactive behavior:** the filters, the art stories and series, the audio players (Bandcamp is stubbed, so the tests never use the network), and the wide and phone navigation (Escape closes the phone menu and returns focus to its button), including the Creative and Development & QA lists (hover, keyboard, and Escape, with the projects in the same order as the Development & QA page) and the old `/events/` and `/development/` forwards. The Back button is checked too: from the resume it returns to where the visitor came from (the `/resume/` redirect does not trap it), and changing a filter adds no history entries.
- **Accessibility:** axe-core scans of every page in light, dark, and phone width, plus the pages' changing states and keyboard checks for the skip link and focus.
- **The README itself:** `tests/readme.spec.ts` checks that every npm command the README names exists in `package.json` (and the reverse), that its links and the project files it names exist, and that every spec file is described. It cannot judge whether a sentence is still true, so the pull request checklist covers that.
- **Bullet skill:** `tests/add-resume-bullet-skill.spec.ts` runs the skill's check mode against a clean bullet and one bullet per rule, and confirms nothing is written.
- **Lane import:** `tests/import-lanes.spec.ts` runs `scripts/import-lanes.mjs` on a small made-up bank (never the private one) in a temporary folder: a clean check writes nothing, `--write` sets lane tags, role ranks, and combined bullets and keeps comments and line endings, a second run changes nothing, and each kind of bad tag, heading, or combined bullet exits with an error and writes nothing. No browser needed.
- **Lane resumes:** `tests/lane-resumes.spec.ts` checks, for every lane, that its print route shows exactly the bullets its saved fit says (by role newest first, in tier and position order, never a bullet the lane is not tagged for), every tier 1 bullet, the role floors, the lane summary, skills, and real organization names, that its PDF is two pages or fewer, that the content ends before the end of page 2, and that the page is kept out of search, the sitemap, and every link. It also checks that the pages used to measure the lanes are not part of the site.
- **Lane fit plan:** `tests/lane-fit.spec.ts` checks `src/lib/lane-fit.js`, which decides which bullets a lane resume starts with and the order they are given up in to fit two pages: combined bullets are swapped in first, then tier 3 and tier 2 are cut starting with the least relevant role and the lowest position, tier 1 is never cut, and a role never goes below its floor. It runs on small made-up data, one rule at a time, and on the real data for all six lanes. No browser needed.
- **Lane data:** `tests/lane-data.spec.ts` runs the checks in `src/lib/lane-data.js` (the same code the build runs) on the real data files and on one broken case per rule: unknown lanes, partial role ranks, and combined bullets that point at missing bullets, mix roles, or are used in a lane where a bullet they replace is not tagged. No browser needed.
- **Private bank content:** `tests/bank-private.spec.ts` checks that no built page shows a private section name from the bank (Target Roles, the behavioral stories, the application answers), that no private file is copied into `dist/`, and, when the local bank snapshot is present, that none of its story titles appear on a page.
- **Bullet verbs:** `tests/bullet-verbs.spec.ts` checks the past-tense verb rule on examples, on every bullet and combined bullet in the real data, and that the content schema applies it. No browser needed.
- **Site totals (API and contract):** `tests/site-stats.spec.ts`, `tests/site-stats-postman.spec.ts`, and the weekly `tests/site-stats-live.spec.ts`; see API and contract tests for the site totals. No browser needed.
- **Traceability:** `tests/traceability.spec.ts` checks the requirements traceability check on made-up data (see Requirements traceability). No browser needed.
- **Smoke test:** a handful of checks against the deployed site, including that the traceability report was published.

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

## Requirements traceability

Requirements traceability links every requirement to the tests that verify it, and every test back to a requirement. It answers two questions: which requirements have no test, and which tests protect nothing anyone asked for. Here the links are checked by a script, so the answer cannot go stale.

**What a requirement is.** A GitHub issue with the `requirement` label and a title that starts with `REQ:`. Its body has a `## Requirement` sentence and a `## Acceptance criteria` checklist (the [requirement template](.github/ISSUE_TEMPLATE/requirement.md) sets it up). It describes a behavior the site must keep, not a piece of work, so it stays open while it is in force. A pull request refers to it with `Refs #N`, not `Closes #N`. A requirement closed as "not planned" is retired and ignored; one closed as completed still counts. The ordinary change issues (the "Why, Scope, Done when" template) are history, not requirements.

**How a test names its requirement.** With Playwright's built-in tags, on a test or on a `test.describe` (the tests inside inherit it):

```ts
test.describe('Contact details', { tag: ['@req-337'] }, () => { ... });
test('the email is a mailto link', { tag: ['@req-337', '@req-338'] }, async ({ page }) => { ... });
```

`@req-N` is the issue number. A test may verify several requirements. `npx playwright test --grep @req-337` runs one requirement's tests.

**What is checked.** `npm run traceability` (and CI, after the suite) reads the tags from the Playwright results (`traceability/results.json`, written by every run) and the requirements from GitHub, and fails when:

- a requirement has no linked test and no exemption;
- a requirement has the `no-automated-test` label but no written reason (a `## No automated test - reason` section in its body);
- a test is tagged with a number that is not a requirement (no such issue, an issue without the `requirement` label, or a retired requirement);
- a test has no requirement tag.

The `no-automated-test` label is for things that stay manual, such as a judgment call or a repository setting. The reason says why a test cannot check it and how it is verified instead. The smoke tests run only against the live site, so the script lists them without running them and shows them as "not run" in a normal run.

**The report.** The script writes `traceability/traceability.md` and `traceability/traceability.html` (requirement, coverage, linked tests, last result). CI adds the markdown to the job summary and keeps both files as the `traceability` artifact. The deploy workflow runs the suite after building the site and puts the HTML on the live site at [/development-qa/this-site/traceability/](https://srjohnson1986.github.io/development-qa/this-site/traceability/), linked from the This site project page. In the repository that page is a stand-in, so a local build still has a page for the link to reach. To see the real matrix locally, run `npm test` and then `npm run traceability`. A partial run (for example one spec) makes every other requirement look untested, so run the whole suite first.

**Adding a feature.**

1. Open a requirement issue (`REQ: ...`, with the `requirement` label and acceptance criteria) and note its number. Open the usual change issue for the work, which can mention the requirement.
2. Write the test in the spec for that area and tag it `{ tag: ['@req-N'] }`. Break the feature on purpose to check that the test can fail.
3. In the pull request, use `Refs #N` for the requirement. If it cannot be automated, add the `no-automated-test` label and the written reason instead.
4. CI fails until every requirement has a test or a reason and every tag points at a real requirement.

`tests/traceability.spec.ts` tests the check itself on made-up requirements and results: each failure above, the exemption, the retired and closed cases, and the exit codes. The logic is in `scripts/lib/traceability.mjs` and the command line in `scripts/traceability.mjs`.

## API and contract tests for the site totals

The project totals (issues, pull requests, merged pull requests, commits, releases, lines of code, and Playwright tests) come from the GitHub API. [`scripts/site-stats.mjs`](scripts/site-stats.mjs) collects them and writes [`src/data/site-stats.json`](src/data/site-stats.json). It is the code the weekly Claude routine `website-site-stats` runs (see below), so the numbers that go into the resume bank pass through the checks described here first.

**How the collection works.** It makes six GitHub API calls (the repository, then issues, pull requests, merged pull requests, commits, and releases) and reuses each answer within a run. Every answer is checked against a JSON Schema in [`contracts/`](contracts/), and the schemas list only the fields the script uses, so a harmless new field in GitHub's answer does not break anything. The final data is checked against `contracts/site-stats.schema.json`. A bad answer stops the script with one clear line and a non-zero exit, and nothing is written. Counts for issues, pull requests, merged pull requests, commits, and releases may never be lower than the committed file, because a drop means a wrong or partial answer. Lines of code and test counts are allowed to fall, since deleting code is normal.

**What is tested.**

- **On every pull request (no network):** `tests/site-stats.spec.ts` runs the script's code against recorded GitHub answers (`tests/fixtures/github-api/good.json`) and a local stand-in server. It checks that each recorded answer and the committed data file match their schemas, and that the failure cases each stop the run with a clear message: a missing field, a wrong type, a negative count, an empty commit list, an incomplete search, an answer that is not JSON, a different repository, a rate-limit answer (403 or 429, with the reset time), a 404, a rejected token, a server error, and a network failure. It also checks that a failed run leaves the file untouched, that a count lower than the committed value is refused, that a run makes six calls and reuses answers, and that the token is sent only as a header and never appears in any output. `tests/site-stats-postman.spec.ts` checks that the Postman collection matches the script's endpoints and the schemas and holds no secret.
- **Weekly and on demand (real API):** `tests/site-stats-live.spec.ts` uses Playwright's `request` fixture against the real endpoints. It checks the status codes, the schemas, that the searches are complete, that counts are non-negative integers, that merged pull requests do not exceed all pull requests, that no count is lower than the committed file, and that the rate limit has room. The [API live workflow](.github/workflows/api-live.yml) runs it on Mondays and by manual dispatch, never on a pull request, with the token Actions already provides. The same workflow then runs the Postman collection with Newman, so the same checks exist both ways. They are redundant on purpose, to show both approaches. Live calls come to twelve a week.

**Running it.**

```bash
npm run site-stats
```

collects and checks the totals without writing anything (add `-- --write` to save `src/data/site-stats.json`; run `npm run build` first, because the test count comes from `playwright test --list`). Set `GITHUB_TOKEN` to raise the rate limit; the token is never printed. The live checks run with `npm run test:api-live`. `npm run postman` rewrites the Postman collection from the script's endpoints and the schemas, and the collection runs with `npx newman@6.2.3 run postman/site-stats.postman_collection.json --env-var token=$GITHUB_TOKEN`, optionally with `--env-var min_issues=N` (and `min_pull_requests`, `min_pull_requests_merged`, `min_commits`, `min_releases`) for the never-lower checks. The mocked tests run with the rest of the suite in `npm test`.

**The routine.** `website-site-stats` is a Claude routine that runs each Monday in the Claude cloud, not in this repository. It runs `node scripts/site-stats.mjs --json` in its clone and uses the checked numbers to refresh the Totals sentence in the private bank. It changes nothing in the repository. The file `src/data/site-stats.json` is refreshed by running the script with `--write` and opening a pull request.

## Exploratory testing with the Playwright MCP server

The Playwright suite checks what I thought to check. Exploratory testing finds what I did not: Claude Code drives a real browser against the live site, follows its nose, and reports anything a visitor or recruiter would trip over. Findings that a test would catch next time then become Playwright tests.

### What MCP is, and how Claude Code connects

The Model Context Protocol (MCP) is an open standard that lets an AI tool call outside programs through a small, uniform interface. An MCP server is such a program: it lists the tools it offers (for example "click this element" or "take a page snapshot"), and the client (Claude Code) calls them when the model decides to. Claude Code starts the server as a child process and talks to it over standard input and output, so nothing is exposed on the network.

### How the setup works here

[`.mcp.json`](.mcp.json) at the repository root is Claude Code's project-scoped MCP configuration, committed so a fresh clone gets the same tools. It starts the Playwright MCP server (`@playwright/mcp`) with `npx`:

- **Pinned version.** The package version is written out, so a new release cannot change the tools underneath a session. Bump it on purpose and re-run a short session.
- **No secrets.** The server needs no account or token, and the file contains none.
- **Headless, isolated Chromium.** `--isolated` gives each session a throwaway browser profile, so no cookies or sign-ins carry over and the site's theme choice starts fresh. Output such as screenshots goes to `.playwright-mcp/`, which is not committed.
- **Not a dependency.** `npx` downloads the server when it first runs; it is not in `package.json`. The browser is not shared with the tests: the server brings its own Playwright, so it needs its own Chromium build, installed once (see below).

The server does not give Claude any more access than a browser has, but a browser can open any address, so Claude Code asks you to approve a project-scoped server the first time you open the project. Claude Code only loads it at the start of a session. Plain `npx` works as the command on Windows 11 (tested). If Claude Code ever reports the server as failed to connect on Windows, change `"command": "npx"` to `"command": "cmd"` and put `"/c", "npx"` at the start of `args` in a local, uncommitted override (`claude mcp add --scope local`).

### Running an exploratory session

1. Clone the repository and install the server's browser once. It downloads about 120 MB into your user profile (the `ms-playwright` folder), not the repository, and without it the first browser call fails with "Browser is not installed":

   ```bash
   npx @playwright/mcp@0.0.83 install-browser chrome-for-testing
   ```

   Use the version pinned in `.mcp.json`; a test keeps this number in step with it.
2. Run `claude` in the repository and approve the `playwright` server when asked. Check it with `/mcp`.
3. Copy [`docs/exploratory/TEMPLATE.md`](docs/exploratory/TEMPLATE.md) and write a charter: the area, the tools, and what you want to find out. Keep it to one sentence, and set a time box (30 to 60 minutes).
4. Ask Claude to explore the live site to that charter, taking notes as it goes. The browser tools work from the page's accessibility tree rather than pixels, so they can read the page the way a screen reader does, press keys, resize the window, and read the console and network log.
5. Write the notes (covered, found, not covered) next to the template. Be factual: what was done, what happened, what was expected.
6. For each real finding, open an issue. If a test would catch it next time, write the Playwright test first, confirm it fails against the bug, then fix the bug in its own pull request. A deliberate break proves a test of something that is already fine.
7. List what stays manual, with the reason, in the notes.

Past sessions are in [`docs/exploratory/`](docs/exploratory/).

## Adding a resume bullet with a skill

[`.claude/skills/add-resume-bullet/`](.claude/skills/add-resume-bullet/SKILL.md) is a Claude Code skill that adds one resume bullet correctly. Claude reads its short description and uses it when you ask to add a bullet to the resume. You give it the text, the role, and the resume versions (`qa`, `consulting`, `creative`, `adoption`). It then:

1. Checks the bullet before writing anything. The build schema already rejects dashes, phone numbers, and a first word that is not a past-tense verb, and the skill runs those same rules from `src/lib/copy-rules.js` so a bad bullet is stopped early. It adds three things the build does not check: weak opening verbs (Reviewed, Asked, Helped, Worked), a plus sign on project counts (`152+ issues`), and a warning, with unused verbs as alternatives, when the opening verb is already used in the same role.
2. Writes the entry at the end of its role in `bullets.yaml`, keeps the "N bullets" comment right, and adds the id to each version you named in `variants.yaml`.
3. Runs `npm test`, then reports whether each affected version still renders and each PDF is still two pages or fewer.

To see the checks without writing anything, run `node .claude/skills/add-resume-bullet/check-bullet.mjs check --role tpd --versions qa --text "Built ..."`. It prints each problem and exits with 1 if any is an error. Numbers in a bullet still have to come from the private bank or from me; the skill only reminds you of that.

## Importing lane data from the bank

The per-lane resumes need to know which bullets belong to which job lane, how relevant each role is to each lane, and which combined bullets can replace several bullets to save space. That lives in my private resume bullet bank (never committed), so `scripts/import-lanes.mjs` reads the bank on my machine and writes the result into the committed YAML (`lanes` on each bullet, `lane_rank` on each role, and `combos.yaml`).

```bash
npm run import-lanes                       # check: print a report, write nothing
npm run import-lanes -- --write            # write the lane data
npm run import-lanes -- --write --apply-text   # also copy changed bullet wording from the bank
```

The check exits with an error, and a write changes nothing, when the bank has a hard problem: an unknown id or lane, a tier outside 1 to 3, a role heading missing a rank, a public bullet with no tagged line, or a combined bullet that points at missing bullets, mixes roles, or is used in a lane where a bullet it replaces is not tagged. Running it twice changes nothing the second time. `tests/import-lanes.spec.ts` checks all of this against a small made-up bank in `tests/fixtures/lanes/`.

## Lane resumes

Besides the hand-written resume versions, the build makes one generic resume per job lane (QA, SDET, Implementation / Consulting, Adoption / Training, PM / BA, IT) from the lane data imported from the bank. Each is at `/resume/print/lane-<id>/` and as a PDF named `steve-johnson-resume-lane-<id>.pdf`. They are not linked from the site yet (placeholder summaries and skills are still in place), are kept out of search, and are not in the sitemap.

A lane starts with every public bullet tagged for it, tier 1 first and then by position within each role, and is trimmed until it fits two pages: first combined bullets are swapped in, then tier 3 and tier 2 are cut starting with the least relevant role and the lowest position, tier 1 is never cut, and each role keeps at least its floor (`role_floor` in `lanes.yaml`). The order is in `src/lib/lane-fit.js`. `npm run fit-lanes` builds a throwaway copy of the site with a fit page per lane, prints it to PDF with headless Chromium, and searches for the fewest cuts that fit with a margin of a couple of lines. It saves the answer in `src/data/resume/lane-fit.yaml` along with a fingerprint of everything that decides the layout, and writes what each lane keeps and drops to the private folder. If tier 1 and the floors alone do not fit, it stops and flags the lane instead of cutting.

The build refuses to run on a stale fit: changing a bullet, its tags, a rank, a combined bullet, a summary, a skill, or `print.css` means running `npm run fit-lanes` and committing `lane-fit.yaml`. CI runs `npm run fit-lanes -- --check`, which checks that each saved fit is current and still fits.

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
- **CI** ([ci.yml](.github/workflows/ci.yml)) builds the site runs the full test suite, and checks requirements traceability on every pull request.
- **Deploy** ([deploy.yml](.github/workflows/deploy.yml)) builds the site, runs the suite to build the requirements traceability matrix, and publishes both to GitHub Pages on every push to `main`.
- **API live** ([api-live.yml](.github/workflows/api-live.yml)) runs the live GitHub API contract checks and the Newman run weekly and on demand, and never on a pull request.
- **Smoke test** ([smoke.yml](.github/workflows/smoke.yml)) checks the live site after every deployment, weekly, and on demand. It is a separate workflow so a failure can never block a deployment.

This site was built with an AI coding agent (Claude Code) working inside that workflow, with its changes going through pull requests and the checks above.

## Dependencies

The site depends only on Astro, its official sitemap integration (`@astrojs/sitemap`), which writes `sitemap-index.xml` at build time, and the Atkinson Hyperlegible Next font package (`@fontsource/atkinson-hyperlegible-next`). Playwright (which also prints the PDFs in the build), axe-core, js-yaml (which lets the tests read the data files), and Ajv (a JSON Schema validator for the site-totals contracts) are development tools and are not shipped to visitors. The link-preview image `public/images/social-preview.jpg` is generated from the Home photo by `node scripts/make-social-image.mjs`; run it again if the photo, the name, or the colors change. The site icons (an "SJ" monogram in the accent color) come from `node scripts/make-icons.mjs`.

[Dependabot](.github/dependabot.yml) opens a pull request each Monday for npm and GitHub Actions updates, waiting 3 days after a release before proposing it. The [auto-merge workflow](.github/workflows/dependabot-auto-merge.yml) queues a merge on each one, so the CI check decides: green merges (and deploys), red waits. A weekly Claude routine, `website-dependency-repair`, runs in the Claude cloud rather than in this repository. It repairs red Dependabot pull requests by pushing a fix to their branch, and labels any it cannot fix `needs-human`. It never merges anything itself.

`npm audit` reports one known warning (two lines: the library and Astro, which uses it). It is `http-cache-semantics`, which Astro uses only to cache remote images during the build. This site uses no remote images, and nothing from the library is shipped to visitors. No fix exists: the advisory covers every release up to the newest (4.2.0), the newest Astro already depends on it, and the `npm audit fix --force` suggestion would downgrade Astro to version 2. This is checked again from time to time; once a patched release appears, Dependabot will offer it.

## Content and privacy rules

The repository is public, so some things are kept out on purpose: source material for the resume stays in a private, git-ignored folder and is never committed, only resume bullets marked public appear on the site, there is no phone number, and my location is given only as the Atlanta area.

## License

Everything in this repository is released under the [MIT License](LICENSE): the code, the tests, the workflows, and the site content, including the resume text and the written descriptions. Others are welcome to reuse and adapt it.

The license covers only what is in this repository. It does not cover third-party material that the site links to or embeds, such as Bandcamp players and the releases they play, or the names and marks of the bands, venues, and events shown on the flyers.
