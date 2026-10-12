import { test, expect } from './helpers/test';
import { PROJECT_TYPE_LABELS, projects } from './helpers/data';

// Each Development & QA project has a page built from one YAML file in src/content/projects/. The link
// crawl, the accessibility scans, and the preview-tag checks only visit these pages, so these checks are
// what notice a page losing its repo link, its stack, or its outcome list, or printing "undefined".
// Every expected value is read from the project file, so changing a project never needs a test edit.

// Folded YAML text and the page both end up as one line of text, so compare with spaces collapsed.
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

test('there are projects to check, and with and without a demo link', () => {
  // Guards against a loader that quietly returns nothing, and keeps the "no button" branch below real.
  expect(projects.length).toBeGreaterThan(0);
  expect(projects.some((p) => p.links.demo), 'a project with a demo link').toBe(true);
  expect(projects.some((p) => !p.links.demo), 'a project without a demo link').toBe(true);
});

for (const project of projects) {
  const url = `/development-qa/${project.slug}/`;

  test.describe(`project page: ${project.title}`, () => {
    test('has its own title and description', async ({ page }) => {
      await page.goto(url);
      await expect(page).toHaveTitle(`${project.title} | Development & QA | Steve Johnson`);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', oneLine(project.summary));
    });

    test('shows the heading, the year and type, the summary, and a way back', async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(project.title);
      await expect(page.locator('p.meta')).toHaveText(`${project.year} · ${PROJECT_TYPE_LABELS[project.type]}`);
      await expect(page.locator('p.summary')).toHaveText(oneLine(project.summary));
      await expect(page.getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/development-qa/');
    });

    test('shows its headline facts, or none', async ({ page }) => {
      await page.goto(url);
      const facts = page.locator('ul.facts');
      if (!project.facts?.length) {
        await expect(facts).toHaveCount(0);
        return;
      }
      await expect(facts.locator('li')).toHaveCount(project.facts.length);
      await expect(facts.locator('li strong')).toHaveText(project.facts.map((f) => oneLine(f.value)));
      await expect(facts.locator('li span')).toHaveText(project.facts.map((f) => oneLine(f.label)));
    });

    test('shows the problem, what was built, the stack, and the outcome', async ({ page }) => {
      await page.goto(url);
      const section = (id: string) => page.locator(`section[aria-labelledby="${id}"]`);

      await expect(section('problem').getByRole('heading', { level: 2 })).toHaveText('Problem');
      await expect(section('problem').locator('p')).toHaveText(oneLine(project.problem));

      await expect(section('built').getByRole('heading', { level: 2 })).toHaveText('What I built');
      await expect(section('built').locator('li')).toHaveText(project.built.map(oneLine));

      await expect(section('stack').getByRole('heading', { level: 2 })).toHaveText('Stack');
      await expect(section('stack').locator('li')).toHaveText(project.stack.map(oneLine));

      await expect(section('outcome').getByRole('heading', { level: 2 })).toHaveText('Outcome');
      await expect(section('outcome').locator('li')).toHaveText(project.outcome.map(oneLine));

      // Nothing printed a missing value.
      await expect(page.getByRole('main')).not.toContainText(/undefined|\[object Object\]/);
    });

    test('links to the code and the demo it has, and shows no button for one it lacks', async ({ page }) => {
      await page.goto(url);
      const links = page.locator('section[aria-labelledby="links"]');
      const repo = links.getByRole('link', { name: 'Code on GitHub' });
      const demo = links.getByRole('link', { name: 'Live demo' });

      if (project.links.repo) await expect(repo).toHaveAttribute('href', project.links.repo);
      else await expect(repo).toHaveCount(0);

      if (project.links.demo) await expect(demo).toHaveAttribute('href', project.links.demo);
      else await expect(demo).toHaveCount(0);

      await expect(links.getByRole('link')).toHaveCount(Object.values(project.links).filter(Boolean).length);
    });
  });
}
