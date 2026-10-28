#!/usr/bin/env node
// Builds retrieval/embeddings.json: one vector for every public resume bullet and every writing rule.
//
//   npm run embeddings                 embed what is new or changed and write the file
//   npm run embeddings -- --check      verify the file is complete and current; no model, no network
//
// Never edit embeddings.json by hand: run this script. Unchanged items are reused by content hash, so a
// second run embeds nothing and an edited bullet re-embeds only itself.
// Exit codes: 0 fine, 1 the check found a problem, 2 the run could not be done.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, INDEX_FILE } from '../retrieval/config.mjs';
import { collectItems, buildIndex, serializeIndex, readIndex, checkIndex } from '../retrieval/lib/index.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string[]} argv
 * @param {{ root?: string, embed?: (texts: string[]) => Promise<number[][]>, model?: string, log?: (s: string) => void }} [deps]
 *   `embed` and `model` let tests use a fake embedder; `root` lets them point at made-up data.
 */
export async function main(argv, deps = {}) {
  const root = deps.root ?? repoRoot;
  const model = deps.model ?? MODEL;
  const log = deps.log ?? console.log;
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length) {
    log(`NOT RUN: unknown option ${unknown[0]}`);
    return 2;
  }

  const file = path.join(root, INDEX_FILE);
  const items = collectItems(root);
  const index = readIndex(file);

  if (argv.includes('--check')) {
    const problems = checkIndex({ items, index, model });
    if (problems.length) {
      log(`The embedding index is out of date (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
      problems.forEach((p) => log(`  ${p}`));
      log('Run `npm run embeddings` and commit the result.');
      return 1;
    }
    log(`The embedding index is complete: ${items.length} items, all current.`);
    return 0;
  }

  let embed;
  const lazy = async (texts) => {
    embed ??= await (await import('../retrieval/lib/embedder.mjs')).createEmbedder();
    return embed(texts);
  };
  const { entries, embedded, reused, removed } = await buildIndex({ items, previous: index.items, model, embed: deps.embed ?? lazy });
  const text = serializeIndex(entries);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (before !== text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  log(`Embedded ${embedded}, reused ${reused}, removed ${removed} (${entries.length} items, model ${model}). ${before === text ? 'The file did not change.' : `Wrote ${INDEX_FILE}.`}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Set the exit code and let Node finish by itself (process.exit can crash on Windows while the model's
  // runtime is still shutting down).
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`NOT RUN: ${error.stack ?? error}`);
      process.exitCode = 2;
    },
  );
}
