# Deploy-update pipeline: how an open tab crosses a release

How a running client detects a new deployment, gets onto it, and how many reloads that may
take. Written from the 2026-07 audit of the v5.6.0 -> v5.6.1 transition (multiple reloads in a
row, "Update needed" screen, version label reading v5.6.0 while the fixed 5.6.1 behavior
demonstrably worked). Covers the moving parts, the exact update sequence, the reload bounds,
the incident reconstruction, and the manual verification steps for the service-worker
lifecycle (which cannot be covered by unit tests).

## Components

| Piece                | Where                                                                                    | Role                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build identity       | `frontend/vite.config.ts` (`APP_VERSION`, `GIT_SHA`)                                     | One constant pair shared by the `__APP_VERSION__` / `__GIT_SHA__` defines and `version.json`, so a single build can never disagree with its own stamp.                                                                                                     |
| `version.json`       | emit-version-json plugin; served `no-cache` (`public/_headers`), `NetworkOnly` in the SW | The freshness probe: `{version, gitSha, builtAt}` of whatever the server currently runs.                                                                                                                                                                   |
| Update watcher       | `frontend/src/core/appVersion.ts`                                                        | Polls `version.json` (5 min interval + tab focus + 15 s after boot). On sha mismatch: toast, then service-worker refresh + one reload at the next in-app navigation (hashchange). Owns the `displayVersion` / `serverVersion` / `updateAvailable` signals. |
| Stale-chunk recovery | `frontend/src/core/bootRecovery.ts`                                                      | `vite:preloadError` / chunk-shaped rejection after a deploy -> service-worker refresh + one guarded reload.                                                                                                                                                |
| Boot watchdog        | inline script in `frontend/index.html`                                                   | Pre-JS last resort: app asset fails before boot, or nothing mounts in 12 s -> clear SW + caches, reload (one attempt per 2-minute cooldown), else the "Update needed" panel.                                                                               |
| Service worker       | `vite-plugin-pwa` (generateSW), production builds only                                   | `skipWaiting` + `clientsClaim`; precaches only icons/fonts; navigations and js/css are NetworkFirst runtime caches. Registered by the plugin-emitted `registerSW.js` (plain registration, no reload-on-update wiring).                                     |
| Edge                 | `frontend/server/assets-worker.ts`, `public/_headers`                                    | Hashed assets immutable; `index.html`, `sw.js`, `version.json` no-cache; asset misses are real 404s (never the SPA fallback); navigations fall back to `index.html`.                                                                                       |
| Version display      | `LoginScreen` footer, Settings -> About, crash modal                                     | All read `displayVersion()` from `appVersion.ts` — never raw `__APP_VERSION__`.                                                                                                                                                                            |

## The update sequence for an already-open tab

State: tab runs build A (sha `aaaa`), its service worker SW-A is active. Deploy B (sha
`bbbb`) replaces the assets; old hashed chunks are gone from the server.

1. Within 5 minutes (or on the next tab focus), `checkForUpdate()` reads `version.json`
   (no-cache, NetworkOnly — the SW never interferes). `gitSha bbbb != aaaa` -> `updateAvailable`
   flips, one toast is shown, Settings About renders "vB available", and a reload is armed.
2. On the user's next in-app navigation (hashchange), `reloadForUpdate()`:
   - checks the guards (below); if spent, does nothing — the toast remains as the manual path;
   - records the attempt, then calls `activateUpdatedServiceWorker()`: triggers
     `registration.update()`, and — because the generated SW ships `skipWaiting` +
     `clientsClaim` — the new SW-B installs, activates, claims the tab, and purges SW-A's
     precache. The wait is bounded (4 s per phase); failure or timeout just proceeds;
   - reloads once.
3. The reload's navigation is served NetworkFirst by whatever SW controls the page (or by the
   network directly if none): the edge serves `index.html` no-cache -> the response is build
   B's shell -> hashed entry/chunks load from the network (immutable, present) -> build B
   executes. `checkForUpdate` now sees matching shas and stands down.

That is the whole intended path: one reload, served fresh regardless of service-worker
timing, because **no service worker ever serves a precached `index.html` anymore**.

If the user never navigates, the tab simply keeps running build A until they do (or reload
manually via the toast/About hint) — deliberate: never yank an active view.

### The lazy-chunk race (user navigates before the watcher fires)

