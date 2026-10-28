// The embedding index, as plain functions with no model and no network, so tests can prove every rule
// with a fake embedder. The script that wires in the real model is scripts/build-embeddings.mjs.
//
// An index entry is { id, source, text, model, hash, vector }. `hash` covers the model name and the
// text, so an entry is reused only when neither changed. Everything here is deterministic: the same
// content gives the same file, byte for byte, so an unchanged run leaves no diff.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { VECTOR_DECIMALS } from '../config.mjs';

export const BULLETS_FILE = 'src/data/resume/bullets.yaml';
export const RULES_FILE = 'evals/resume-bullets/system-prompt.md';

const clean = (text) => String(text).replace(/\s+/g, ' ').trim();

/** The fingerprint of one item: changes when the text or the model changes. */
export const contentHash = (text, model) => createHash('sha256').update(`${model}\n${clean(text)}`).digest('hex').slice(0, 32);

/**
 * Every approved bullet (public: true only) and every writing rule, in a fixed order: bullets in the
 * order of bullets.yaml, then the rules in the order of the system prompt.
 * @param {string} root the repository root
 * @returns {{ id: string, source: 'bullet' | 'rule', text: string }[]}
 */
export function collectItems(root) {
  const bullets = yaml.load(fs.readFileSync(path.join(root, BULLETS_FILE), 'utf8')) ?? [];
  const items = bullets
    .filter((b) => b.public === true)
    .map((b) => ({ id: b.id, source: 'bullet', text: clean(b.text) }));

  // The rules are the dash items under "Rules for the bullet:" in the system prompt.
  const lines = fs.readFileSync(path.join(root, RULES_FILE), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^Rules for the bullet:/i.test(l));
  const rules = start < 0 ? [] : lines.slice(start + 1).filter((l) => l.startsWith('- ')).map((l) => clean(l.slice(2)));
  rules.forEach((text, i) => items.push({ id: `rule-${i + 1}`, source: 'rule', text }));

  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Two items share the id "${item.id}"`);
    seen.add(item.id);
  }
  return items;
}

const round = (n) => Number(n.toFixed(VECTOR_DECIMALS));

/**
 * Builds the index, calling `embed` only for items that are new or changed.
 * @param {{ items: { id: string, source: string, text: string }[], previous: object[], model: string, embed: (texts: string[]) => Promise<number[][]> }} args
 * @returns {Promise<{ entries: object[], embedded: number, reused: number, removed: number }>}
 */
export async function buildIndex({ items, previous, model, embed }) {
  const old = new Map((previous ?? []).map((e) => [e.id, e]));
  const reuse = (item, hash) => {
    const e = old.get(item.id);
    return e && e.hash === hash && e.model === model && Array.isArray(e.vector) ? e : null;
  };

  const planned = items.map((item) => ({ item, hash: contentHash(item.text, model) }));
  const todo = planned.filter((p) => !reuse(p.item, p.hash));
  const vectors = todo.length ? await embed(todo.map((p) => p.item.text)) : [];
  if (vectors.length !== todo.length) throw new Error(`The embedder returned ${vectors.length} vectors for ${todo.length} texts`);
  const fresh = new Map(todo.map((p, i) => [p.item.id, vectors[i].map(round)]));

  const entries = planned.map(({ item, hash }) => ({
    id: item.id,
    source: item.source,
    text: item.text,
    model,
    hash,
    vector: fresh.get(item.id) ?? reuse(item, hash).vector,
  }));
  const kept = new Set(items.map((i) => i.id));
  return { entries, embedded: todo.length, reused: items.length - todo.length, removed: [...old.keys()].filter((id) => !kept.has(id)).length };
}

/** The file text for an index: one entry per line, so a change to one bullet is one changed line. */
export function serializeIndex(entries) {
  const dimensions = entries[0]?.vector.length ?? 0;
  return `{\n"dimensions": ${dimensions},\n"items": [\n${entries.map((e) => JSON.stringify(e)).join(',\n')}\n]\n}\n`;
}

/** Reads an index file; a missing or unreadable file is an empty index. */
export function readIndex(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data.items) ? data : { dimensions: 0, items: [] };
  } catch {
    return { dimensions: 0, items: [] };
  }
}

/**
 * Compares an index with the content it should hold. Needs no model. Returns a list of problems;
 * an empty list means the index is complete and current.
 * @returns {string[]}
 */
export function checkIndex({ items, index, model }) {
  const problems = [];
  const byId = new Map(index.items.map((e) => [e.id, e]));
  for (const item of items) {
    const e = byId.get(item.id);
    if (!e) problems.push(`missing: ${item.source} "${item.id}" is not in the index`);
    else if (e.hash !== contentHash(item.text, model) || e.model !== model) problems.push(`stale: ${item.source} "${item.id}" changed since it was embedded (or the model changed)`);
    else if (e.text !== item.text) problems.push(`stale: the stored text of "${item.id}" differs from the source`);
    else if (!Array.isArray(e.vector) || e.vector.length !== index.dimensions || !e.vector.every(Number.isFinite)) problems.push(`broken: the vector of "${item.id}" is not ${index.dimensions} finite numbers`);
  }
  const wanted = new Set(items.map((i) => i.id));
  for (const e of index.items) if (!wanted.has(e.id)) problems.push(`extra: "${e.id}" is in the index but is not an approved bullet or a rule`);
  return problems;
}
