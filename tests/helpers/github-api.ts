// A stand-in for the GitHub API, built from tests/fixtures/github-api/good.json, so the site-stats
// tests never touch the network. `fakeFetch` replaces `fetch` inside the library; `startStub` is a
// real local server for the command-line tests.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints } from '../../scripts/lib/site-stats.mjs';

export type Answer = { status: number; headers?: Record<string, string>; body: unknown; raw?: string };
export type Answers = Record<'repo' | 'issues' | 'pull_requests' | 'pull_requests_merged' | 'commits' | 'releases', Answer>;

export const REPO = 'srjohnson1986/srjohnson1986.github.io';
const fixture = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'github-api', 'good.json'), 'utf8'));

// A fresh deep copy of the recorded answers, so a test can break one field without affecting others.
export function recorded(): Answers {
  const { _comment, ...answers } = structuredClone(fixture);
  return answers as Answers;
}

// Which recorded answer does this request path ask for?
function nameFor(requestPath: string): keyof Answers | undefined {
  const eps = endpoints(REPO) as Record<string, { path: string }>;
  return Object.keys(eps).find((n) => eps[n].path === requestPath) as keyof Answers | undefined;
}

export function fakeFetch(answers: Answers, seen: string[] = []) {
  return async (url: string) => {
    const requestPath = url.replace('https://api.github.com', '');
    seen.push(requestPath);
    const answer = answers[nameFor(requestPath) as keyof Answers];
    if (!answer) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(answer.raw ?? JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
  };
}

export async function startStub(answers: Answers) {
  const server = http.createServer((req, res) => {
    const answer = answers[nameFor(req.url ?? '') as keyof Answers];
    if (!answer) {
      res.writeHead(404).end('{"message":"Not Found"}');
      return;
    }
    res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers }).end(answer.raw ?? JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
