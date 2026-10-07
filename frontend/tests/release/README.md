# Release suite

The dev test scope of a release, run by Playwright instead of by hand. Each case is named after its number in
the scope document (`~/.dotfiles/personal/token-circles/releases/<version>/dev-test-scope-*.md`) and tagged
`@release`, so a failure points straight at the line a person would otherwise have walked through.

It is not part of the normal E2E run: the `release` project exists only when `E2E_RELEASE` is set.

```bash
pnpm run test:e2e:release
```

That starts the same local servers as the rest of the suite (the Vite dev server on :3800, `wrangler dev` with a
local D1 on :8787) and runs the `setup` project first. Nothing here talks to prod or to the dev domain.

## Both storage modes

Most cases run twice, through the `both` list in `release-fixtures.ts`:

- **cloud**: the local Worker and D1. Each test creates two profiles of its own, "Personal <tag>" and
  "Family <tag>", seeds them through the API, selects the first, and deletes them afterwards.
- **local**: a fresh browser context that goes through the sign-in screen's "Try without an account", as a
  deployed build does, and waits for the demo data. Everything lives in IndexedDB. The fixture fails the test
  if the console shows `Validation failed` or a `VersionError`, except for the known bugs listed in
  `KNOWN_LOCAL_CONSOLE`.

A case reads rows the same way in either mode (`m.rows(entity, profileId)`) and writes through the same app
calls (`m.api(path, init)`), so its body does not care which mode it is in.

## The two-tab upgrade (section 15)

`s15-two-tab-upgrade.spec.ts` needs production builds of three versions and is skipped without them:

```bash
# once per version, in a throwaway worktree at that commit (v5.15.1, the 5.16.0 release commit, the candidate)
VITE_API_URL=http://127.0.0.1:9 pnpm exec vite build    # a dead port: these builds never reach an API
cp -r dist <builds>/v5151                               # likewise <builds>/v5160 and <builds>/rc

RELEASE_BUILDS_DIR=<builds> pnpm run test:e2e:release tests/release/s15-two-tab-upgrade.spec.ts
```

Each tab is served from its own folder by a Playwright page route on a made-up origin, with service workers
blocked and every other request aborted. Per tab, not per context: an old tab that lazy-loads a chunk after the
new build went live would otherwise get the new `index.html`, reload onto the new build, and close the
connection whose blocking the case is about.

## Known bugs, pinned

A confirmed bug that the release does not fix is recorded with `test.fail(condition, reason)`, so the suite
stays green while the bug exists and turns red, "expected to fail, but passed", the day it is fixed. Remove the
line in the PR that fixes it.

| Case       | Mode  | Bug                                                                                                                                  |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| s01 1.2b   | local | A category saved without an icon fails validation (`icon: null`), since 5.15.1                                                       |
| s02 2.7b   | both  | An open bill calendar keeps a paid bill's "upcoming" dot: its cells read each day once (`BillCalendar.tsx:255`)                      |
| s02b 2.17b | both  | The same stale cells keep a renamed category's old name and colour; in local-first the calendar has no colour at all                 |
| s02b 2.17  | local | Local-first bills, subscriptions and recurring rules carry no category name or colour (`handlers/bills.ts`, `handlers/recurring.ts`) |
| s02b 2.14b | cloud | Analytics fetches `stats/monthly` and `category-trends` twice per refresh                                                            |
| s11 11.4b  | both  | The subscription catalog keeps the currency it was first drawn in (5.16.1's fix is incomplete)                                       |

## Conventions

- Drive the UI by `data-test-id` and roles; never by CSS-module classes, which are hashed.
- Go between pages with `goPage` (a hash change, as the sidebar does), not `page.goto`: pages stay mounted, and
  "follows writes" cases are about exactly that.
- Count requests with `trackApi` (cloud only: local-first reads never touch the network).
- "Tab away for more than 60 s" is `awayAndBack`: the real blur and focus events, with the page's clock moved
  forward instead of a minute's sleep.
- Under load, a 5 s timeout in a full run is usually the machine, not the app. Re-run the file on its own
  before believing it.
