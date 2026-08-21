---
name: tour-check
description: Verify the guided spotlight tours end-to-end by walking every tour step in a real browser (frontend/scripts/walk-tours.mjs) against a seeded demo account, and assert each step spotlights a visible element. Use after ANY change to tour steps or the UI they target — SPOTLIGHT_TOURS in src/core/spotlightStore.ts, Spotlight.tsx, data-tour anchors, the sidebar, or a page's layout — and before releases (e.g. "/tour-check", "verify the tours", "are the tours still working?").
---

# /tour-check — walk every guided tour and verify the spotlights

Onboarding is a set of per-page spotlight tours. Their anchors rot silently when the UI is
refactored, so the only trustworthy check is walking every step in a real browser.
`frontend/scripts/walk-tours.mjs` does that and exits non-zero if any step's spotlight misses.

## Two layers, and why you need both

1. **Static guardrails** — `src/core/__tests__/spotlightStore.test.ts` (runs in `pnpm test`).
   Proves every step targets a `[data-tour="..."]` anchor, that the anchor key exists in some
   component's source, that every `requiredPage` is a real route, and that **every route is
   reachable from the sidebar**. Cheap, runs in CI, catches renames and orphaned pages.
2. **The browser walk** — this skill. Proves each anchor is actually _rendered and visible_
   when the tour reaches it. A static check cannot know that an anchor sits behind a tab, in a
   collapsed section, or on a page that renders an empty state with no data.

## Steps

1. **Boot the seeded demo stack.** The tours point at real rows; walking an empty database
   produces empty states and false MISSes.

   ```sh
   cd <repo root>
   mkdir -p db assets
   NODE_ENV=test node backend/index.js &                 # legacy API on :3847
   curl -fsS --retry 10 --retry-connrefused -c /tmp/c.txt \
     -X POST http://127.0.0.1:3847/api/auth/login \
     -H 'Content-Type: application/json' -H 'X-Skip-RateLimit: true' \
     -d '{"username":"person","password":"something-like-this"}'
   curl -fsS -b /tmp/c.txt -X POST http://127.0.0.1:3847/api/profiles/reseed-demo \
     -H 'X-Skip-RateLimit: true' -H 'X-Profile-ID: 1'
   cd frontend && API_PROXY_TARGET=http://127.0.0.1:3847 npm run dev -- --port 3800 --strictPort &
   ```

   `API_PROXY_TARGET` matters: without it the dev server proxies `/api` to the Cloudflare
   worker (:8787) instead of the seeded demo backend, and login fails.

2. **Walk.**

   ```sh
   cd frontend
   pnpm run test:tours              # desktop 1280x800
   MOBILE=1 pnpm run test:tours     # iPhone 390x844 (touch)
   TOUR=categories pnpm run test:tours   # just one tour
   ```

   Env: `BASE_URL` (default `http://127.0.0.1:3800`), `CHROMIUM` (sandboxes usually need
   `CHROMIUM=/opt/pw-browsers/chromium`).

3. **Read the output.** Every step prints `ok` or `MISS` with its title and the spotlight's
   pixel size. A `MISS` means either the app raised its own "target missing" banner, or the
   highlight rect never reached a sane size. Fix by checking, in order: does the `data-tour`
   key still exist in the component? is the anchor rendered in the page's _empty_ state too
   (the targeting contract requires it)? is it behind a tab or collapse that the tour never
   opens? did the page fail to load its lazy chunk?

## Architecture (where things live)

- **Tours & steps**: `src/core/spotlightStore.ts` — `SPOTLIGHT_TOURS`, built through the
  `step(key, page, title, description, placement)` helper, which produces the
  `[data-tour="<key>"]` selector and sets `requiredPage`.
- **Engine**: `src/components/Spotlight.tsx` — resolves the target with a MutationObserver
  (~6s budget, so a lazy page chunk has time to mount), draws an SVG backdrop with a cutout
  plus a glow rect, and renders a `targetMissing` banner when the selector never resolves.
- **Navigation**: `App.tsx` watches the active step and navigates to `step.requiredPage`
  (`setActivePage` + `window.location.hash`). This is why a tour can strand a user on a page
  that has no sidebar entry — the static guardrail above now blocks that.
- **Entry point**: the sidebar "What's New" button (`[data-test-id="whats-new-btn"]`) opens
  `TourSelectionModal.tsx`, which lists every tour and calls `startTour(id)`.

## Targeting contract

Anchor every step on a dedicated `data-tour="<key>"` attribute — never a CSS-module class
(they are hashed), a tag, a placeholder, or a `data-test-id`. The anchor must be **always
rendered** on its page, including the empty state, so a fresh account sees the same tour as a
populated one.
