import { test, expect } from './helpers/test';
import { dateRange, education, rolesInOrder, rolesNewestFirst, shownResumes } from './helpers/data';

// The resume pages and the print routes (which the PDFs are printed from) show more than a version's
// summary, skills, and bullet text: the order of the roles, each role's dates, title, note, and
// positions, the order of the bullets under each role, and the Education and Certifications list.
// resume.spec.ts checks the first group; these checks read the rest from the data files.
//
// The date format and the role order are worked out in tests/helpers/data.ts, apart from the site's own
// code, so a mistake in the site's version cannot agree with the test.

// The PDFs are printed from the print routes with the browser's print media, so this is what a reader of
// the PDF sees. The text checks elsewhere use toContainText, which also matches text a print rule hides.
for (const version of shownResumes) {
  test(`the print route of "${version.route}" shows everything, readable, within the page`, { tag: ['@req-316'] }, async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await page.goto(`/resume/print/${version.printRoute}/`);
    const resume = page.locator('article.resume');
    const listed = version.items;

    await expect(resume.getByRole('heading', { level: 1 })).toBeVisible();
    for (const name of ['Summary', 'Core Skills', 'Professional Experience', 'Education and Certifications']) {
      await expect(resume.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    await expect(resume.locator('section[aria-labelledby="resume-summary"] p')).toBeVisible();
    // Every one of these is checked for being shown, not just present in the markup.
    await expect(resume.locator('.bullets li:visible')).toHaveCount(listed.length);
    await expect(resume.locator('.skills dt:visible')).toHaveCount(version.skills.length);
    await expect(resume.locator('.skills dd:visible')).toHaveCount(version.skills.length);
    await expect(resume.locator('ul.education > li:visible')).toHaveCount(education.length);
    await expect(resume.locator('.role-head:visible')).toHaveCount(await resume.locator('section.role').count());

    // Dark text on a white page, not pale or invisible text.
    const colors = await resume.locator('.bullets li').first().evaluate((el) => {
      const channels = (css: string) => css.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      return { text: channels(getComputedStyle(el).color), page: channels(getComputedStyle(document.body).backgroundColor) };
    });
    expect(Math.max(...colors.text), 'text colour channels').toBeLessThan(110);
    expect(Math.min(...colors.page), 'page colour channels').toBeGreaterThan(240);

    // Nothing sticks out sideways past the page.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'pixels wider than the page').toBeLessThanOrEqual(1);
  });
}

// The look of the PDFs: a right-aligned header, plain section headings, run-in skills, and type that stays
// readable. A tighter fit (npm run fit-lanes) must not be bought by quietly shrinking the text, so the
// smallest allowed size is pinned here. These read the real layout in print media, the same layout the PDFs print.
const MIN_BODY_PT = 10;
const PX_PER_PT = 96 / 72;

for (const version of shownResumes) {
  test(`the print route of "${version.route}" has the right-aligned header, plain headings, run-in skills, and readable type`, { tag: ['@req-393'] }, async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await page.goto(`/resume/print/${version.printRoute}/`);
    const resume = page.locator('article.resume');

    const layout = await resume.evaluate((el) => {
      const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      const style = (selector: string) => getComputedStyle(el.querySelector(selector)!);
      const group = el.querySelector('.skill-group')!;
      return {
        headerAlign: style('.resume-header').textAlign,
        nameCase: style('h1').textTransform,
        pronouns: rect('.contact-pronouns'),
        area: rect('.contact-area'),
        linkedin: rect('.contact-linkedin'),
        github: rect('.contact-github'),
        email: rect('.contact-email'),
        headingRules: [...el.querySelectorAll('h2')].map((h) => getComputedStyle(h).borderBottomWidth),
        labelTop: group.querySelector('dt')!.getBoundingClientRect().top,
        listTop: group.querySelector('dd')!.getClientRects()[0].top,
        sizes: ['section[aria-labelledby="resume-summary"] p', '.skill-group dd', '.skill-group dt', '.bullets li'].map((selector) => parseFloat(style(selector).fontSize)),
      };
    });

    expect(layout.headerAlign).toBe('right');
    expect(layout.nameCase).toBe('uppercase');
    // Three lines, top to bottom: pronouns beside the area, then LinkedIn beside GitHub, then email.
    expect(layout.pronouns.top).toBeCloseTo(layout.area.top, 0);
    expect(layout.pronouns.right).toBeLessThanOrEqual(layout.area.left + 1);
    expect(layout.area.bottom).toBeLessThanOrEqual(layout.linkedin.top + 1);
    expect(layout.linkedin.top).toBeCloseTo(layout.github.top, 0);
    expect(layout.linkedin.bottom).toBeLessThanOrEqual(layout.email.top + 1);
    expect(layout.linkedin.right).toBeLessThanOrEqual(layout.github.left + 1);
    // Every line ends at the same right edge.
    for (const line of [layout.area, layout.github, layout.email]) expect(line.right).toBeCloseTo(layout.area.right, 0);

    expect(layout.headingRules, 'border under each section heading').toEqual(layout.headingRules.map(() => '0px'));
    expect(layout.listTop, 'a skills list starts on the same line as its label').toBeCloseTo(layout.labelTop, -1);
    for (const size of layout.sizes) expect(size / PX_PER_PT, 'body text size in pt').toBeGreaterThanOrEqual(MIN_BODY_PT);
  });
}

