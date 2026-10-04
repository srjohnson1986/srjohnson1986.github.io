import { test, expect } from '@playwright/test';
import { bulletById, roleById, summaryById, variants, expectedSkills } from './helpers/data';

test.describe('resume data', () => {
  test('every bullet a version lists exists, is public, and has a known role', () => {
    const problems: string[] = [];
    for (const variant of variants) {
      for (const id of variant.bullets) {
        const bullet = bulletById.get(id);
        if (!bullet) problems.push(`${variant.id}: bullet "${id}" does not exist`);
        else {
          if (!bullet.public) problems.push(`${variant.id}: bullet "${id}" is not public`);
          if (!roleById.has(bullet.role)) problems.push(`${variant.id}: bullet "${id}" has unknown role "${bullet.role}"`);
        }
      }
      if (!summaryById.has(variant.summary_id)) problems.push(`${variant.id}: unknown summary "${variant.summary_id}"`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('no version repeats an opening verb', () => {
    for (const variant of variants) {
      const verbs = variant.bullets.map((id) => bulletById.get(id)!.text.match(/^[A-Za-z]+/)![0].toLowerCase());
      const repeated = verbs.filter((v, i) => verbs.indexOf(v) !== i);
      expect(repeated, `${variant.id} repeats: ${repeated.join(', ')}`).toEqual([]);
    }
  });
});

for (const variant of variants) {
  const listed = variant.bullets.map((id) => bulletById.get(id)!);
  const summary = summaryById.get(variant.summary_id)!.text;

  test.describe(`resume version "${variant.id}" (${variant.label})`, () => {
    test('web page shows the summary, skills, experience, and education', async ({ page }) => {
      await page.goto(`/resume/${variant.id}/`);

      await expect(page).toHaveTitle(new RegExp(variant.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
      for (const name of ['Summary', 'Core Skills', 'Experience', 'Education and Certifications']) {
        await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
      }

      const resume = page.locator('article.resume');
      await expect(resume).toContainText(summary);
      for (const bullet of listed) await expect(resume).toContainText(bullet.text);
      await expect(resume.locator('.bullets li')).toHaveCount(listed.length);
    });

    test('shows exactly the skills meant for this version', async ({ page }) => {
      await page.goto(`/resume/${variant.id}/`);
      const expected = expectedSkills(variant.id);

      const labels = await page.locator('.skills dt').allTextContents();
      const lists = await page.locator('.skills dd').allTextContents();
      expect(labels).toEqual(expected.map((g) => g.group));
      expect(lists).toEqual(expected.map((g) => g.items.join(', ')));
    });

    test('marks the current version and links to its PDF', async ({ page }) => {
      await page.goto(`/resume/${variant.id}/`);
      const switcher = page.getByRole('navigation', { name: 'Resume versions' });
      await expect(switcher.locator('[aria-current="page"]')).toHaveText(variant.label);
      await expect(switcher.getByRole('link')).toHaveCount(variants.length);

      const pdf = page.getByRole('link', { name: /Download this version as a PDF/ });
      await expect(pdf).toHaveAttribute('href', `/resume/steve-johnson-resume-${variant.id}.pdf`);
    });

    test('web page uses real organization names', async ({ page }) => {
      await page.goto(`/resume/${variant.id}/`);
      const headings = await page.locator('.role h3').allTextContents();
      const expectedOrgs = [...new Set(listed.map((b) => roleById.get(b.role)!.org))];
      expect([...headings].sort()).toEqual([...expectedOrgs].sort());
    });

    test('print route follows the version\'s label mode and has no site chrome', async ({ page }) => {
      await page.goto(`/resume/print/${variant.id}/`);

      const headings = await page.locator('.role h3').allTextContents();
      const expectedOrgs = [
        ...new Set(
          listed.map((b) => {
            const role = roleById.get(b.role)!;
            return variant.org_labels === 'neutral' && role.neutral_org ? role.neutral_org : role.org;
          }),
        ),
      ];
      expect([...headings].sort()).toEqual([...expectedOrgs].sort());

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('contentinfo')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCount(0);
    });
  });
}

// Label switching only matters when a neutral version lists a role that has an alternate
// organization name (for example a studio or festival entry). If no version does today, this test
// is skipped, and the report says why, instead of passing without checking anything.
const switchingCases = variants
  .filter((v) => v.org_labels === 'neutral')
  .map((v) => ({
    variant: v,
    swapped: [...new Set(v.bullets.map((id) => roleById.get(bulletById.get(id)!.role)!))].filter((r) => r.neutral_org),
  }))
  .filter((c) => c.swapped.length > 0);

test('a neutral version shows alternate organization names in print and real names on the web', async ({ page }) => {
  test.skip(
    switchingCases.length === 0,
    'No neutral version lists a role with an alternate name, so label switching is not exercised by the current data.',
  );
  for (const { variant, swapped } of switchingCases) {
    await page.goto(`/resume/${variant.id}/`);
    for (const role of swapped) {
      await expect(page.locator('.role h3', { hasText: role.org })).toHaveCount(1);
      await expect(page.locator('.role h3', { hasText: role.neutral_org! })).toHaveCount(0);
    }
    await page.goto(`/resume/print/${variant.id}/`);
    for (const role of swapped) {
      await expect(page.locator('.role h3', { hasText: role.neutral_org! })).toHaveCount(1);
      await expect(page.locator('.role h3', { hasText: role.org })).toHaveCount(0);
    }
  }
});

test('/resume/ sends visitors to the first version', async ({ page }) => {
  await page.goto('/resume/');
  await page.waitForURL(`**/resume/${variants[0].id}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Steve Johnson' })).toBeVisible();
});