A navigation to a not-yet-loaded route can hit a deleted chunk before the next poll:
the import fails as an honest 404 (edge guarantees this), Vite raises `vite:preloadError`,
`bootRecovery` refreshes the SW the same way and reloads once (session-guarded; the guard
self-clears 10 s after a healthy boot so a later deploy can recover again). Same landing as
step 3.

### The pre-boot race (deploy lands between HTML and entry fetch)

A tab that (re)loads exactly across the deploy can get shell A and find A's entry deleted.
The app never boots, so in-bundle recovery cannot run; the inline watchdog catches the asset
error (or the 12 s no-mount backstop), clears SW + caches, reloads once per 2-minute
cooldown, and only then shows the manual "Update needed" panel (Reload / Reset app cache).

## Reload bounds (why a loop is now impossible)

| Trigger              | Guard                                                                                                                                        | Bound                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Version watcher      | one reload per server sha (`tc-version-reload`) AND max 3 reloads per rolling 10 min across shas (`tc-version-reload-times`), sessionStorage | back-to-back releases get one reload each; a flapping pipeline hits the cap and goes manual         |
| Stale-chunk recovery | one reload per session (`tc-chunk-reloaded`), cleared 10 s after healthy boot                                                                | one attempt per deploy transition                                                                   |
| Boot watchdog        | one clear+reload per 2 min (`tc-recovered` timestamp)                                                                                        | a second release later in the same session still auto-recovers; rapid repeats hand off to the panel |

Previously the watchdog guard was once per browser SESSION (never cleared on success), so the
second release of the day went straight to the "Update needed" panel — part of the observed
incident. The panel's plain Reload then looped against the old SW's precached `index.html`.

## What was wrong before (2026-07-16/17 incident reconstruction)

Symptoms: several auto-reloads in a row across the v5.6.0/v5.6.1 window, the "Update needed"
screen, then a settled tab whose label said v5.6.0 while the 5.6.1 fix demonstrably worked
and the network served 5.6.1.

1. **Reload-vs-SW race (the loop generator).** `index.html` was precached and served for all
   navigations via `navigateFallback`. A version-mismatch reload therefore asked the OLD
   service worker for the page and got the OLD shell back, whose hashed chunks were already
   deleted server-side -> boot failure -> watchdog clear+reload. Whether one reload round
   converged depended on whether the browser's own SW update check won the race. Fix:
   never precache/fallback `index.html`; navigations are NetworkFirst (fresh whenever online),
   and every recovery path refreshes the SW before its single reload.
2. **Watchdog once-per-session guard.** See table above — release two of the day escalated to
   the scary panel instead of quietly recovering. Fix: 2-minute cooldown.
3. **Per-release SW teardown.** The `sw-cleanup` inline script unregistered ALL service
   workers whenever `package.json`'s version changed, racing the fresh registration on every
   release's first load, and keyed on a THIRD version source (`package.json` vs tag /
   describe). Fix: keyed to an explicit `SW_CLEANUP_EPOCH` (bumped only on strategy
   migrations, e.g. this one), and re-registers after the unregisters settle.
4. **Mis-stamped builds (the lying label).** `APP_VERSION` fell back to
   `git describe --tags --abbrev=0`, so any prod build NOT made from a tag ref (a
   `workflow_dispatch` deploy from main, a Cloudflare Workers Builds auto-deploy) stamped the
   PREVIOUS release's version onto NEWER code: executing 5.6.1-fix code labeled "5.6.0".
   `version.json` from the later tag deploy then said 5.6.1 while the executing (previous,
   mis-stamped) bundle showed 5.6.0 — the exact reported contradiction. The changelog is
   bundled (`CHANGELOG.md?raw`), so "the entry contains the 5.6.1 literal" does not identify
   a build; only `gitSha` does. Fixes: `git describe --tags` (no `--abbrev=0`) makes a
   non-tag build stamp itself honestly (`5.6.0-2-gf6ba930`), and at runtime the label
   self-corrects: when `version.json` reports the SAME sha we are running under a different
   version string, the network string wins (`displayVersion`); when the sha differs, the
   label keeps the EXECUTING version and the UI announces the pending one (`serverVersion`).
5. **Offline shell was decorative.** js/css runtime cache expired after 5 minutes, so
   "offline" boots had a shell but no entry JS. Now 7 days (online behavior unchanged —
   NetworkFirst always prefers the network).

## Back-to-back releases (the 40-minute double)

