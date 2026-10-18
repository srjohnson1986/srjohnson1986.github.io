// THROWAWAY (never merged): serves dist/ like a preview server would, but waits 150 ms before every
// answer, to prove the k6 p95 response time threshold fails.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
http
  .createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (file.endsWith(path.sep) || (fs.existsSync(file) && fs.statSync(file).isDirectory())) file = path.join(file, 'index.html');
    setTimeout(() => {
      if (!file.startsWith(dist) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/octet-stream' }).end(fs.readFileSync(file));
    }, 150);
  })
  .listen(4321, '127.0.0.1');
