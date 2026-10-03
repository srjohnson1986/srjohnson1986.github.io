// Prints each resume print route to a PDF. Runs after `astro build` (see package.json).
//
// How it works:
//   1. Find every variant by listing dist/resume/print/<variant>/index.html, so the PDFs
//      always match the print routes the build just produced.
//   2. Serve dist/ on a throwaway local port, so the pages load their CSS and icons the
//      same way they do on the live site.
//   3. Open each print route in headless Chromium and save it as
//      dist/resume/steven-johnson-resume-<variant>.pdf. Page size and margins come from
//      the @page rule in src/styles/print.css.
//
// Any problem exits non-zero, so a missing or broken PDF fails the build and the deploy.

import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const printDir = path.join(dist, 'resume', 'print');

const MIN_PDF_BYTES = 5_000;
const MAX_EXPECTED_PAGES = 2;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function fail(message) {
  console.error(`\nbuild-pdfs: ${message}`);
  process.exit(1);
}

async function findVariants() {
  let entries;
  try {
    entries = await readdir(printDir, { withFileTypes: true });
  } catch {
    fail(`${path.relative(root, printDir)} not found. Run "astro build" first.`);
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hasPage = await stat(path.join(printDir, entry.name, 'index.html')).then(() => true, () => false);
    if (hasPage) ids.push(entry.name);
  }
  return ids.sort();
}

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      let file = path.join(dist, pathname);
      if (path.relative(dist, file).startsWith('..')) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Rough page count: Chromium writes one "/Type /Page" object per page ("/Type /Pages" is the tree).
const countPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

const variants = await findVariants();
if (variants.length === 0) fail('no print routes found under dist/resume/print/.');

const server = await startServer();
const { port } = server.address();

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  server.close();
  fail(`could not start Chromium. Install it with: npx playwright install chromium-headless-shell\n${error.message}`);
}

const problems = [];
try {
  for (const id of variants) {
    const page = await browser.newPage();
    const badResponses = [];
    page.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`http://127.0.0.1:${port}/resume/print/${id}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.close();

    const file = path.join(dist, 'resume', `steven-johnson-resume-${id}.pdf`);
    await writeFile(file, pdf);

    const pages = countPages(pdf);
    const kb = Math.round(pdf.length / 1024);
    console.log(`build-pdfs: ${path.relative(root, file)}  ${pages} page(s), ${kb} KB`);

    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) problems.push(`${id}: output is not a PDF`);
    if (pdf.length < MIN_PDF_BYTES) problems.push(`${id}: PDF is only ${pdf.length} bytes`);
    if (pages === 0) problems.push(`${id}: could not count any pages`);
    if (pages > MAX_EXPECTED_PAGES) problems.push(`${id}: ${pages} pages (expected at most ${MAX_EXPECTED_PAGES}); trim bullets or tighten print.css`);
    for (const bad of badResponses) problems.push(`${id}: failed to load ${bad}`);
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) fail(`\n  - ${problems.join('\n  - ')}`);
console.log(`build-pdfs: ${variants.length} PDF(s) written to dist/resume/`);
