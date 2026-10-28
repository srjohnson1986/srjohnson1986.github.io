#!/usr/bin/env node
// Builds the two generated embedding files:
//   retrieval/embeddings.json      one vector for every public resume bullet and every writing rule
//   retrieval/query-vectors.json   one vector for every fixed test query in retrieval/queries.yaml
//
//   npm run embeddings                 embed what is new or changed and write both files
//   npm run embeddings -- --check      verify both files are complete and current; no model, no network
//
// Never edit the generated files by hand: run this script. Unchanged items are reused by content hash, so
// a second run embeds nothing and an edited bullet or query re-embeds only itself.
// Exit codes: 0 fine, 1 the check found a problem, 2 the run could not be done.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, INDEX_FILE, QUERY_VECTORS_FILE } from '../retrieval/config.mjs';
import { collectItems, collectQueries, buildIndex, serializeIndex, readIndex, checkIndex } from '../retrieval/lib/index.mjs';

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

  const targets = [
    { label: 'bullets and rules', file: INDEX_FILE, items: collectItems(root) },
    { label: 'test queries', file: QUERY_VECTORS_FILE, items: collectQueries(root) },
  ];

  if (argv.includes('--check')) {
    let bad = 0;
    for (const t of targets) {
      const problems = checkIndex({ items: t.items, index: readIndex(path.join(root, t.file)), model });
      if (problems.length) {
        bad += problems.length;
        log(`${t.file} is out of date (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
        problems.forEach((p) => log(`  ${p}`));
      } else {
        log(`${t.file} is complete: ${t.items.length} ${t.label}, all current.`);
      }
    }
    if (bad) log('Run `npm run embeddings` and commit the result.');
    return bad ? 1 : 0;
  }

  // The model is loaded only if some item needs embedding, and then only once for both files.
  let embed;
  const lazy = async (texts) => {
    embed ??= await (await import('../retrieval/lib/embedder.mjs')).createEmbedder();
    return embed(texts);
  };
  for (const t of targets) {
    const file = path.join(root, t.file);
    const { entries, embedded, reused, removed } = await buildIndex({ items: t.items, previous: readIndex(file).items, model, embed: deps.embed ?? lazy });
    const text = serializeIndex(entries);
    // Line endings are ignored: Git on Windows may have turned the file's LF into CRLF, which is not a change.
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (before !== text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    log(`${t.file}: embedded ${embedded}, reused ${reused}, removed ${removed} (${entries.length} ${t.label}, model ${model}). ${before === text ? 'The file did not change.' : 'Wrote the file.'}`);
  }
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
