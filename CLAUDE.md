# Project notes for Claude Code

Personal portfolio site for Steve Johnson (GitHub: srjohnson1986). Astro, hosted on GitHub Pages. The repo is public.

Read `PROJECT_BRIEF.md` (kept in `private/`) for goals, pages, and privacy rules. Private inputs live in `private/` and are never committed or published.

## Standing conventions

- Use only single hyphens in any text you write for me. No em dashes, no en dashes, and no double hyphens in prose or copy.
- Resume and LinkedIn bullets start with a strong, past-tense, action-oriented verb, with generally varied verbs across bullets (a goal, not enforced: the build warns about repeats and never fails on them).
- Keep changes small and reviewable. Prefer one concern per pull request.
- Don't add dependencies without telling me why.
- Never commit anything from `private/`.
- Explain non-obvious choices briefly, since I'm learning the toolchain.
- Ask me before big decisions rather than guessing.

## Commands

- `npm install` - install dependencies
- `npm run astro -- sync` - generate the collection schemas in `.astro/collections/` that VS Code uses to autocomplete and check the YAML files (see `.vscode/settings.json`); run once on a fresh clone, since `.astro/` is not committed. `dev` and `build` also regenerate them
- `npm run dev` - local dev server (use `astro dev --background` when started by Claude; manage with `astro dev stop|status|logs`)
- `npm run build` - build to `dist/`
- `npm run preview` - serve the built site locally
- `npm test` - build, then run the whole Playwright suite against the local build
- `npm run test:only` - run the suite without rebuilding (build first with `npm run build`)
- `npm run test:smoke` - run only the smoke checks against the deployed site (`SMOKE_URL` points them elsewhere)
- `npm run fit-lanes` - measure each lane resume and save how many cuts it takes to fit two pages in `src/data/resume/lane-fit.yaml` (builds a throwaway copy of the site, so it takes a minute). Run it after any change to lane bullets, tags, ranks, combined bullets, wording, summaries, skills, or `print.css`; the build fails on a stale fit. `-- --check` verifies the saved fits without writing and runs in CI. If tier 1 and the role floors do not fit, it stops and flags the lane: tell Steve, never cut tier 1
- `npm run traceability` - build the requirements traceability matrix from the last full test run (`traceability/results.json`) and the GitHub requirement issues, write `traceability/traceability.md` and `.html`, and exit 1 if a requirement has no test or written reason, a test names a requirement that does not exist, or a test has no `@req-N` tag. Run `npm test` first: a partial run makes other requirements look untested
- `npm run site-stats` - collect the project totals from the GitHub API (six calls), check them against the schemas in `contracts/`, and print them; add `-- --write` to save `src/data/site-stats.json` (run `npm run build` first for the test count). It refuses to write on any bad answer or any API count lower than the committed file. The weekly `website-site-stats` routine runs it
- `npm run test:api-live` - run only the live GitHub API contract checks (`tests/site-stats-live.spec.ts`); weekly in the API live workflow and on demand, never on a pull request
- `npm run postman` - rewrite `postman/site-stats.postman_collection.json` from the script's endpoints and the schemas (a test fails if it is out of date); Newman runs it in the API live workflow
- `npm run perf` - the performance checks, against a local `astro preview` on 127.0.0.1 (never the live site): Lighthouse CI budgets for Home, `/resume/qa/`, and `/art/` (`lighthouserc.cjs`, the one table of budgets), then the k6 smoke test (`perf/k6-smoke.js`), then a table of each measured value next to its budget (also written to the CI job summary). Build first with `npm run build:site`; needs k6 installed; takes about four minutes. Changing a budget means measuring first, then updating `lighthouserc.cjs` and the `APPROVED` table in `tests/performance.spec.ts` together. The Performance workflow is deliberately not a required check (a path-filtered workflow never reports when skipped)
- `npm run eval:bullets` - the AI bullet eval: asks Claude (`claude-haiku-5-5`) to draft a resume bullet for each of 8 fixed prompts 5 times, scores every reply with `evals/lib/score.mjs` (which reuses `src/lib/copy-rules.js`), prints pass rates per rule and per prompt, and exits 1 below the threshold in `evals/resume-bullets/baseline.json` (2 if the run could not be done). It makes real API calls that cost money, so it needs `ANTHROPIC_API_KEY` and runs only on demand and in the AI eval workflow; never run it in a loop, never print or commit the key, add `-- --estimate` to see the cost first. `npm run eval:bullets:replay -- <file>` scores saved replies with no key and no network. Changing a prompt, the system prompt, or a rule means re-running it and recording a new baseline on purpose; never lower the threshold just to turn the run green
- `npm run import-lanes` - check the private bank (refresh `private/bank-export.md` from the artifact first) and report what it would import: lane tags, role ranks, combined bullets. Add `-- --write` to update `bullets.yaml`, `roles.yaml`, and `combos.yaml`, and `-- --apply-text` to also copy changed bullet wording. It writes nothing when the bank has a hard problem. Lane data is edited in the bank, then imported; never hand-edit `lanes`, `lane_rank`, or `combos.yaml`
- Docs: https://docs.astro.build
- Exploratory testing: `.mcp.json` registers the Playwright MCP server (pinned version, headless, isolated, no secrets); approve it once in Claude Code, and install its browser once with `npx @playwright/mcp@0.0.83 install-browser chrome-for-testing` (it is not the tests' browser). Charter, template, and session notes live in `docs/exploratory/`. See the README section "Exploratory testing with the Playwright MCP server"

## Testing

The Playwright suite is a portfolio piece as well as a safety net. It lives in `tests/`, and the data helpers in `tests/helpers/data.ts` read the same YAML files the site is built from, so a test states what a page should contain without a second hand-copied list.

- `resume.spec.ts` - every resume (the six lane resumes, then Creative) renders from the real data, shows exactly its skills, lists every version in the switcher with its PDF link, and the print routes carry the same summary, bullets, and skills and follow the label mode
- `resume-details.spec.ts` - on every resume's web page and print route (the lanes and Creative): role order, each role's dates, title, note, and positions, bullet order within a role, and the education list, plus a print-media check that everything is visible, readable, and within the page (the date format and role order are re-implemented in `tests/helpers/data.ts`, not imported from the site)
- `pdfs.spec.ts` - one real PDF per resume, with a sensible page count, printed from its own resume (its title says which), and the old QA, Consulting, and Adoption file names kept as copies of the lane PDFs
- `links.spec.ts` - a crawl from the home page that checks every link, anchor, and asset, and that no page is orphaned
- `filters.spec.ts`, `art.spec.ts`, `art-filters.spec.ts` (the Art page sort and filters), `audio.spec.ts`, `navigation.spec.ts` - the interactive behavior (Bandcamp is stubbed for every spec through `tests/helpers/test.ts`, so tests never use the network; import `test` from there, except in the smoke test)
- `not-found.spec.ts`, `social.spec.ts`, `icons.spec.ts`, `theme.spec.ts`, `copy.spec.ts` - the friendly 404 page, the link-preview tags, sitemap, and robots.txt, the site icons, the light and dark theme button, and the page text that comes from `src/data/intros.yaml`
- `fonts.spec.ts`, `header.spec.ts` - the bundled Atkinson font (and no outside fonts), and a header that does not move between pages
- `readme.spec.ts` - the README and the content READMEs: npm commands match `package.json`, relative links and named project files exist, and every spec file is described here or in the README. It needs no browser. When it fails, fix the README or CLAUDE.md, not the test
- `contact.spec.ts` - the email, LinkedIn, GitHub, and area on the Contact page and every resume header and print route, and the privacy rules on the built pages (area is "Decatur, GA" in the resume headers and "Decatur, GA, a suburb of Atlanta" in page text, no phone number or `tel:` link)
- `jabroni-fest.spec.ts` - the Jabroni Fest page shows every field of `src/data/events.yaml` (name, summary, role, facts, "How it runs", cause)
- `projects.spec.ts` - each Development & QA project page shows every field of its `src/content/projects/*.yaml` file (summary, facts, problem, built, stack, outcome, and the repo and demo links it has)
- `accessibility.spec.ts` - axe scans of every page in light, dark, and phone width, plus the changing states and keyboard checks
- `add-resume-bullet-skill.spec.ts` - the add-resume-bullet skill (`.claude/skills/add-resume-bullet/`): its check mode accepts a clean bullet, rejects one bullet per rule (weak verb, dash, phone number, count without a plus sign), and writes nothing. No browser needed
- `lane-resumes.spec.ts` - the six lane resumes (`/resume/print/lane-<id>/` and PDFs): exactly the fitted bullets in order, every tier 1 bullet, role floors, summary, skills, real names, two pages or fewer; the print routes stay out of search and the sitemap while each lane page is searchable and in the sitemap; the old Consulting and Adoption addresses forward to the lane pages; and no fit pages in the site
- `lane-fit.spec.ts` - the lane fit plan (`src/lib/lane-fit.js`): starting list, the cut order (combined bullets, then tier 3, then tier 2, least relevant role and lowest position first), tier 1 never cut, role floors, and the fingerprint, on made-up data and on the real data for all six lanes. No browser needed
- `import-lanes.spec.ts` - the bank importer (`scripts/import-lanes.mjs`) on a made-up bank in `tests/fixtures/lanes/`: a clean check writes nothing, `--write` sets lanes, ranks, and combos and is repeatable, and each bad tag, heading, or combo exits with an error and writes nothing. No browser needed
- `lane-data.spec.ts` - the per-lane resume data (`lanes.yaml`, the `lanes` field on bullets, `lane_rank` on roles, `combos.yaml`): the checks in `src/lib/lane-data.js` pass on the real data and reject one broken case per rule. No browser needed
- `bank-private.spec.ts` - no built page shows a private bank section name, no private file is in `dist/`, and (when the local snapshot exists) no bank story title is published
- `bullet-verbs.spec.ts` - the past-tense verb rule on examples, every real bullet and combined bullet, and the schema wiring. No browser needed
- `traceability.spec.ts` - the traceability check (`scripts/lib/traceability.mjs`) on made-up requirements and results: untested requirements, missing reasons, unknown or retired tags, untagged tests, exit codes. No browser needed
- `site-stats.spec.ts`, `site-stats-postman.spec.ts`, `site-stats-live.spec.ts` - API and contract tests for the project totals: recorded and negative cases on every pull request (no network, no browser), the Postman collection kept in step with the script, and the live GitHub checks that run only weekly and on demand
- `bullet-eval-scorer.spec.ts`, `bullet-eval-gate.spec.ts`, `ai-eval-workflow.spec.ts` - the AI bullet eval without calling the API: the scorer on fixed outputs (a clean bullet per prompt, a bad one per rule), the report, the pass-rate gate and exit codes (replayed fixtures and a local stand-in server), and the workflow file (the key only in one step, no fork access, read-only, capped). No browser needed
- `performance.spec.ts` - the performance checks without measuring: the Lighthouse CI budget numbers and pages, the k6 settings and its local-address guard, the Performance workflow settings, and the report builder on made-up results (a failing value, a value on its limit, a missing result). No browser needed
- `smoke.spec.ts` - short checks against the live site, run by the Smoke test workflow after every deploy, weekly, and on demand

`.claude/agents/test-reviewer.md` is a read-only subagent (Read, Grep, Glob only) that reviews specs for coverage gaps, weak assertions, tests that cannot fail, and flaky patterns. Give it the spec files to review (it cannot run `git`), for example the output of `git diff --name-only main...HEAD tests`. Its findings are leads to check, not a gate, and it is not part of CI.

The CI workflow builds and runs the suite on every pull request, and it must be green before a merge. When adding a feature, add or update the test that covers it, and check that the test can fail by breaking the feature on purpose.

## Requirements traceability

A requirement is a GitHub issue labelled `requirement` with a title starting `REQ:`, a `## Requirement` sentence, and `## Acceptance criteria`. It stays open while in force (PRs say `Refs #N`, not `Closes #N`); closing it as not planned retires it. Every Playwright test carries `{ tag: ['@req-N'] }` (on the test or its `test.describe`). A requirement with no test needs the `no-automated-test` label and a `## No automated test - reason` section. CI fails otherwise, and also for a tag that points at no requirement. A new feature gets its REQ issue, a tagged test, and the tag in the same pull request. Details are in the README section "Requirements traceability". Never add a test only to turn the check green: show Steve the gap and let him decide between a test and `no-automated-test`.

To add a resume bullet, use the `add-resume-bullet` skill instead of editing `bullets.yaml` and `variants.yaml` by hand. The text rules (dashes, phone numbers, past-tense verb) live in `src/lib/copy-rules.js`, shared by the schema and the skill.

## Workflow: issue first

Same flow as the TPD-Addin-XLAM and soundboard repos. `main` deploys on every merge, so nothing goes to `main` except through a pull request.

1. **Issue first.** Every change starts as a GitHub issue with a "Why" and a "Scope" section (and a "Done when" list). One concern per issue. Use a type label (`enhancement`, `bug`, `documentation`, `chore`) plus an area label where one fits (`resume`, `content`, `ci`).
2. **Branch from an up-to-date `main`**, named `type/short-description` (`feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `refactor/`, `test/`). Example: `feat/resume-data-model`.
3. **Small commits** with imperative messages that describe the change, not "updated stuff".
4. **Pull request** with a short title and a body that explains why in prose and how it was checked. The body starts with `Closes #<issue>` so the issue closes on merge. **Check the README before opening it:** if the change touches a page, feature, command, dependency, folder, or test area that the README describes, update the README in the same pull request; if not, say in the body that no README update was needed. Tick the README box in the template either way. (Update CLAUDE.md the same way when a convention or command changes.)
5. **Claude turns on auto-merge** for each pull request (merge commit), so GitHub merges it once the `build` check passes. If auto-merge cannot be enabled, Claude merges by hand once the check has passed. GitHub deletes the branch on the remote when the pull request merges (see the setting below), so Claude only confirms it is gone, then deletes the local copy, switches to `main`, and pulls before starting the next branch.

## Working agreements

- Claude does the GitHub work: issues, labels, branches, commits, pushes, and pull requests, using `gh` and `git`, and explains non-obvious steps as it goes.
- **Branch protection (applied 2026-10-04):** a repository ruleset on `main` blocks deletion and force pushes, requires a pull request, and requires the `build` check to pass. Repository admins can bypass it, so Steve can still push directly in an emergency, but Claude never does. GitHub's auto-merge setting is on, and so is "Automatically delete head branches" (applied 2026-10-05), which removes a branch from GitHub as soon as its pull request merges. That setting is needed because a branch merged through auto-merge is not removed by the delete flag on `gh pr merge`.
- **Standing permission to merge (given 2026-10-03, until Steve says to stop):** Claude merges its own pull requests through auto-merge, or by hand with `gh pr merge --merge --delete-branch`, only once the build check has passed. A merge deploys to the live site, so: never merge while a check is failing or still running, never use admin bypass to get past a red check, check status once when returning to a PR rather than polling, and fix a red check instead of merging past it. Enabling auto-merge on each pull request is allowed under this permission.
- Never force-push or rewrite history on `main`, and never change repository settings (the `main` ruleset, GitHub's auto-merge setting, visibility) without asking.
- **Dependency updates (added 2026-10-10):** Dependabot PRs are merged by GitHub through `dependabot-auto-merge.yml` once `build` passes. The weekly cloud routine `website-dependency-repair` only repairs red Dependabot PRs (it never merges) and labels the ones it cannot fix `needs-human`. A separate weekly routine reports issue, PR, and release counts.
- **Branch cleanup (added 2026-10-11):** no merged branch is left behind, locally or on GitHub. Claude does this every time, without being asked:
  - After a pull request merges, run `git fetch --prune`, switch to `main`, `git pull --ff-only`, then delete the local branch with `git branch -d <branch>`. Use `-d`, never `-D`: it refuses unless the branch is merged, which is the safety check. If it refuses, find out why and ask before forcing.
  - Confirm the remote copy is gone with `git ls-remote --heads origin`. GitHub deletes it on merge; if it is still there, delete it with `git push origin --delete <branch>`.
  - At the start of a session, and before cutting a new branch, run `git fetch --prune` and `git branch -vv`. Delete any local branch marked `gone` whose pull request is merged (`gh pr list --state all --head <branch>`). A `gone` branch whose pull request was closed unmerged, or that has no pull request, may hold unpushed work, so ask before deleting it.
  - The goal is that `git branch -a` shows only `main` (and any branch with a pull request still open).
- To revoke the merge permission, Steve says so in chat and this section is updated.
- Only use numbers that appear in the resume bullet bank or that I give you. Never invent metrics.
- **The bank (added 2026-10-12):** the source of truth is a private Claude Docs artifact (link in `private/PROJECT_BRIEF.md`, never in the repo). `private/bank-export.md` is a snapshot of it. At the start of any task that uses the bank, Claude refreshes the snapshot: export the artifact as markdown with the Claude Docs connector, move the old file to `private/bank-export.prev.md`, save the new one, and record the artifact revision and date in `private/bank-export.rev.txt`. Claude only reads the artifact, never writes to it.
- Only bullets with `public: true` appear on the site.
- Never publish the Target Roles section, the behavioral (STAR) stories, or internal notes from the bank.
- Public site privacy: no phone number, location is "Decatur, GA" in the resume headers and "Decatur, GA, a suburb of Atlanta" in page text (Steve chose to publish the city, 2026-10-19; nothing more specific, no street address), contact is a mailto link plus LinkedIn and GitHub, no confidential employer details.
