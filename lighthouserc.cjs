// Lighthouse CI settings: which pages to measure, how, and the performance budgets.
// Run it with `npm run perf` (see the README section "Performance budgets and the k6 smoke test").
//
// This file is the one place the budgets live. scripts/perf.mjs reads the same table to build the report
// that puts each measured value next to its budget, and tests/performance.spec.ts checks the numbers.
//
// It is a .cjs file (not JSON) so each number can carry a reason. Lighthouse CI reads CommonJS.

const PORT = 4321;
// Measured only against the local preview server of the built site (scripts/perf.mjs starts it).
// Never the live GitHub Pages site: it is not ours to load, and a number from the internet would
// say more about the network than about a change.
const ORIGIN = `http://127.0.0.1:${PORT}`;

const KB = 1024; // page weight is counted in bytes by Lighthouse; a budget below is written in KB

// One entry per page. Every limit sits above the normal run-to-run spread and well below a real
// regression. The spread was 7 runs on this machine on 2026-10-18; "today" is the median of that.
//   score  - the Lighthouse performance score (0 to 1). Fails below the minimum.
//   lcp    - largest contentful paint, ms: when the biggest thing on screen has appeared.
//   tbt    - total blocking time, ms: how long scripts froze the page after first paint.
//   cls    - cumulative layout shift: how much the page jumped around while loading. No unit.
//   weight - total bytes transferred to load the page, in KB. Measured on `astro preview`, which
//            does not compress, so it is higher than what GitHub Pages sends, but it is steady.
const pages = [
  {
    name: 'Home',
    path: '/',
    pattern: '^http://[^/]+/$',
    // today: score 100, LCP ~1.5 s, TBT 0, CLS 0.003, 81.5 KB
    score: 0.95, lcp: 2000, tbt: 200, cls: 0.05, weight: 125 * KB,
  },
  {
    name: 'Resume',
    path: '/resume/qa/',
    pattern: '/resume/qa/$',
    // today: score 100, LCP ~1.5 s, TBT 0, CLS 0.003, 48.6 KB
    score: 0.95, lcp: 2000, tbt: 200, cls: 0.05, weight: 75 * KB,
  },
  {
    name: 'Art',
    path: '/art/',
    pattern: '/art/$',
    // today: score 100, LCP ~1.45 s, TBT 0, CLS 0.024, 1,122 KB (the flyers are most of it).
    // Looser than the others on purpose: it is the heaviest page.
    score: 0.9, lcp: 2500, tbt: 200, cls: 0.05, weight: 1400 * KB,
  },
];

// 'error' makes a missed budget fail the run (a 'warn' would only print it).
// 'median' compares the middle value of the three runs, so one odd run does not decide the result.
const median = (limit) => ['error', { ...limit, aggregationMethod: 'median' }];

module.exports = {
  ci: {
    collect: {
      url: pages.map((page) => ORIGIN + page.path),
      // Three runs per page, judged by the median: enough to ignore one odd run, short enough for a pull request.
      numberOfRuns: 3,
      settings: {
        // Only the performance category: accessibility is already covered by the axe tests.
        onlyCategories: ['performance'],
        // 'devtools' really slows the network and the CPU in Chrome while the page loads. The default,
        // 'simulate', replays the load on paper, and on this fast local server it made the Art page's LCP
        // jump between 1.4 s and 4.2 s from run to run on identical code. 'devtools' held every page
        // within about 40 ms.
        throttlingMethod: 'devtools',
      },
      // GitHub's runners need Chrome's sandbox switched off to start it; nothing untrusted is opened.
      chromeFlags: '--no-sandbox',
    },
    assert: {
      assertMatrix: pages.map((page) => ({
        matchingUrlPattern: page.pattern,
        assertions: {
          'categories:performance': median({ minScore: page.score }),
          'largest-contentful-paint': median({ maxNumericValue: page.lcp }),
          'total-blocking-time': median({ maxNumericValue: page.tbt }),
          'cumulative-layout-shift': median({ maxNumericValue: page.cls }),
          'total-byte-weight': median({ maxNumericValue: page.weight }),
        },
      })),
    },
    // Keep the results on this machine. The default would publish them to a public Google Cloud bucket.
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
