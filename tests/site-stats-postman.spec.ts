import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from './helpers/test';
import { root } from './helpers/data';
import { REPO } from './helpers/github-api';
// @ts-expect-error - plain JavaScript modules with no type declarations
import { endpoints, schema } from '../scripts/lib/site-stats.mjs';

// The Postman collection (postman/site-stats.postman_collection.json) is generated from the same
// endpoint list and schemas the script and the live Playwright tests use. These checks keep it from
// drifting and from ever holding a secret. Newman runs it against the real API in the weekly "API
// live" workflow, not here. No browser needed.

const file = path.join(root, 'postman', 'site-stats.postman_collection.json');
const text = fs.readFileSync(file, 'utf8');
const collection = JSON.parse(text);

test.describe('site-stats: the Postman collection', { tag: ['@req-362'] }, () => {
  test('the committed collection is exactly what `npm run postman` writes', () => {
    const result = spawnSync(process.execPath, ['scripts/build-postman.mjs', '--check'], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  });

  test('it has one request per endpoint the script calls, with the same paths', () => {
    const paths = Object.values(endpoints(REPO) as Record<string, { path: string }>).map((e) => `{{base_url}}${e.path.replaceAll(REPO, '{{repo}}').replaceAll(encodeURIComponent(REPO), '{{repo}}')}`);
    expect(collection.item.map((i: { request: { url: string } }) => i.request.url)).toEqual(paths);
  });

  test('every request checks the status and the contract, with the real schema embedded', () => {
    const contracts = Object.values(endpoints(REPO) as Record<string, { contract: string }>).map((e) => e.contract);
    collection.item.forEach((item: any, i: number) => {
      const code = item.event[0].script.exec.join('\n');
      expect(code, item.name).toContain("pm.response.to.have.status(200)");
      expect(code, item.name).toContain('jsonSchema(schema)');
      const { $schema, $id, title, ...plain } = schema(contracts[i]);
      expect(code, item.name).toContain(`const schema = ${JSON.stringify(plain)};`);
    });
  });

  test('it carries no secret: the token is a variable filled in at run time', () => {
    expect(collection.auth.bearer[0].value).toBe('{{token}}');
    expect(collection.variable.map((v: { key: string }) => v.key).sort()).toEqual(['base_url', 'repo']);
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|Bearer [A-Za-z0-9]/);
  });
});
