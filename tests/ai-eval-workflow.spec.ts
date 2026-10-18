import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';

// The AI eval workflow (.github/workflows/ai-eval.yml) holds the only copy of the Anthropic API key
// the project has, so these checks read the file and fail if it ever exposes the key more widely or
// runs more often than intended. They read a file only: no browser, no network.

const file = path.join(root, '.github', 'workflows', 'ai-eval.yml');
const text = fs.readFileSync(file, 'utf8');
type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; if?: string; with?: Record<string, unknown> };
const workflow = yaml.load(text) as {
  on: { workflow_dispatch?: unknown; schedule?: { cron: string }[]; pull_request?: { paths: string[] }; [k: string]: unknown };
  permissions: Record<string, string>;
  concurrency?: { group: string };
  env?: Record<string, string>;
  jobs: Record<string, { if?: string; env?: Record<string, string>; 'timeout-minutes'?: number; permissions?: Record<string, string>; steps: Step[] }>;
};
const job = workflow.jobs.eval;
const secretLines = text.split('\n').filter((l) => l.includes('secrets.') && !l.trim().startsWith('#'));

test.describe('AI eval workflow protects the API key and limits cost', { tag: ['@req-367'] }, () => {
  test('runs only on demand, weekly, and on pull requests that touch the prompts, rules, or workflow', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'schedule', 'workflow_dispatch']);
    expect(workflow.on.schedule).toHaveLength(1);
    // One run a week: day-of-month and month are wildcards, and the day of week is a single day.
    expect(workflow.on.schedule![0].cron).toMatch(/^\d+ \d+ \* \* [0-6]$/);
    expect([...workflow.on.pull_request!.paths].sort()).toEqual(['.github/workflows/ai-eval.yml', 'evals/**', 'src/lib/copy-rules.js']);
  });

  test('never uses pull_request_target, and skips forks and Dependabot', () => {
    // Comments may name it (the workflow explains why it is not used); the configuration must not.
    const withoutComments = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(withoutComments).not.toContain('pull_request_target');
    expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(job.if).toContain("github.actor != 'dependabot[bot]'");
    // The skip applies to pull requests only: the weekly and manual runs always go ahead.
    expect(job.if).toContain("github.event_name != 'pull_request'");
  });

  test('the key comes from the ANTHROPIC_API_KEY secret, and only the eval step can see it', () => {
    expect(secretLines.map((l) => l.trim())).toEqual(['ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}']);
    expect(workflow.env).toBeUndefined();
    expect(job.env).toBeUndefined();
    const holders = job.steps.filter((s) => s.env && Object.values(s.env).some((v) => String(v).includes('secrets.')));
    expect(holders).toHaveLength(1);
    expect(holders[0].run).toBe('npm run eval:bullets');
    // The secret is passed as an environment variable, never spliced into a command line.
    for (const s of job.steps) expect(s.run ?? '').not.toContain('secrets.');
    // No step that installs, builds, or uploads can read it, and nothing echoes or traces it.
    expect(text).not.toMatch(/echo .*(KEY|secrets)/i);
    expect(text).not.toMatch(/set -x|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG/);
  });

  test('has read-only permissions, a job timeout, and a concurrency group', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job['timeout-minutes']).toBeLessThanOrEqual(15);
    expect(workflow.concurrency?.group).toContain('ai-eval');
    const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.['persist-credentials'], 'the checkout does not leave the token in git config').toBe(false);
  });

  test('runs the eval through the npm script and keeps the replies', () => {
    expect(job.steps.some((s) => s.run === 'npm run eval:bullets')).toBe(true);
    const upload = job.steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload?.with?.path).toBe('evals/resume-bullets/results/');
    // Only first-party actions run in a job that holds a secret.
    for (const s of job.steps.filter((x) => x.uses)) expect(s.uses, s.uses).toMatch(/^actions\//);
  });

  test('the npm script exists and the rest of the project does not start the eval', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['eval:bullets']).toBe('node evals/resume-bullets/run.mjs');
    // The normal build, test, and CI workflows must never reach the paid API.
    for (const name of ['build', 'test', 'test:only', 'test:smoke', 'test:api-live']) expect(pkg.scripts[name], name).not.toMatch(/eval/);
    const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).not.toMatch(/eval:bullets|ANTHROPIC/);
  });

  test('the key is never written to the repository', () => {
    // A real key starts with sk-ant- and is long. The fake values in the tests are shorter than that and clearly marked.
    const tracked = ['evals', 'tests', '.github', 'package.json', 'README.md', 'CLAUDE.md'];
    const hits: string[] = [];
    const walk = (p: string) => {
      const full = path.join(root, p);
      if (!fs.existsSync(full)) return;
      if (fs.statSync(full).isDirectory()) {
        for (const e of fs.readdirSync(full)) if (e !== 'results') walk(path.join(p, e));
      } else if (/sk-ant-[A-Za-z0-9_-]{30,}/.test(fs.readFileSync(full, 'utf8'))) hits.push(p);
    };
    tracked.forEach(walk);
    expect(hits).toEqual([]);
  });
});
