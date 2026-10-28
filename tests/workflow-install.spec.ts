import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';

// Every workflow step that installs npm dependencies must skip the GPU download of onnxruntime-node.
// On Linux its install script fetches CUDA libraries from NuGet, which this project never uses (the
// embedding model runs on the CPU) and which timed out once and failed a build. npm 12 blocks the script
// through allowScripts, but the npm in CI does not, so each install step sets the variable itself.
// They read the workflow files only: no browser, no network.

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
const dir = path.join(root, '.github', 'workflows');
const installSteps: { workflow: string; step: string; env?: Record<string, string> }[] = [];

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()) {
  const doc = yaml.load(fs.readFileSync(path.join(dir, file), 'utf8')) as { jobs?: Record<string, { steps?: Step[] }> };
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const s of job.steps ?? []) {
      const installs = /\bnpm ci\b/.test(s.run ?? '') || (s.uses ?? '').startsWith('withastro/action');
      if (installs) installSteps.push({ workflow: file, step: s.name ?? s.uses ?? s.run ?? '(unnamed)', env: s.env });
    }
  }
}

test.describe('Workflow installs skip the unused GPU download', { tag: ['@req-419'] }, () => {
  test('the six workflows that install dependencies are all found, so this check cannot pass by finding nothing', () => {
    expect([...new Set(installSteps.map((s) => s.workflow))]).toEqual(['ai-eval.yml', 'api-live.yml', 'ci.yml', 'deploy.yml', 'performance.yml', 'smoke.yml']);
  });

  test('every install step sets ONNXRUNTIME_NODE_INSTALL to skip', () => {
    const missing = installSteps.filter((s) => s.env?.ONNXRUNTIME_NODE_INSTALL !== 'skip').map((s) => `${s.workflow}: "${s.step}"`);
    expect(missing, 'install steps without ONNXRUNTIME_NODE_INSTALL: skip').toEqual([]);
  });

  test('no install step also hands a secret to the install', () => {
    // The install runs third-party install scripts, so it must never see a key (ai-eval keeps its key to one later step).
    const leaking = installSteps.filter((s) => Object.values(s.env ?? {}).some((v) => String(v).includes('secrets.'))).map((s) => `${s.workflow}: "${s.step}"`);
    expect(leaking).toEqual([]);
  });
});
