// Decides whether the deploy can reuse the Playwright results of a pull request's CI run instead of
// running the whole suite a second time. Used by scripts/reuse-ci-results.mjs; tested in
// tests/deploy-results.spec.ts.
//
// The rule: reuse a run's results only when that run finished green AND tested exactly the code being
// deployed. "Exactly the code" is checked with the Git tree id, a fingerprint of every tracked file.
// CI writes the tree it tested into the artifact (source-tree.txt); the deploy compares it with its own.
// If `main` moved between the check and the merge, the trees differ and the deploy runs the suite itself.
//
// Nothing here touches Git, GitHub, or the disk: the caller passes in functions that do, so the tests
// can pass in made-up ones.

/** The file CI writes next to results.json, holding the Git tree id the run tested. */
export const TREE_FILE = 'source-tree.txt';
export const RESULTS_FILE = 'results.json';
/** How many CI runs of one commit to look at (a commit normally has one; a re-run adds another). */
export const MAX_RUNS = 5;

/**
 * Reads the tree id and the parent commits from the output of `git cat-file -p <commit>`.
 * The raw commit lists its parents even in a shallow clone, so the deploy needs no deeper checkout.
 */
export function parseCommit(text) {
  const header = String(text ?? '').split(/\r?\n\r?\n/)[0].split(/\r?\n/);
  const pick = (key) => header.filter((l) => l.startsWith(`${key} `)).map((l) => l.slice(key.length + 1).trim());
  return { tree: pick('tree')[0] ?? null, parents: pick('parent') };
}

/** True for a Playwright JSON report that holds tests and no failed ones. */
export function usableReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites) || report.suites.length === 0) return false;
  const stats = report.stats;
  if (!stats || typeof stats.expected !== 'number' || stats.expected < 1) return false;
  return stats.unexpected === 0;
}

/**
 * @param {object} input
 * @param {string | null} input.tree     tree id of the commit being deployed
 * @param {string[]} input.parents       its parent commits (a merge commit has two)
 * @param {(sha: string) => { id: number }[]} input.listRuns   successful CI runs for a commit, newest first
 * @param {(id: number) => { tree: string | null, report: unknown }} input.download   one run's artifact
 * @returns {{ reuse: boolean, reason: string, runId?: number, report?: unknown }}
 */
export function pickCiResults({ tree, parents, listRuns, download }) {
  if (!tree) return { reuse: false, reason: 'the commit being deployed could not be read' };
  // A pull request merged with a merge commit has two parents: main before the merge, then the pull
  // request's last commit. Anything else (a direct push, a squash) has no CI run to look up this way.
  if (parents.length !== 2) return { reuse: false, reason: 'the commit being deployed is not the merge commit of a pull request' };
  const head = parents[1];

  let runs;
  try {
    runs = listRuns(head) ?? [];
  } catch (error) {
    return { reuse: false, reason: `the CI runs could not be listed (${error.message})` };
  }
  if (runs.length === 0) return { reuse: false, reason: `no successful CI run was found for ${head.slice(0, 7)}` };

  const notes = [];
  for (const run of runs.slice(0, MAX_RUNS)) {
    let artifact;
    try {
      artifact = download(run.id);
    } catch (error) {
      notes.push(`run ${run.id}: its results could not be downloaded (${error.message})`);
      continue;
    }
    if (!artifact?.tree) {
      notes.push(`run ${run.id}: it did not record which code it tested`);
    } else if (artifact.tree.trim() !== tree) {
      notes.push(`run ${run.id}: it tested different code (main changed after the check ran)`);
    } else if (!usableReport(artifact.report)) {
      notes.push(`run ${run.id}: its report is missing, empty, or has a failed test`);
    } else {
      return { reuse: true, reason: `CI run ${run.id} passed on exactly this code`, runId: run.id, report: artifact.report };
    }
  }
  return { reuse: false, reason: notes.join('; ') };
}
