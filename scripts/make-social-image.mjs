// Makes the link-preview image (public/images/social-preview.jpg, 1200 x 630) from the Home
// photo, the site name, and the tagline, in the site's own colors. Run it again after changing
// the photo, the name, or the colors:  node scripts/make-social-image.mjs
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200;
const H = 630;
const D = 380; // photo diameter
const cx = 90 + D / 2;
const cy = H / 2;

const bg = '#fbfaf7';
const fg = '#1b1b1f';
const muted = '#5b5b66';
const accent = '#8a4b1f';
const font = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

const photo = await sharp(path.join(root, 'public/images/steve.jpg'))
  .resize(D, D)
  .composite([{ input: Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`), blend: 'dest-in' }])
  .png()
  .toBuffer();

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="0" y="${H - 14}" width="${W}" height="14" fill="${accent}"/>
  <circle cx="${cx}" cy="${cy}" r="${D / 2 + 10}" fill="none" stroke="${accent}" stroke-width="6"/>
  <text x="560" y="262" font-family="${font}" font-size="84" font-weight="700" fill="${fg}">Steve Johnson</text>
  <text x="562" y="330" font-family="${font}" font-size="38" fill="${muted}">QA and process professional</text>
  <text x="562" y="384" font-family="${font}" font-size="30" fill="${muted}">Resume, projects, audio, and art</text>
  <text x="562" y="478" font-family="${font}" font-size="32" font-weight="600" fill="${accent}">srjohnson1986.github.io</text>
</svg>`;

await sharp(Buffer.from(svg))
  .composite([{ input: photo, left: cx - D / 2, top: cy - D / 2 }])
  .jpeg({ quality: 88 })
  .toFile(path.join(root, 'public/images/social-preview.jpg'));
console.log('wrote public/images/social-preview.jpg');
