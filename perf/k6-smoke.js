// k6 smoke test for the built site (see the README section "Performance budgets and the k6 smoke test").
//
// "Smoke" means small on purpose: a few virtual users for a short time. It asks one question - does the
// preview server answer every page, quickly and without errors, when a few visitors arrive at once? It is
// not a capacity test and it does not measure rendering (that is Lighthouse's job; k6 sends plain HTTP
// requests and has no browser).
//
// It only ever talks to a local address. scripts/perf.mjs starts `astro preview` on 127.0.0.1 and passes
// the address in BASE_URL. The guard below stops the script before the first request if BASE_URL points
// anywhere else, so it cannot be aimed at the live site (or at someone else's server) by mistake.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:4321';

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE_URL)) {
  throw new Error(`BASE_URL must be http://127.0.0.1 or http://localhost (with an optional port), but it is "${BASE_URL}". This test never runs against another host.`);
}

// The same three pages Lighthouse measures.
const PAGES = ['/', '/resume/qa/', '/art/'];

export const options = {
  vus: 3, // virtual users: three "visitors" looping at the same time
  duration: '20s',
  thresholds: {
    // Fewer than 1% of requests may fail (a failed request is a refused connection or a 4xx/5xx answer).
    http_req_failed: ['rate<0.01'],
    // 95% of requests must finish in under 100 ms. p(95) is the "slow but not worst case" measure: it
    // ignores the slowest 5% so one hiccup does not fail the run, but a real slowdown still does.
    http_req_duration: ['p(95)<100'],
    // Every page must also return the status and a body we expect (see the checks below).
    checks: ['rate>0.99'],
  },
};

export default function () {
  for (const path of PAGES) {
    const response = http.get(`${BASE_URL}${path}`);
    check(response, {
      'status is 200': (r) => r.status === 200,
      'body is HTML': (r) => typeof r.body === 'string' && r.body.includes('<html'),
    });
  }
  sleep(1); // a visitor reads for a second before the next round
}
