# Project notes for Claude Code

Personal portfolio site for Steven Johnson (GitHub: srjohnson1986). Astro, hosted on GitHub Pages. The repo is public.

Read `PROJECT_BRIEF.md` (kept in `private/`) for goals, pages, and privacy rules. Private inputs live in `private/` and are never committed or published.

## Standing conventions

- Use only single hyphens in any text you write for me. No em dashes, no en dashes, and no double hyphens in prose or copy.
- Resume and LinkedIn bullets start with a strong, past-tense, action-oriented verb, with varied verbs across bullets.
- Keep changes small and reviewable. Prefer one concern per pull request.
- Don't add dependencies without telling me why.
- Never commit anything from `private/`.
- Explain non-obvious choices briefly, since I'm learning the toolchain.
- Ask me before big decisions rather than guessing.

## Commands

- `npm install` - install dependencies
- `npm run dev` - local dev server (use `astro dev --background` when started by Claude; manage with `astro dev stop|status|logs`)
- `npm run build` - build to `dist/`
- `npm run preview` - serve the built site locally
- Docs: https://docs.astro.build

## Workflow: issue first

Same flow as the TPD-Addin-XLAM and soundboard repos. `main` deploys on every merge, so nothing goes to `main` except through a pull request.

1. **Issue first.** Every change starts as a GitHub issue with a "Why" and a "Scope" section (and a "Done when" list). One concern per issue. Use a type label (`enhancement`, `bug`, `documentation`, `chore`) plus an area label where one fits (`resume`, `content`, `ci`).
2. **Branch from an up-to-date `main`**, named `type/short-description` (`feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `refactor/`, `test/`). Example: `feat/resume-data-model`.
3. **Small commits** with imperative messages that describe the change, not "updated stuff".
4. **Pull request** with a short title and a body that explains why in prose and how it was checked. The body starts with `Closes #<issue>` so the issue closes on merge.
5. **Steven merges on GitHub.** Then Claude deletes the branch, switches to `main`, and pulls before starting the next branch.

## Working agreements

- Claude does the GitHub work: issues, labels, branches, commits, pushes, and pull requests, using `gh` and `git`, and explains non-obvious steps as it goes. Steven reviews and merges every pull request, because a merge deploys to the live site. Never merge a PR, enable auto-merge, force-push, or rewrite history on `main` unless asked.
- Only use numbers that appear in `private/bank-export.md` or that I give you. Never invent metrics.
- Only bullets with `public: true` appear on the site.
- Never publish the Target Roles section, the behavioral (STAR) stories, or internal notes from the bank.
- Public site privacy: no phone number, location is "Atlanta area" only, contact is a mailto link plus LinkedIn and GitHub, no confidential employer details.