Two deploys land while a tab is open: the first mismatch arms a reload for sha B1; the guards
allow it; if B2 lands before the reload happens, the poll simply re-arms for B2 (per-sha
guard is keyed by sha, and the rolling cap admits 3 per 10 min). Each transition converges in
one reload because the shell is never served stale. The watchdog cooldown (2 min) likewise
admits one clean recovery per release. A pipeline redeploying more than 3 times inside 10
minutes stops auto-reloading and leaves the toast — by design.

## Deployment-side invariants (action items outside this repo)

- **Prod deploys only from `v*` tags** (`deploy-frontend.yml`). A `workflow_dispatch` prod
  deploy from main now stamps a describe-suffixed version rather than impersonating the last
  release, but it still creates an extra client transition — prefer tagging.
- **Cloudflare Workers Builds must stay disabled** for the `finance-manager` worker (see the
  warning in `deploy-frontend.yml`). If it is on, every push to main deploys prod again,
  multiplying transitions (and, before the stamp fix, each one was mis-labeled). Multiple
  prod deploys within an hour is exactly the storm the incident showed — verify this setting
  when investigating any repeat.
- `_headers` must keep `index.html`, `/sw.js`, and `/version.json` on `Cache-Control:
no-cache` and hashed `/assets/*` immutable. `server/assets-worker.ts` must keep asset
  misses as 404s.

## Manual verification (service-worker lifecycle)

Unit tests cover the decision logic (`src/core/__tests__/appVersion.test.ts`,
`bootRecovery.test.ts`); the SW handoff itself needs a browser. With two locally built
versions (bump a string, rebuild) served over `vite preview` or wrangler dev:

1. **Fresh install**: load the app (production build). DevTools -> Application -> Service
   Workers shows one active worker; Cache Storage has `finance-manager-pages-v1`,
   `finance-manager-js-css-v4`, and the workbox precache (icons/fonts only — confirm
   `index.html` is NOT in the precache list).
2. **Normal update**: with the tab open, deploy build B. Wait for the poll (or refocus the
   tab); expect the toast once and Settings -> About to show "vB available, loads on your next
   navigation". Navigate anywhere in-app: exactly ONE reload; About now shows vB and the same
   gitSha as `curl /version.json`; the SW panel shows the new worker active (no waiting
   worker); no errors in the console.
3. **Stale-chunk path**: open the app on build A, deploy B, then (before the poll fires,
   within 5 min) navigate to a route whose chunk was not yet loaded (e.g. a calculator).
   Expect a single automatic reload onto B — no crash modal, no "Unexpected token" error.
4. **Reload discipline**: in the tab from step 2, `sessionStorage` shows `tc-version-reload`
   = B's sha and one timestamp in `tc-version-reload-times`. Deploy C and repeat: it reloads
   again (new sha), timestamps now two. Force a third and fourth mismatch inside 10 minutes:
   the fourth transition must NOT auto-reload (cap), while the toast still shows.
5. **Watchdog cooldown**: on build B with the SW active, stop the server entirely and hard
   reload twice within 2 minutes. First: automatic clear+reload attempt. Second: the "Update
   needed" panel with Reload / "Reset app cache & reload" (this path also proves the offline
   NetworkFirst fallback: with the server up but network throttled to offline, the app shell
   still boots from `finance-manager-pages-v1`).
6. **Epoch migration** (only when `SW_CLEANUP_EPOCH` changes): seed
   `localStorage['fm-sw-ver']` with an old value, load once: the old registration is
   unregistered, the key becomes the new epoch, and a worker is registered again in the same
   load (SW panel never ends empty after a second load).
7. **Label truth**: build with a deliberately wrong `__APP_VERSION__` (e.g.
   `GITHUB_REF_NAME=` and an old local tag), deploy, load: footer/About initially show the
   wrong stamp, then correct themselves to `version.json`'s version within ~15 s (same sha ->
   network string wins) without any reload.

## Invariants to preserve when touching any of this

- One build = one identity: `define`s and `version.json` must come from the same constants.
- `version.json` and `sw.js` must never be cached (edge headers + SW NetworkOnly/denylist).
- No service worker may ever serve `index.html` from a precache: navigations stay
  NetworkFirst.
- Every automatic reload path must (a) refresh the SW first and (b) be bounded by a guard.
- The IndexedDB database name (`finance-manager`) is user data — never rename it, and no
  recovery path may delete IndexedDB or localStorage (SW registrations + Cache Storage only).
