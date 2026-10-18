import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { builtPages, dist, variants } from './helpers/data';
import { site } from '../src/data/site';

// The contact details appear in three places: the Contact page and the header of every resume page
// and print route. The privacy rules from CLAUDE.md are checked here against the built pages: the
// location is "Atlanta area" only, there is no phone number, and the contact is a mailto link plus
// LinkedIn and GitHub. The links are read from src/data/site.ts, where they live, but the privacy
// rules are written out in this file on purpose: a test that only repeated site.ts could not notice
// someone changing site.ts.

test.describe('contact details', { tag: ['@req-337'] }, () => {
  test('site.ts still holds the details the pages are meant to show', () => {
    // Without this, an email set to undefined would hide the link and every check below would adapt.
    expect(site.email, 'the email address').toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/i);
    // The two profile addresses are written out on purpose. The pages and the checks below both read
    // site.ts, so a wrong address there would otherwise agree with itself. If a profile really moves,
    // change it here too.
    expect(site.links.linkedin.href).toBe('https://www.linkedin.com/in/stevegulls');
    expect(site.links.github.href).toBe('https://github.com/srjohnson1986');
  });

  test('the Contact page offers the email, LinkedIn, and GitHub', async ({ page }) => {
    await page.goto('/contact/');
    const contact = page.locator('dl.contact');
    await expect(contact.locator('a')).toHaveCount(3);
    await expect(contact.getByRole('link', { name: site.email! })).toHaveAttribute('href', `mailto:${site.email}`);
    await expect(contact.getByRole('link', { name: site.links.linkedin.label })).toHaveAttribute('href', site.links.linkedin.href);
    await expect(contact.getByRole('link', { name: site.links.github.label })).toHaveAttribute('href', site.links.github.href);
  });

  const headers = variants.flatMap((v) => [
    { page: `/resume/${v.id}/`, name: `resume "${v.id}"` },
    { page: `/resume/print/${v.id}/`, name: `print route "${v.id}"` },
  ]);
  for (const { page: url, name } of headers) {
    test(`the ${name} header shows the area, email, LinkedIn, and GitHub`, async ({ page }) => {
      await page.goto(url);
      const items = page.locator('.resume-contact li');
      await expect(items).toHaveText(['Atlanta area', site.email!, site.links.linkedin.label, site.links.github.label]);
      const links = items.locator('a');
      await expect(links).toHaveCount(3);
      await expect(links.nth(0)).toHaveAttribute('href', `mailto:${site.email}`);
      await expect(links.nth(1)).toHaveAttribute('href', site.links.linkedin.href);
      await expect(links.nth(2)).toHaveAttribute('href', site.links.github.href);
    });
  }
});

test.describe('privacy rules', { tag: ['@req-338'] }, () => {
  test('the location is "Atlanta area" and nothing more specific', () => {
    expect(site.area).toBe('Atlanta area');
  });

  // Every built page, plus the 404 page (it is /404.html, which the page list does not include).
  const pages = [...builtPages().map((p) => path.join(dist, p, 'index.html')), path.join(dist, '404.html')];

  // A North American style number in any common layout: (404) 555-0123, 404-555-0123, 404.555.0123,
  // +1 404 555 0123. Dates such as 2026.08.29 and year ranges do not fit this shape.
  const phone = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/;
  const withoutScripts = (html: string) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const visibleText = (html: string) =>
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');

  test('there are pages to scan', () => {
    // Guards against a path mistake that would quietly scan nothing.
    expect(pages.length).toBeGreaterThan(10);
    for (const file of pages) expect(fs.existsSync(file), `${file} is missing`).toBe(true);
  });

  test('no built page contains a phone number or a tel: link', () => {
    const found: string[] = [];
    for (const file of pages) {
      const html = fs.readFileSync(file, 'utf8');
      const where = path.relative(dist, file);
      const number = visibleText(html).match(phone);
      if (number) found.push(`${where}: text contains "${number[0]}"`);
      // Also the tags themselves: a number in a meta description, an alt, or an aria-label is published too.
      const inTags = withoutScripts(html).match(phone);
      if (inTags && !number) found.push(`${where}: markup contains "${inTags[0]}"`);
      if (/href=["']?tel:/i.test(html)) found.push(`${where}: has a tel: link`);
    }
    expect(found, 'Phone numbers must not be published').toEqual([]);
  });

  test('the phone number pattern recognises the usual layouts', () => {
    // Shows the scan above could fail, and that it does not flag the dates and years on the site.
    for (const sample of ['(404) 555-0123', '404-555-0123', '404.555.0123', '+1 404 555 0123', '1-404-555-0123']) {
      expect(sample, sample).toMatch(phone);
    }
    for (const sample of ['2026.08.29', '2015-2026', 'August 29, 2026', '11 years']) {
      expect(sample, sample).not.toMatch(phone);
    }
  });
});
