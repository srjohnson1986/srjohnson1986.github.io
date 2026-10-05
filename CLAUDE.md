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
- Docs: https://docs.astro.build

## Testing

The Playwright suite is a portfolio piece as well as a safety net. It lives in `tests/`, and the data helpers in `tests/helpers/data.ts` read the same YAML files the site is built from, so a test states what a page should contain without a second hand-copied list.

- `resume.spec.ts` - every resume version renders from the real data, shows exactly its skills, and the print routes follow the label mode
- `pdfs.spec.ts` - one real PDF per version, with a sensible page count
- `links.spec.ts` - a crawl from the home page that checks every link, anchor, and asset, and that no page is orphaned
- `filters.spec.ts`, `art.spec.ts`, `art-filters.spec.ts` (the Art page sort and filters), `audio.spec.ts`, `navigation.spec.ts` - the interactive behavior (Bandcamp is stubbed for every spec through `tests/helpers/test.ts`, so tests never use the network; import `test` from there, except in the smoke test)
- `not-found.spec.ts`, `social.spec.ts`, `icons.spec.ts`, `theme.spec.ts`, `copy.spec.ts` - the friendly 404 page, the link-preview tags, sitemap, and robots.txt, the site icons, the light and dark theme button, and the page text that comes from `src/data/intros.yaml`
- `fonts.spec.ts`, `header.spec.ts` - the bundled Atkinson font (and no outside fonts), and a header that does not move between pages
- `accessibility.spec.ts` - axe scans of every page in light, dark, and phone width, plus the changing states and keyboard checks
- `smoke.spec.ts` - short checks against the live site, run by the Smoke test workflow after every deploy, weekly, and on demand

The CI workflow builds and runs the suite on every pull request, and it must be green before a merge. When adding a feature, add or update the test that covers it, and check that the test can fail by breaking the feature on purpose.

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
- To revoke the merge permission, Steve says so in chat and this section is updated.
- Only use numbers that appear in `private/bank-export.md` or that I give you. Never invent metrics.
- Only bullets with `public: true` appear on the site.
- Never publish the Target Roles section, the behavioral (STAR) stories, or internal notes from the bank.
- Public site privacy: no phone number, location is "Atlanta area" only, contact is a mailto link plus LinkedIn and GitHub, no confidential employer details.
