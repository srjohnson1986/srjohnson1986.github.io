import { test, expect } from '@playwright/test';
import { builtPages } from './helpers/data';

// Print routes exist only so the PDFs can be printed from them. Nothing links to them.
const isPrintRoute = (p: string) => p.startsWith('/resume/print/');

test('every internal link, anchor, and asset resolves, and no page is orphaned', async ({ page, request, baseURL }) => {
  test.setTimeout(180_000);

  const origin = new URL(baseURL!).origin;
  const problems: string[] = [];
  const crawled = new Set<string>();
  const assets = new Set<string>();
  const idsByPage = new Map<string, string[]>();
  const anchorChecks: { from: string; path: string; hash: string }[] = [];
  const consoleErrors = new Map<string, string[]>();
  let current = '/';

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.set(current, [...(consoleErrors.get(current) ?? []), message.text()]);
  });
  page.on('pageerror', (error) => {
    consoleErrors.set(current, [...(consoleErrors.get(current) ?? []), String(error)]);
  });

  const queue = ['/'];
  while (queue.length > 0) {
    const target = queue.shift()!;
    if (crawled.has(target)) continue;
    crawled.add(target);
    current = target;

    // A plain request first: it gives the status and lets redirect pages be followed without
    // racing the browser's own redirect.
    const raw = await request.get(target);
    if (raw.status() !== 200) {
      problems.push(`${target} returned ${raw.status()}`);
      continue;
    }
    const redirect = (await raw.text()).match(/http-equiv="refresh"[^>]*content="\d+;url=([^"]+)"/);
    if (redirect) {
      queue.push(new URL(redirect[1], origin + target).pathname);
      continue;
    }

    await page.goto(target);
    const info = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      h1: document.querySelectorAll('h1').length,
      mains: document.querySelectorAll('main').length,
      noindex: Boolean(document.querySelector('meta[name="robots"][content*="noindex"]')),
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
      ids: [...document.querySelectorAll('[id]')].map((el) => el.id),
      links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')!),
      assets: [
        ...[...document.querySelectorAll('img')].flatMap((img) => [
          img.getAttribute('src') ?? '',
          ...(img.getAttribute('srcset') ?? '')
            .split(',')
            .map((candidate) => candidate.trim().split(/\s+/)[0])
            .filter(Boolean),
        ]),
        ...[...document.querySelectorAll('link[href]')].map((l) => l.getAttribute('href')!),
        ...[...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')!),
      ],
    }));
    idsByPage.set(target, info.ids);

    if (!info.title.trim()) problems.push(`${target}: empty <title>`);
    if (!info.lang) problems.push(`${target}: <html> has no lang`);
    if (info.h1 !== 1) problems.push(`${target}: expected one <h1>, found ${info.h1}`);
    if (info.mains !== 1) problems.push(`${target}: expected one <main>, found ${info.mains}`);
    if (!info.noindex && !info.description.trim()) problems.push(`${target}: no meta description`);

    for (const href of info.links) {
      if (/^(mailto:|tel:|javascript:)/.test(href)) continue;
      const url = new URL(href, origin + target);
      if (url.origin !== origin) continue; // Links to other sites are not fetched by this suite.
      if (url.hash && url.pathname === target) {
        anchorChecks.push({ from: target, path: target, hash: decodeURIComponent(url.hash.slice(1)) });
      } else if (url.pathname.endsWith('/')) {
        queue.push(url.pathname);
        if (url.hash) anchorChecks.push({ from: target, path: url.pathname, hash: decodeURIComponent(url.hash.slice(1)) });
      } else {
        assets.add(url.pathname);
      }
    }
    for (const src of info.assets) {
      if (!src || src.startsWith('data:')) continue;
      const url = new URL(src, origin + target);
      if (url.origin === origin) assets.add(url.pathname + url.search);
    }
  }

  for (const check of anchorChecks) {
    const ids = idsByPage.get(check.path);
    if (ids && !ids.includes(check.hash)) problems.push(`${check.from}: link to ${check.path}#${check.hash} has no matching id`);
  }

  for (const asset of assets) {
    const response = await request.get(asset);
    if (!response.ok()) problems.push(`${asset} returned ${response.status()}`);
  }

  const expected = builtPages().filter((p) => !isPrintRoute(p));
  for (const built of expected) {
    if (!crawled.has(built)) problems.push(`${built} is built but nothing links to it`);
  }

  for (const [where, errors] of consoleErrors) problems.push(`${where}: console errors: ${errors.join(' | ')}`);

  expect(problems, problems.join('\n')).toEqual([]);
  expect(crawled.size).toBeGreaterThanOrEqual(expected.length);
});
