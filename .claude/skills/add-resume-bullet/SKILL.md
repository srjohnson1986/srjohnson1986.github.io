---
name: add-resume-bullet
description: Add a new resume bullet to this site's data files (src/data/resume/bullets.yaml and variants.yaml) after checking the owner's bullet rules. Use when the user asks to add, write in, or put a bullet on the resume or on specific resume versions (qa, consulting, creative, adoption). Not for editing or deleting a bullet, or for roles, skills, or summaries.
---

# Add a resume bullet

A bullet is two edits: an entry in `src/data/resume/bullets.yaml` and its id in the `bullets:` list of each resume version that should show it (`src/data/resume/variants.yaml`). `.claude/skills/add-resume-bullet/check-bullet.mjs` does both and checks the rules first. Do not edit those two files by hand for this task.

The build schema (`src/content.config.ts`) stays the authority for the rules it already has: single hyphens only, no phone numbers, a past-tense first word, a real role, versions, theme, and tags. The script runs those three copy rules from the same file the schema uses (`src/lib/copy-rules.js`) only so a bad bullet is stopped before it is written. The script adds what the build lacks: weak verbs, the `+` floor on project counts, and a repeated-verb warning within a role.

## Inputs

Get these from the user. If one is missing and has no safe default, ask once, with the options listed.

1. **Text.** Use the user's wording. Never invent or adjust a metric: numbers come from `private/bank-export.md` or from the user.
2. **Role id** from `src/data/resume/roles.yaml` (tpd, care-board, portfolio-site, verizon, kingdom-hell, jabroni, nucor, pg, geek-squad).
3. **Versions** by id: qa, consulting, creative, adoption. At least one. A bullet in `bullet-groups.yaml` is shared by several versions; the script does not edit groups, so if the user wants a shared group, say so and do that edit by hand.
4. **Theme and tags.** Default: reuse the theme and tags of the closest existing bullet in that role (`grep -A4 "role: <id>" src/data/resume/bullets.yaml`) and say which you chose. `public` is always `true`.

## Steps

1. **Check, without writing:**
   ```bash
   node .claude/skills/add-resume-bullet/check-bullet.mjs check --role <role> --versions <a,b> --text "<bullet>"
   ```
2. **Read the result.**
   - `ERROR` lines: stop. Nothing is written. Show the user each error with a fixed wording, and re-run `check` once they agree.
   - `WARN` lines (verb already used in the role or a version): show them with the suggested alternative verbs and ask whether to keep or swap. A warning never blocks.
   - `NOTE` lines: remind the user that the numbers must be theirs.
   - `--exact-ok` lets a count without `+` through. Use it only when the user says the project is finished and the count is final.
3. **Write**, only after step 2 is settled:
   ```bash
   node .claude/skills/add-resume-bullet/check-bullet.mjs add --role <role> --versions <a,b> --theme <theme> --tags <t1,t2> --text "<bullet>"
   ```
   It re-runs every check, appends the entry to the end of the role's block (and updates the "N bullets" comment), and adds the id after the last bullet of the same role in each named version.
4. **Build and test:** `npm test` (it builds the site and the PDFs, then runs the whole suite). The build fails on any schema violation and on any PDF over 2 pages.
5. **Report**, for each affected version: does its web page and print route render with the new bullet (the resume specs passed), and how many pages is its PDF (the `build-pdfs: ... N page(s)` line, which must be 2 or fewer)? If a spec or the page limit fails, say which, and do not call the task done.

## Repository workflow

This site deploys from `main`, so the data change goes in through the normal flow in `CLAUDE.md`: a GitHub issue first, a `feat/` or `chore/` branch, a pull request with `Closes #<issue>` that passes CI. A new bullet does not usually change anything the README describes; say so in the pull request body and tick the README box.