// Page breaks (the PDFs are paginated by Chromium from these rules). A role's heading and positions stay with its
// bullets, and the first bullet and the second from last stay with the next one, so a break never strands a company
// or position, and never leaves a lone bullet before or after it. The page break itself is Chromium's, so this checks
// that the rules sit on the right elements; the PDFs are also looked at by eye when print.css changes.
for (const version of shownResumes) {
  test(`the print route of "${version.route}" keeps each role's heading with its bullets at a page break`, { tag: ['@req-398'] }, async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await page.goto(`/resume/print/${version.printRoute}/`);

    const roles = await page.locator('article.resume section.role').evaluateAll((sections) =>
      sections.map((role) => {
        const breakAfter = (el: Element) => getComputedStyle(el).getPropertyValue('break-after');
        const bullets = [...role.querySelectorAll('.bullets li')].filter((li) => !(li as HTMLElement).hidden);
        return {
          name: role.querySelector('h3')!.textContent,
          headAvoidsBreak: breakAfter(role.querySelector('.role-head')!),
          positionsAvoidBreak: breakAfter(role.querySelector('.positions, .role-title')!),
          positionsStayTogether: role.querySelector('.positions') ? getComputedStyle(role.querySelector('.positions')!).getPropertyValue('break-inside') : 'avoid',
          bulletKeepsWithNext: bullets.map((li) => breakAfter(li) === 'avoid'),
        };
      }),
    );

    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(role.headAvoidsBreak, `${role.name}: heading keeps with what follows`).toBe('avoid');
      expect(role.positionsAvoidBreak, `${role.name}: positions keep with the bullets`).toBe('avoid');
      expect(role.positionsStayTogether, `${role.name}: position lines stay together`).toBe('avoid');
      // Exactly the first bullet and the second from last (the same bullet when there are only two).
      const n = role.bulletKeepsWithNext.length;
      const expected = role.bulletKeepsWithNext.map((_, i) => n >= 2 && (i === 0 || i === n - 2));
      expect(role.bulletKeepsWithNext, `${role.name}: which bullets keep with the next`).toEqual(expected);
    }
  });
}

test.describe('the date format used by the checks below', { tag: ['@req-315'] }, () => {
  // Literal examples, so the helper is known to be right before the pages are compared with it.
  test('prints a range, a single year, and an ongoing role the way the resume does', () => {
    expect(dateRange(2012, 2024)).toBe('2012-2024');
    expect(dateRange(2011, 2011)).toBe('2011');
    expect(dateRange(2026, 'present')).toBe('2026-Present');
  });

  test('puts ongoing roles first, then the latest to finish, then the latest to start', () => {
    const ids = rolesNewestFirst.map((r) => r.id);
    const ongoing = rolesNewestFirst.filter((r) => r.end === 'present');
    expect(ongoing.length, 'ongoing roles in roles.yaml').toBeGreaterThan(0);
    expect(rolesNewestFirst.slice(0, ongoing.length)).toEqual(ongoing); // all the ongoing roles come first
    expect(ongoing.map((r) => r.start)).toEqual([...ongoing.map((r) => r.start)].sort((a, b) => b - a));
    expect(new Set(ids).size, 'every role appears once').toBe(ids.length);

    // The whole order, pair by pair: the roles that finished (and the ongoing ones) never go back in time.
    const end = (r: (typeof rolesNewestFirst)[number]) => (r.end === 'present' ? Infinity : r.end);
    for (let i = 0; i < rolesNewestFirst.length - 1; i++) {
      const [a, b] = [rolesNewestFirst[i], rolesNewestFirst[i + 1]];
      const inOrder =
        end(a) > end(b) || (end(a) === end(b) && (a.start > b.start || (a.start === b.start && a.id.localeCompare(b.id) < 0)));
      expect(inOrder, `${a.id} should come before ${b.id}`).toBe(true);
    }
  });

  test('the data has the kinds of role the checks below are meant to cover', () => {
    // Keeps the position and note branches real: if the data stopped having one, those checks would
    // quietly run on nothing.
    const shown = shownResumes.flatMap((v) => rolesNewestFirst.filter((role) => v.items.some((b) => b.role === role.id)));
    expect(shown.some((r) => r.positions), 'a shown role with several positions').toBe(true);
    expect(shown.some((r) => !r.positions && r.note), 'a shown single-title role with a note').toBe(true);
    expect(shown.some((r) => !r.positions && !r.note), 'a shown single-title role without a note').toBe(true);
    expect(shown.some((r) => r.neutral_org), 'a shown role with an alternate organization name').toBe(true);
  });
});

