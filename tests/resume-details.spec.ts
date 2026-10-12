import { test, expect } from './helpers/test';
import { bulletById, dateRange, education, rolesNewestFirst, variantBulletIds, variants } from './helpers/data';

// The resume pages and the print routes (which the PDFs are printed from) show more than a version's
// summary, skills, and bullet text: the order of the roles, each role's dates, title, note, and
// positions, the order of the bullets under each role, and the Education and Certifications list.
// resume.spec.ts checks the first group; these checks read the rest from the data files.
//
// The date format and the role order are worked out in tests/helpers/data.ts, apart from the site's own
// code, so a mistake in the site's version cannot agree with the test.

test.describe('the date format used by the checks below', () => {
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
    const shown = variants.flatMap((v) => {
      const listed = variantBulletIds(v).map((id) => bulletById.get(id)!);
      return rolesNewestFirst.filter((role) => listed.some((b) => b.role === role.id));
    });
    expect(shown.some((r) => r.positions), 'a shown role with several positions').toBe(true);
    expect(shown.some((r) => !r.positions && r.note), 'a shown single-title role with a note').toBe(true);
    expect(shown.some((r) => !r.positions && !r.note), 'a shown single-title role without a note').toBe(true);
    expect(shown.some((r) => r.neutral_org), 'a shown role with an alternate organization name').toBe(true);
  });
});

for (const variant of variants) {
  const listed = variantBulletIds(variant).map((id) => bulletById.get(id)!);
  // The roles this version shows (a role with no bullet in it is left out), newest first, with their bullets in the version's order.
  const sections = rolesNewestFirst
    .map((role) => ({ role, bullets: listed.filter((b) => b.role === role.id) }))
    .filter((s) => s.bullets.length > 0);

  const pages = [
    { name: 'web page', url: `/resume/${variant.id}/` },
    { name: 'print route', url: `/resume/print/${variant.id}/` },
  ];

  for (const { name, url } of pages) {
    test.describe(`resume "${variant.id}" ${name}`, () => {
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
          const org = name === 'print route' && variant.org_labels === 'neutral' && role.neutral_org ? role.neutral_org : role.org;
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
