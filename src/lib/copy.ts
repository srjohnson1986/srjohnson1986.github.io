import { site } from '../data/site';

/** Fills the {name} and {area} placeholders in page text from src/data/site.ts, the one place they are written. */
export const fill = (text: string): string => text.replaceAll('{name}', site.name).replaceAll('{area}', site.area);

export interface Part {
  text: string;
  /** Set for a link; a page path on this site or a #section. */
  href?: string;
}

/**
 * Splits text that contains [words](/path) links into plain and linked parts, so a page can render
 * them as real links. The build only allows links to pages and sections of this site.
 */
export function linkParts(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[1], href: match[2] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
