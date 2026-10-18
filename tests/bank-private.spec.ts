import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { builtPages, dist, root } from './helpers/data';

// CLAUDE.md: never publish the Target Roles section, the behavioral (STAR) stories, or the internal
// notes from the resume bullet bank. The private bank cannot be read in CI, so the section names are
// written out here on purpose. When the local snapshot is there, every story title in it is checked too.

test.describe('bank-only content is never published', { tag: ['@req-350'] }, () => {
  const files = [...builtPages().map((p) => path.join(dist, p, 'index.html')), path.join(dist, '404.html')];
  const textOf = (file: string) =>
    fs.readFileSync(file, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');

  const privateHeadings = [
    'Target Roles',
    'Behavioral Stories',
    'Behavioral (STAR)',
    'Application Question Answers',
    'Care Communication Board Stories',
    'Thermal Process Development Stories',
  ];

  test('there are pages to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test('no built page shows a private section name from the bank', () => {
    const found: string[] = [];
    for (const file of files) {
      const text = textOf(file);
      for (const heading of privateHeadings) {
        if (text.includes(heading)) found.push(`${path.relative(dist, file)}: "${heading}"`);
      }
    }
    expect(found, 'Private bank sections must not be published').toEqual([]);
  });

  test('no private file is copied into the built site', () => {
    const names: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else names.push(path.relative(dist, full).split(path.sep).join('/'));
      }
    };
    walk(dist);
    expect(names.length).toBeGreaterThan(20);
    const leaked = names.filter((n) => /bank|PROJECT_BRIEF|private\//i.test(n));
    expect(leaked, 'Private files must not be in dist/').toEqual([]);
  });

  test('no story title from the local bank snapshot appears on a built page', () => {
    const bank = path.join(root, 'private', 'bank-export.md');
    test.skip(!fs.existsSync(bank), 'The private bank snapshot is not in this checkout (it never is in CI)');
    const lines = fs.readFileSync(bank, 'utf8').split(/\r?\n/);
    const titles: string[] = [];
    let inStories = false;
    for (const line of lines) {
      if (line.startsWith('## ')) inStories = /Stories|Application Question/.test(line);
      else if (inStories && line.startsWith('### ')) titles.push(line.slice(4).trim());
    }
    expect(titles.length, 'the bank should list story titles').toBeGreaterThan(5);
    const pages = files.map((f) => ({ f, text: textOf(f).replace(/\s+/g, ' ') }));
    const found = pages.flatMap(({ f, text }) => titles.filter((t) => text.includes(t)).map((t) => `${path.relative(dist, f)}: "${t}"`));
    expect(found, 'Story titles from the private bank must not be published').toEqual([]);
  });
});
