// The test function every spec uses (except the smoke test, which checks the real live site).
// It answers any request to Bandcamp with a stub, so no test ever reaches the network. The Audio
// page embeds a Bandcamp player for every release, so even a test that only visits that page,
// such as the link crawl or the navigation check, would otherwise load them for real.
// A test that wants to record the requests can still set its own route on the page, which
// takes precedence over this one.
import { test as base } from '@playwright/test';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route('https://bandcamp.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>stub player</p>' }),
    );
    await use(context);
  },
});

export { expect, type Page } from '@playwright/test';
