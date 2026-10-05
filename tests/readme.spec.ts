import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';

// Keeps the README in step with the project. It cannot judge whether a sentence is still true, but it
// can catch the drift that is easy to miss: a renamed script, a moved file, a new test area nobody
// described. Like the other specs, it reads the real files instead of a second hand-copied list.
//
// These checks only read files, so they need no browser and no build.

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file: string) => fs.existsSync(path.join(root, file));

const readme = read('README.md');
const claudeNotes = read('CLAUDE.md');
const scripts = Object.keys(JSON.parse(read('package.json')).scripts as Record<string, string>);

// Scripts that may exist without appearing in the README. Empty today: add a name here, with the
// reason, rather than loosening the check.
const scriptsLeftOutOfReadme: string[] = [];

/** The Markdown with fenced blocks and inline code removed, so only real links are left. */
const withoutCode = (markdown: string) => markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** The text inside inline code spans, such as `src/data/site.ts`. */
const codeSpans = (markdown: string) =>
  [...markdown.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);

/** Every npm script the README tells the reader to run, from code spans and fenced blocks alike. */
function commandsNamedIn(markdown: string): string[] {
  const names = new Set<string>();
  for (const match of markdown.matchAll(/npm run ([\w:-]+)/g)) names.add(match[1]);
  // `npm test` is the one script npm lets you run without `run`.
  if (/npm test\b/.test(markdown)) names.add('test');
  return [...names];
}

/** The README files that guide a reader through the repository: the main one, and one per content folder. */
const contentReadmes = fs
  .readdirSync(path.join(root, 'src', 'content'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && exists(`src/content/${entry.name}/README.md`))
  .map((entry) => `src/content/${entry.name}/README.md`);
const readmes = ['README.md', ...contentReadmes];

test.describe('README', () => {
  test('there is enough in the README to check', () => {
    // Guards against a pattern that quietly stops matching and lets every other test pass for nothing.
    expect(commandsNamedIn(readme).length, 'npm commands found in the README').toBeGreaterThanOrEqual(5);
    expect(codeSpans(readme).length, 'code spans found in the README').toBeGreaterThanOrEqual(20);
    expect(contentReadmes.length, 'README files under src/content').toBeGreaterThanOrEqual(2);
  });

  test('every npm command in the README exists in package.json', () => {
    const missing = commandsNamedIn(readme).filter((name) => !scripts.includes(name));
    expect(missing, `The README tells the reader to run these, but package.json has no such script: ${missing.join(', ')}`).toEqual([]);
  });

  test('every npm script in package.json is described in the README', () => {
    const named = commandsNamedIn(readme);
    const undocumented = scripts.filter((name) => !named.includes(name) && !scriptsLeftOutOfReadme.includes(name));
    expect(
      undocumented,
      `package.json has these scripts, but the README does not mention them: ${undocumented.join(', ')}. Add them to the Getting started table.`,
    ).toEqual([]);
  });

  test('the exception list names only scripts that exist', () => {
    expect(scriptsLeftOutOfReadme.filter((name) => !scripts.includes(name))).toEqual([]);
  });

  for (const file of readmes) {
    test(`every relative link in ${file} points to a file that exists`, () => {
      const folder = path.posix.dirname(file);
      const broken: string[] = [];
      for (const match of withoutCode(read(file)).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        // Web addresses, mail links, and in-page anchors are not files in the repository.
        if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
        const withoutAnchor = decodeURI(target.split('#')[0]);
        // GitHub reads a leading slash as the root of the repository.
        const resolved = withoutAnchor.startsWith('/') ? withoutAnchor.slice(1) : path.posix.normalize(path.posix.join(folder, withoutAnchor));
        if (!exists(resolved)) broken.push(`${target} (looked for ${resolved})`);
      }
      expect(broken, `Links in ${file} that point nowhere`).toEqual([]);
    });
  }

  test('every project file named in the README exists', () => {
    // Only paths under the folders that are committed are checked. Generated places, such as dist/ and
    // .astro/, are not in the repository, so they are left alone.
    const named = new Set<string>();
    for (const span of codeSpans(readme)) {
      for (const match of span.matchAll(/(?:^|\s)((?:src|scripts|tests|public|\.github|\.vscode)\/[^\s]*)/g)) named.add(match[1]);
    }
    expect(named.size, 'project paths found in the README').toBeGreaterThanOrEqual(5);
    const missing = [...named].filter((file) => !exists(file));
    expect(missing, 'The README names these files or folders, but they do not exist').toEqual([]);
  });

  test('every spec file in tests/ is described in the README or CLAUDE.md', () => {
    const specs = fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.spec.ts'));
    expect(specs.length, 'spec files found').toBeGreaterThan(10);
    const undescribed = specs.filter((name) => !readme.includes(name) && !claudeNotes.includes(name));
    expect(
      undescribed,
      `These specs are not described anywhere: ${undescribed.join(', ')}. Add a line to the test list in CLAUDE.md and the Testing section of the README.`,
    ).toEqual([]);
  });
});
