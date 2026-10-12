# Session: second pass with the Playwright MCP server

- Date: 2026-10-12
- Target: https://srjohnson1986.github.io/ as deployed from `main` after #292
- Tester: Claude Code, driving the committed Playwright MCP server (`@playwright/mcp@0.0.83`, headless Chromium, isolated profile) through its own browser tools: navigate, click, evaluate, snapshot, screenshot, resize, and media emulation. This is the first session to use the server itself; the first used the desktop app's built-in browser.
- Time box: short, one sitting. No stopwatch was kept.

## Charter

Explore the pieces the first session did not reach (Art stories and series, a short landscape phone, forced-colors and reduced-motion modes) with the committed MCP setup, looking for anything a visitor would trip over, and note anything that gets in the way of running the setup itself.

## Covered

- **Setup on a fresh machine:** restarted Claude Code, approved the server, and made the first browser call. It failed because the server's browser was not installed (finding 1).
- **Art stories:** opened the "Read more" story on the Grog Shop poster. The text, both story images (loaded, each with a larger-view link), and their captions render, and the story fits its card.
- **Art alt text:** all 34 images have alt text, none empty, none duplicated, none that look like file names.
- **Forced colors and reduced motion:** with `forced-colors: active` and `prefers-reduced-motion: reduce` on the Audio page, the header, filter panel, dropdowns, and tag pills keep visible borders, and the focus ring is a 3px solid outline.
- **Short landscape phone (667 by 375):** the open phone menu is taller than the screen and is not sticky, but the page still scrolls far enough that the last link ("Contact") is reachable, including on the shortest page. The Art larger view fits the screen and its close button is a 44px target inside the window.
- **Console:** no errors or warnings across the pages visited.

## Found

| # | Finding | Severity | Issue | Test | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | The MCP server cannot start a browser on a fresh setup. It brings its own Playwright, so it needs its own Chromium build (v1247 here, against the test suite's 1243), and the README wrongly said it reused the tests' browser | Medium (blocks the whole setup) | #293 | readme.spec.ts: the install command in the docs must use the version pinned in `.mcp.json` | #294 |

The fix is documentation plus a check, not code: the install command (`npx @playwright/mcp@0.0.83 install-browser chrome-for-testing`, about 119 MiB into the user profile) is now in the README and CLAUDE.md. The new test failed before the docs change and fails again when the README version is changed on purpose. The session also confirmed that plain `npx` works as the server command on Windows 11, so the README no longer only guesses at a workaround.

Reviewed and left alone:

- The open phone menu is not sticky and overflows a landscape phone, but it scrolls with the page and every link stays reachable.
- The Art story images sit inside their card, so the page holds 34 images for 32 pieces. That matches the "Showing 32 of 32 pieces" count.

## Not covered

- Real devices and other engines (iOS Safari, Android Chrome on hardware, Firefox, Safari). The server was set to Chromium only.
- Anything inside the Bandcamp players, which are cross-origin iframes.
- Screen readers. The accessibility snapshots were read, but nothing was listened to.
- The PDFs' visual quality.
- Slow networks, scripts off, 200 percent zoom, and custom text spacing.
- Wording on Home, Contact, Jabroni Fest, and the project pages.
- The Series stories on the other Art pieces. Only the first story was opened.

## Kept manual

Unchanged from the first session (phone-width look, third-party players, screen reader experience, real devices and browsers, Audio tab-stop volume, tone of wording), plus one more:

- **Fresh-machine setup.** Whether the setup works on a clean computer (approval prompt, browser download, first call) can only be learned by doing it. The new test keeps the install command in step with the pinned version; it cannot run the install.

## Next session

Start with a real phone and Firefox, then the remaining "Not covered" items above.
