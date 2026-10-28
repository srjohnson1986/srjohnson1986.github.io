// Session memory for the draft command (npm run draft). It remembers which drafts the owner accepted and
// rejected, on this computer only, and turns that into two signals for later drafts: opening verbs to avoid,
// and a few accepted bullets as style guidance.
//
// The file lives under private/, which Git ignores, next to the bullet bank. Nothing here uploads anything:
// the memory reaches the API only inside the prompt of a live draft, the same place the description goes.
// The bullet eval never uses it.

import fs from 'node:fs';
import path from 'node:path';
import { openingWord } from '../../evals/lib/style.mjs';

export const MEMORY_FILE = 'private/draft-memory.json';

// The oldest drafts are dropped past this many, so the file and the prompt stay small.
export const MAX_ENTRIES = 20;
// How many accepted bullets, newest first, are shown to the model as style guidance.
export const MAX_PREFERRED = 3;
export const MEMORY_HEADING = 'Earlier drafts in this session';

export const emptyMemory = () => ({ version: 1, entries: [] });

/** Reads the memory file; a missing or unreadable file is an empty memory. */
export function loadMemory(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data?.version === 1 && Array.isArray(data.entries) ? data : emptyMemory();
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(file, memory) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(memory, null, 2) + '\n');
}

/** Deletes every stored draft. Returns how many there were. */
export function clearMemory(file) {
  const count = loadMemory(file).entries.length;
  fs.rmSync(file, { force: true });
  return count;
}

/**
 * Adds the draft just made as the one waiting for a verdict. Only one draft waits at a time: an earlier
 * one that was never accepted or rejected is dropped, since it tells us nothing.
 */
export function recordDraft(memory, { input, draft, date }) {
  const kept = memory.entries.filter((e) => e.status !== 'pending');
  const entry = { id: `d-${Date.now().toString(36)}-${kept.length}`, date, input, draft, status: 'pending' };
  return { ...memory, entries: [...kept, entry].slice(-MAX_ENTRIES) };
}

/** Marks the waiting draft accepted or rejected. Returns null when there is none. */
export function setVerdict(memory, status) {
  if (!['accepted', 'rejected'].includes(status)) throw new Error(`Unknown verdict "${status}"`);
  const index = memory.entries.findLastIndex((e) => e.status === 'pending');
  if (index < 0) return null;
  const entries = memory.entries.map((e, i) => (i === index ? { ...e, status } : e));
  return { memory: { ...memory, entries }, entry: entries[index] };
}

/**
 * What later drafts are told. `avoid` is the opening verbs of rejected drafts (lowercase, each once);
 * `preferred` is the newest accepted bullets.
 * @returns {{ avoid: string[], preferred: string[] }}
 */
export function signals(memory) {
  const avoid = [...new Set(memory.entries.filter((e) => e.status === 'rejected').map((e) => openingWord(e.draft)).filter(Boolean))];
  const preferred = memory.entries.filter((e) => e.status === 'accepted').slice(-MAX_PREFERRED).reverse().map((e) => e.draft);
  return { avoid, preferred };
}

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The block added to the user message. It is an empty string when there is nothing to say, so a draft with
 * an empty memory is the same request as one without memory.
 */
export function memoryBlock({ avoid, preferred }) {
  if (!avoid.length && !preferred.length) return '';
  const parts = [MEMORY_HEADING];
  if (avoid.length) parts.push(`Do not open the bullet with any of these verbs, because earlier drafts that opened with them were rejected: ${avoid.map(cap).join(', ')}.`);
  if (preferred.length) {
    parts.push(`Bullets accepted earlier. Match their style, but never copy their facts, numbers, tools, or wording:\n${preferred.map((p, i) => `${i + 1}. ${p}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** The rejected opening verb a draft repeats, or null. */
export function reusedVerb(draft, avoid) {
  const verb = openingWord(draft);
  return verb && avoid.includes(verb) ? verb : null;
}