for (const version of shownResumes) {
  const listed = version.items;
  // The roles this resume shows (a role with no bullet in it is left out), newest first (a lane with a Projects section lists
  // its projects first), with their bullets in the resume's order.
  const sections = rolesInOrder(version.lane)
    .map((role) => ({ role, bullets: listed.filter((b) => b.role === role.id) }))
    .filter((s) => s.bullets.length > 0);

  const pages = [
    { name: 'web page', url: `/resume/${version.route}/` },
    { name: 'print route', url: `/resume/print/${version.printRoute}/` },
  ];

  for (const { name, url } of pages) {
    test.describe(`resume "${version.route}" ${name}`, { tag: ['@req-315'] }, () => {
      test('lists its roles newest first, each with its bullets in order', async ({ page }) => {
        await page.goto(url);
        expect(sections.length, 'roles shown by this version').toBeGreaterThan(0);
        const roleEls = page.locator('section.role');
        await expect(roleEls).toHaveCount(sections.length);
        for (const [i, section] of sections.entries()) {
          await expect(roleEls.nth(i)).toHaveAttribute('aria-labelledby', `role-${section.role.id}`);
          await expect(roleEls.nth(i).locator('.bullets li')).toHaveText(section.bullets.map((b) => b.text));
        }
      });

      test('shows each role\'s dates, title, note, and positions', async ({ page }) => {
        await page.goto(url);
        for (const { role } of sections) {
          const el = page.locator(`section[aria-labelledby="role-${role.id}"]`);
          // The organization name belongs to this very role. (resume.spec.ts compares the names only as a
          // sorted set, which two swapped names would still satisfy.) The web page always shows real names;
          // the print route follows the version's label mode.
          const org = name === 'print route' && version.org_labels === 'neutral' && role.neutral_org ? role.neutral_org : role.org;
          await expect(el.locator(`h3#role-${role.id}`), `organization of ${role.id}`).toHaveText(org);
          await expect(el.locator('.role-head .dates'), `dates of ${role.id}`).toHaveText(dateRange(role.start, role.end));

          if (role.positions) {
            // An employer with several positions lists each one, instead of the single title.
            await expect(el.locator('.role-title')).toHaveCount(0);
            const items = el.locator('ul.positions > li');
            await expect(items).toHaveCount(role.positions.length);
            for (const [i, position] of role.positions.entries()) {
              await expect(items.nth(i).locator('.position-title')).toHaveText(position.title);
              await expect(items.nth(i).locator('.dates')).toHaveText(dateRange(position.start, position.end));
              if (position.note) await expect(items.nth(i).locator('.note')).toHaveText(`(${position.note})`);
              else await expect(items.nth(i).locator('.note')).toHaveCount(0);
            }
          } else {
            await expect(el.locator('ul.positions')).toHaveCount(0);
            await expect(el.locator('.role-title .position-title')).toHaveText(role.title);
            if (role.note) await expect(el.locator('.role-title .note')).toHaveText(`(${role.note})`);
            else await expect(el.locator('.role-title .note')).toHaveCount(0);
          }
        }
      });

      test('shows the education and certifications in order, with school and dates', async ({ page }) => {
        await page.goto(url);
        expect(education.length, 'entries in education.yaml').toBeGreaterThan(0);
        const items = page.locator('ul.education > li');
        await expect(items).toHaveCount(education.length);
        for (const [i, entry] of education.entries()) {
          expect(entry.degree ?? entry.certification, `education entry "${entry.id}" needs a degree or a certification`).toBeTruthy();
          const title = entry.degree ?? (entry.level ? `${entry.certification} (${entry.level})` : entry.certification!);
          await expect(items.nth(i).locator('.position-title')).toHaveText(title);
          if (entry.school) await expect(items.nth(i).locator('.note')).toHaveText(entry.school);
          else await expect(items.nth(i).locator('.note')).toHaveCount(0);
          await expect(items.nth(i).locator('.dates')).toHaveText(entry.degree ? `${entry.year}` : dateRange(entry.since!, 'present'));
        }
      });
    });
  }
}
