# Developer changelog (detailed)

Full technical detail of every change, for developers and self-hosters. The concise,
user-facing summary — and what the app shows in-product — lives in [CHANGELOG.md](CHANGELOG.md).

All notable changes to Token Circles are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.8.0] — 2026-07-21

### Added

- Delete-a-recent-import (undo a batch). Serverless now stamps `import_id` on inserted transactions (the worker already did); a new `DELETE /api/import-logs/:id` on both runtimes deletes the batch's transactions by `import_id`, recomputes account balances, and drops the log row. Imports predating batch stamping (no `import_id`) delete 0 transactions and just clear the log entry. Frontend: a confirm-guarded "Delete import" button on each Recent Imports entry (toast feedback). (#369)
- `new_accounts` in the import dry-run response — serverless `detectNewAccounts`, worker `newAccts` — surfaced as a "New accounts to create" list in the preview (the account-typed counterpart to the existing new-categories list, which excludes account values). (#368)

### Changed

- Import dedup is multiplicity-aware. A row is skipped only when it matches a transaction that already existed before this import, consuming one matching amount per row from a per-key multiset; identical rows within a single import all import instead of collapsing to one. Bank/1money rows carry a date but no time, so genuine same-day repeats (multiple `UPLATA NAKNADE` fees, repeated same-amount top-ups) were being silently dropped and balances understated. A re-import still dedupes (existing copies consume the incoming ones one-for-one). Preview: within-batch identical rows are "potential duplicates", selected and imported by default (bank-file uploads, which dedupe on a per-second timestamp, stay deselected), each showing the counterpart row it matches (`date · description · amount` / `= row N`). Applied to the serverless (IndexedDB) and Cloudflare worker execute paths + `detectDuplicates`; the Express backend is intentionally out of scope (see ROADMAP). (#368)

### Fixed

- Serverless import now seeds its account map with all existing accounts by name (matching the worker/Express) and falls back to it for the source (means_of_payment) leg of any transaction type — so a transfer whose destination names an existing account resolves both legs instead of one-siding (`transfer_account_id` null) and draining the source. Also adds a `detectNewAccounts` preview list. (#368)
- Account-map keys are trimmed as well as lowercased on both creation/seed and per-row resolution (worker `loadAccounts` key + created account name, serverless `normalizeKeys`), so stray whitespace in a category/account value (e.g. `Revolut ` from a sheet cell) no longer stores the account under `revolut ` while the trimmed lookup `revolut` misses it. On the worker — which resolves the two legs independently — that mismatch dropped only the destination and showed `Erste Current → —` on a fresh import; gviz strips trailing whitespace, so the sheet looked clean. (#370)
- `fromToLabels` now renders an account-to-account transfer's destination from the resolved `transfer_account_id` account name. The destination of such a transfer lives in `transfer_account_id` (not a category), so `category_name` is null and the "to" collapsed to `—` even though the leg was linked and the balance correct. `TransactionTable` builds an id→name map from the accounts it is now passed and hands the resolved from/to names to `fromToLabels` (falling back to the stored `means_of_payment` / `category` text). Display-only; no data change. (#372)

## [5.7.1] — 2026-07-17

### Fixed

- SubscriptionCatalogModal: the price ✓ was a decorative `aria-hidden` selected-indicator with no handler — clicking it bubbled to the row toggle and deselected the item, discarding the typed price (re-selecting reset to the catalog default). Now a real apply button: `stopPropagation`, normalize the raw text (`,`→`.`, empty → catalog default) and keep the item selected; Enter in the field applies too. `.check` is inert (`pointer-events:none`) until `.tok.on`. The submitted amount always flowed through `priceOf()` at read time, so this is a display/UX fix, not a data fix.
- Empty-state create button was left-aligned: `.empty-state` used `text-align:center`, which centers text but not the `display:flex` button. Now a centered flex column across Goals/Housing/Retirement/Budgets/Accounts/Categories (Bills already had it; Dashboard has no CTA). Loans has no empty-state styling at all — separate follow-up.
- Quick Add categories (⌘K command bar + Guided Orbit) were loaded once at app mount and never refreshed, so after a profile switch the picker showed the previous profile's categories, the natural-language parser matched foreign ones, and an entry could be saved with a `category_id` not in the active profile (silently failing to add) until a full reload. A shared `reloadQuickAddCategories()` now runs on profile switch (`profileVersion`) + sign-in and on each quick-add open (category CRUD refetches locally without bumping `profileVersion`, so the open-trigger is needed alongside the switch-trigger). Ordering is safe: `selectProfile` writes `currentProfileId` before bumping the version, and the profile id is read from localStorage at request time.
- Guided Orbit (the floating + quick-add) shows on desktop but had no title and forced clicking the on-screen keypad: added an "Add transaction" heading and physical-keyboard entry while open — digits / `.` / Backspace / Enter (advance, or submit on the confirm step) / Escape (close), with a modifier-key guard so `⌘K`/`Ctrl+digit` shortcuts aren't hijacked. The confirm step's text/date inputs keep their own typing; touch users keep the keypad.

## [5.7.0] — 2026-07-17

### Added

- Bank import adapters for **N26**, **Wise** (per-currency balance statement), **ING NL**, **Sparkasse** (CSV-CAMT), **DKB** (post-2023 + legacy), and a **YNAB-format CSV bridge** (`Date,Payee,[Category,]Memo,Outflow,Inflow` / signed `Amount`) — the de-facto interchange format, so bank2ynab (MIT, ~145 banks) output imports directly. All client-side (statements never leave the browser). Adapters detect by header content via `indexHeader` (vintage-drift-proof, resolves columns by name); filename hints are word-bounded / full-shape so lookalikes don't false-positive (`jan26.csv` ≠ N26, `statement_2026_jan_…` ≠ Wise). Shared `parse.ts` gained `indexHeader`, `decodeTextSniffed` (UTF-8→cp1252 fallback for Sparkasse/DKB legacy), and `normalizeDate` support for `YYYYMMDD` / `DD-MM-YYYY` / `DD.MM.YY` (century pivot) — strictly day-first with a plausibility gate so a stray number in a date column stays invalid; the YNAB adapter decides date order once per file (a mixed US export can't import under two conventions) and tolerates currency symbols / accounting negatives. Synthetic-fixture tests per adapter + a registry cross-detection guard. Deferred: Croatian RBA/ZABA/Karlovačka (await real exports), a config-driven long-tail adapter, PDF statements.
- Reusable `Pill` component (glass capsule + satellite dot), used for the importer's supported-bank/format chips. Onboarding welcome-step "Use local-only" switch (server mode): honest confirm about any existing local workspace, then suppress the demo seed, clear the onboarding flag + stale server profile-selection keys, flip storage to serverless, and reload into a pristine local wizard.

### Changed

- Register → auto sign-in: `LoginScreen`/`LoginModal` obtain a fresh Turnstile token after `register` resolves and log in with the just-entered credentials, landing in the app (a pristine profile opens onboarding). Branded "signing you in" transition; on failure (existing email / captcha) a colored success-tinted notice drops to manual sign-in, preserving the worker's anti-enumeration (login is not gated on `email_verified`). `LoginModal` dismissal can't reload the page out from under the user. Fixed stale `api.ts` JSDoc claiming register/reset set a session cookie.
- Onboarding import step: the wizard footer now carries the flow's true action per sub-step — mapping → "Continue to preview", preview → live "Import selected (N)" (disabled at 0) with a "Don't import" ghost escape — and Back walks the import sub-steps in reverse. `ImportMappingStep`/`ImportPreviewStep` hide their in-body action rows in the embedded (wizard) context only; the standalone Import page is unchanged. Dropzones gained a files-only drag-over highlight and an inline `OrbitSpinner` while reading, with a `nextPaint()` yield (raced against a timeout so a hidden tab can't hang) so the spinner paints before the synchronous `XLSX.read`. Removed the internal-sounding "works in serverless mode — no CORS" copy from the paste tab (parsing is client-side in both modes).
- Confirmation UX unified: `ConfirmButton` now opens the shared centered `ConfirmDialog` (was an inline Confirm?/Yes/No that overflowed narrow cards) across 11 call sites, and the direct `showConfirm` delete callers (Transactions, RecurringSection) match; `confirmStore.showConfirm` gained `{confirmText, cancelText, danger}` → a red confirm for destructive actions (`role="alertdialog"`/`aria-modal`, icon triggers gained `aria-label`). Autopay control → branded `Toggle` (was an unstyled native checkbox — Bills' `.toggleSwitch` class wasn't even defined) in the bill and housing forms; `Toggle` gained a `data-test-id` passthrough. `BillCalendar` day popover uses a solid `--surface` background (was a 22%-transparent glass that let day numbers bleed through). The import preview's collapsible rules editor is spaced off the action bar and table. New `confirmStore` unit tests; `housing`/`goals-crud` specs updated to the modal flow.

### Fixed

- Deploy-update pipeline hardened end to end after the v5.6.0/v5.6.1 transition storm (multiple reloads, "Update needed" panel, version label reading 5.6.0 while 5.6.1 code ran — full audit in `docs/deploy-update-pipeline.md`). Root causes and fixes: (1) the SW precached `index.html` and served it for all navigations, so a version-mismatch reload was re-served the OLD shell by the OLD worker whose chunks were already deleted server-side — `index.html` is no longer precached, `navigateFallback` is off, and navigations are NetworkFirst (`finance-manager-pages-v1`, 4 s offline-fallback timeout), making a plain reload always land on the current build when online; (2) every auto-reload path (`appVersion`, `bootRecovery`) now refreshes the service worker first — `activateUpdatedServiceWorker()` triggers `registration.update()` and waits (bounded 4 s phases) for the skipWaiting+clientsClaim takeover — so one reload suffices; (3) reloads are hard-bounded: one per server sha plus a rolling cap of 3 per 10 minutes across shas (`tc-version-reload-times`), and the pre-boot watchdog moved from once-per-SESSION to a 2-minute cooldown so the second release of the day auto-recovers instead of landing on the panel; (4) `APP_VERSION` now uses `git describe --tags` without `--abbrev=0`, so a non-tag prod build (workflow_dispatch from main, Workers Builds) stamps `5.6.0-2-gf6ba930` instead of impersonating the previous release — the source of the lying label; (5) the displayed version (login footer, Settings About, crash modal) comes from a reconciled `displayVersion()` signal: when `version.json` reports the same sha under a different version string the network string wins, and while an update is pending Settings shows "vNEW available, loads on your next navigation" (`serverVersion()`); (6) the per-release SW unregister in `index.html` (keyed on `package.json` version — a third, divergent version source) became a one-time `SW_CLEANUP_EPOCH` migration that re-registers after unregistering, removing the register/unregister race on every release's first load; (7) the js/css runtime cache maxAge went from 5 minutes to 7 days — online loads are NetworkFirst anyway, and 5 minutes made offline boots fail for any tab older than one poll. Decision logic covered by new unit tests (`appVersion.test.ts`, `bootRecovery.test.ts`, 25 cases); the SW handoff itself has documented manual verification steps.

## [5.6.1] — 2026-07-17

### Fixed

- Subscription scan detected nothing in SERVER (worker/self-hosted) mode — the second instance of the 5.6.0 onboarding-trigger bug: `SubscriptionScan` fetched `/api/transactions` expecting a bare array, but the server returns the paginated envelope `{ rows, total, limit, offset }`; the defensive `Array.isArray` fallback silently scanned an empty list, so every scan (Bills, Import post-import prompt, onboarding wizard step — one shared component) reported "No known subscriptions found". Serverless returns bare arrays, which is why demo-mode testing looked fine. Fixed with a shared `listRows` normalizer in `core/api.ts` (bare array OR `{rows}` envelope → array; unknown → `[]`), now the required idiom for any `apiGet` of a list endpoint. Covered by unit tests and `subscription-scan-server.spec.ts` — a server-mode e2e that seeds recurring charges via the API, pins the envelope shape as a precondition, and asserts detections render (verified to fail against the unfixed code). Detection quality itself was validated against a real 6.5-month Revolut statement: 8 subscriptions found (harness kept out of the repo — personal data).

## [5.6.0] — 2026-07-16

### Added

- OrbitalDivider — the brand's section separator: a thin orbit arc spanning the row with small planets resting on it (one warm, two muted, placed on the curve), the section title docked left like a station label, and an actions slot on the right. The arc draws itself in and planets drift into place when scrolled into view (rect-check based — no IntersectionObserver/rAF, so it also behaves in throttled tabs; disabled under prefers-reduced-motion). Ships with OrbitalAction, a glass pill button whose leading planet-dot orbits on hover (primary variant uses the warm accent instead of solid blue). First applied across the Budgets page; intended to roll out app-wide.
- SectionRail — a fixed vertical orbit on the right edge (desktop ≥1280px) listing the page's sections as small planets: the one nearest the viewport focus lights up with a slowly rotating dashed orbit ring, hovering shows a label chip, clicking glides to the section. Anchors are OrbitalDivider ids; sampled on Budgets.

### Added

- OrbitalToggle — the brand's celestial switch: the knob is the sun riding an orbit-arc track by day; flipping it slides it across into a star-flecked night where it becomes a planet with a slowly turning dashed orbit ring. Swapped in for the light/dark theme toggle in Settings (the plain branded Toggle stays for ordinary settings).

### Changed

- Primary buttons across the app (Add Loan, Set Budget, Add Holding, Add Bill, Mark Paid, Add Transaction, Import, …) now use the Settings brand recipe — azure glass tint, azure text, mixed border and glow — instead of the old solid blue fill (12 page stylesheets, appended overrides).
- Calculators joined the orbital design: Compound Interest's Detailed Projection / Scenario Comparison / Scenario Details and Emergency Fund's coverage sections now use OrbitalDividers above their cards; Emergency Fund's coverage chart gained a proper section title ("Coverage by Fund Level" with an explainer tooltip), and the pointless Show/Hide Details toggle on Coverage Levels was removed — the details always show.
- Analytics' Savings Rate instrument: the % and its label no longer sit crammed side by side in a 100px circle (the label wrapped) — it is now a proper hero stat: large value, "Savings Rate" subtitle beneath, and a period note ("across 2026").
- Analytics got the full orbital treatment: every instrument's title moved out of its card header into an OrbitalDivider above the card (dynamic year/period rides in the divider's meta; the Top Categories explainer in its info tooltip), header rows keep their controls right-aligned, the two-column row wraps each card in a plain column so dividers sit on the page background, a 9-stop SectionRail jumps between sections, and the page subtitle became an InfoTip next to the title.
- Divider placement corrected wherever a divider had landed inside a glass card instead of above it (Goals progress/projections, Housing subscription tracker, Retirement projections, Portfolio holdings/allocation — Portfolio's card visuals moved onto the inner surfaces). Verified by walking every divider's ancestor chain on all ten pages: none sit inside a carded container.
- OrbitalDividers rolled out across the app: Goals (Progress, Projections), Loans (Overview), Portfolio (Holdings, Allocation), Retirement (Projections, Goals), Bills (Unpaid/Paid with live counts in the divider's meta slot), Housing (Subscription Tracker with the monthly total as meta), Accounts (Net Worth Map), and Counterparties (Balance Meridian, By Counterparty). The divider gained an optional `meta` note (count / total after the label). Analytics is the deliberate holdout — its section titles live inside card headers together with live controls (year pickers, compare toggles, export buttons), so its migration (titles + controls into divider action slots, plus a SectionRail) is a focused follow-up.
- Dashboard period stepping polished further: the two dashboard fetches now commit their signals together in one `batch()` (a single visual wave instead of widgets repainting as each fetch lands), Chart.js in-place updates skip the update tween (`update('none')` — rapid stepping reads as calm data changes instead of every chart re-animating), and the OverviewDeck's three internal resources (heatmap, budget radar, portfolio) read `.latest` so profile/year changes can't re-trigger the page-level Suspense.
- Stepping the focus period no longer flashes/reloads the whole view. Two causes fixed: (1) resource-backed pages (Budgets, Bills, Accounts, Categories, Analytics, Bill calendar) read `resource.latest` instead of `resource()`, so a refetch keeps the previous data on screen rather than re-triggering the page-level Suspense fallback; (2) the shared Chart.js wrapper now updates the live chart in place (`chart.update()`) instead of destroy + async re-create, so Dashboard's charts transition smoothly between periods instead of blanking and re-animating from zero.
- Budgets: section headers are now OrbitalDividers — the bulk allocation tools and "Add Allocation" dock in the Category Allocations divider, "Add Category" docks in the Categories divider (orbital pill style replaces the solid blue buttons), and the Budget Forecast card lost its duplicate inner title. Sections breathe again (the forecast card no longer sits glued to the chart above), the categories gallery shows ~3–4 rows before scrolling (was ~2), and the "Zero-based budgeting" subtitle moved into an info tooltip next to the page title (it wrapped badly on phones).

### Added — Onboarding

- First-run onboarding wizard (`components/onboarding/`), a six-step orbital flow shown once to pristine profiles: welcome → name your space (rename the default profile / create one, pick base currency) → first account(s) → bring your data (the real import flow, embedded) → auto-detected subscriptions → orbit-complete celebration. Full-screen night-sky overlay with animated dotted orbit rings + drifting token satellites, a fill-as-you-go progress ring, and a done-state ring that fills to 100% — all continuous motion gated behind `prefers-reduced-motion`. Every step is skippable (are-you-sure confirms where data would be lost, incl. Escape), and a relaunched wizard recognizes existing accounts instead of pitching "your first account".
- Onboarding trigger + memory (`core/onboardingStore.ts`): auto-opens only when the profile has zero accounts AND zero transactions AND zero bills AND no recorded decision. Finishing/skipping stamps `finance_onboarding` in localStorage AND mirrors the decision into the per-profile settings KV (`PUT /api/settings`), so in server mode a completion/skip on one device is respected everywhere (the trigger check reads the KV and caches it locally). Relaunch from Settings → About → "Run setup wizard" or What's New → the tour menu.
- Subscription auto-detection (`features/subscriptionDetection.ts`, pure + 30 table-driven tests): scans transactions for recurring charges matching the catalogue/brand registry (Netflix, Spotify, Claude, 40+), with token matching + a bounded typo budget, cadence inference from the median charge gap (weekly/biweekly/monthly/yearly), catalogue-plan matching (an 18.00 charge → Claude Pro), a dominant-amount-cluster pass that keeps a real Prime cadence detectable amid Amazon shopping, and a guard that only proposes ambiguous mega-retailer tokens with a stable recurring amount. Reviewed via `SubscriptionScan` (brand icons, editable price/period, per-row selection) — surfaced in the wizard, Bills → Subscriptions → "Scan transactions", and a post-import prompt on the Import page.
- `AccountSelect` — account dropdown with in-place "New account…" creation, used by the bank-statement import's per-file target picker (Import page + wizard) so a multi-bank import can create its target accounts without leaving the flow.
- Branded transactional email system (`worker/src/emailTemplates.ts`): every mail (welcome, account-exists, password reset, budget alert, spending report, upcoming-bills reminder, support ack, test) rendered by pure functions returning `{ subject, html, text }` on a shared orbital shell — hosted logo + a small looping orbit GIF ornament (`frontend/public/email/orbit.gif`), bulletproof 600px table layout, dark-only `color-scheme`, hidden preheader, and a footer with app/about/GitHub/Terms/Privacy/Contact links + unsubscribe. Plain-text twins now ship with every Resend send. Mail assets load from the SENDING environment's app origin (dev mails never depend on a prod release). Reminder amounts render in the profile's display currency instead of hardcoded dollars.
- Orbital loading system (`components/OrbitSpinner.tsx`): a binary planet-pair circling a luminous core (warm satellite on the outer ring), plus `OrbitBootScreen` — the full-screen branded boot gate (hero-sized spinner + wordmark) that replaces the bare "Loading…". Used for the boot gate, the shell Suspense fallback, import overlays, and the subscription scan.

### Changed — Onboarding / Import

- Import page decomposed into reusable modules (`features/import/`): a headless `createImportFlow` controller holds all pipeline state + actions, and `ImportDataEntry`/`ImportMappingStep`/`ImportPreviewStep`/`BankRulesEditor` render it — shared verbatim by the Import page and the onboarding wizard. Behavior unchanged on the page.
- Import preview rebuilt as a stacked command panel: stats (total/selected/duplicates) + action buttons on the command row, a compact "Backfill budgets from spending" checkbox (full explanation moved into an InfoTip) on an options row, and duplicate/dry-run/new-category notices stacked below — replacing the single cramped flex row.
- Re-import honesty: the preview dry-run now reports how many rows the dedup pass will skip ("Everything here was already imported"), the result message names already-imported counts in both storage modes, and the import log records total duplicates avoided — a repeat import no longer reads as a bare "Imported 0".
- Brand-new Google sign-ins now receive the welcome email (previously only email/password registrations did); `resolveGoogleUser` returns a `created` flag so the OAuth callback sends it best-effort.
- Scheduled reminder emails (budget alerts, spending reports, upcoming bills) now fire in PRODUCTION: the `triggers.crons` block was added to `worker` env.prod — previously it existed only in env.dev, so prod never sent them. The upcoming-bills reminder (daily cron) was ported from the legacy Node backend, with its own `email_bills_reminders` toggle, Settings UI toggle + preview button, and the same plan/quota/dedup gating.
- Login screen: inline email-format validation (the field turns red with "That doesn't look like a valid email address" once touched, rejecting malformed input before it burns a captcha token) and a "Complete the verification above to continue" hint explaining the disabled submit while Turnstile is pending.

### Fixed — Onboarding / charts / CSP

- CategoryOrbits (spending/allocation rings on Portfolio, Budgets, Analytics, Loans) rendered as a broken donut at both extremes: sparse charts (2–3 rows) piled every arc onto one side from 12 o'clock with a near-full sweep's caps colliding into a notch, and dense charts (7–9 rows on a fixed 13px step) marched the innermost ring to radius 0 and the core to a negative radius. Ring spacing is now adaptive (fits between the outer radius and a 46px inner minimum, strokes slimming to match), the core radius is clamped, launch angles stagger evenly so arcs interleave like orbits, tiny shares get a pixel floor, and near-full sweeps get a cap-collision clamp.
- Bank-statement drops no longer fail silently: file analysis ran inside a void'ed `Promise.all`, so one rejected read vanished and only a second drop "worked". Now snapshots the file list synchronously, shows the loading overlay while parsing, uses `allSettled` so one bad file can't sink the rest, and surfaces per-file read errors.
- Onboarding never auto-opened in SERVER (self-hosted / worker) mode — the pristine-check read `/api/transactions` as a bare array, but the server returns a paginated envelope `{ rows, total, limit, offset }`, so `Array.isArray(transactions)` was always false and the wizard never triggered for a real email/Google signup. `shouldOfferOnboarding` now uses a shape-tolerant `collectionIsEmpty` (handles arrays AND `{ rows }`/`{ total }`), covered by unit tests and a new server-mode e2e (`onboarding-server.spec.ts`) that logs in and asserts a pristine profile opens the wizard. Serverless mode was unaffected (it returns bare arrays), which is why the earlier serverless-only tests passed.
- The onboarding account step recognizes accounts already on the profile when the wizard is relaunched (previously a five-account user still saw "Create your first account" and "Continue without an account").
- Zod's JIT-capability probe (`new Function('')`) — a `securitypolicyviolation` under the app's CSP — is disabled via `z.config({ jitless: true })`, imported first by each schema module (`core/zodConfig.ts`; the probe fires at schema-definition time and, verified against the production bundle, an entry-level import is too late under Rollup chunking). Parsing behavior is identical; the browser used the interpreter path anyway.
- The app icon (`frontend/public/icon-192.png`) was a top-left crop of the logo — regenerated from `icon-192.svg` as the full mark, fixing both the email masthead and the PWA icon.
- Boot/Suspense theme flash removed: `frontend/public/theme-init.js` (external, CSP-safe) stamps the saved theme before first paint.
- The Node self-hosted backend stubs `GET /api/billing/status` (a worker-only Stripe feature) so the client's boot-time plan probe stops logging a 404.
- Flaky e2e: the Goals "progress percentage" reactive test asserted an absolute card count (`initialCards + 1`) that raced against parallel goal specs on the shared backend (~50% failure on main) — now waits for the uniquely-named goal card, matching its sibling test.

## [5.5.0] — 2026-07-15

### Added

- Shareable demo links (`?demo=high|mid|low`): a link switches the app into client-only demo mode and seeds a sample profile before render (the entry applies it before `<App/>` reads the storage mode), then strips the `?demo=` query from the address bar once applied.

### Changed

- Self-hosted the web fonts (Inter, Fraunces, JetBrains Mono) via `@fontsource` (latin + latin-ext subsets) and removed the render-blocking cross-origin Google Fonts `<link>` + preconnects. Removes the third-party dependency and its CSP violations, and lets headings render offline. Fonts are content-hashed into `/assets` and precached by the service worker.
- The dashboard "Upcoming Bills" widget now shows each bill's real icon instead of a generic clock: known subscriptions/brands use their brand mark, other bills use their category icon, and the clock remains only as a last-resort fallback.
- The Analytics spending heatmap now draws noticeably larger cells (and scales its height to match) so the year reads clearly, instead of the previous small/zoomed-out grid.

### Fixed

- Eliminated the "white screen after a deploy" failure class (a stale service worker serving an old `index.html` + the host returning `index.html`, 200 `text/html`, for deleted hashed chunks → `Failed to load module script` MIME errors). A front Worker (`frontend/server/assets-worker.ts`, assets `not_found_handling: "none"`) now returns a real 404 for a missing `/assets/*` and falls back to `index.html` only for navigations; `_headers` cache tiers make hashed assets `immutable` and `index.html`/`sw.js`/`version.json` `no-cache`; the workbox SW gained `cleanupOutdatedCaches`, `skipWaiting`/`clientsClaim`, a navigate-fallback denylist for `/assets`, `/api`, and `version.json`, 200-only caching, and fresh cache names; a `version.json` poller reloads onto a new build at the next navigation (toast fallback); and a pre-JS boot watchdog in `index.html` plus a `vite:preloadError`/chunk-error handler (`core/bootRecovery.ts`) recover when the bundle itself can't load. The crash modal can now clear the service worker + Cache Storage without wiping user data.
- Removed `upgrade-insecure-requests` from the report-only CSP (browsers ignore it there and log a warning); it remains in the enforcing policy. Dropped the Google Fonts origins from the policy now that fonts are self-hosted. (Known remaining report-only finding, left visible for a future CSP-enforce decision: a vendored library trips `unsafe-eval` via a benign `Function("return this")` global-object probe.)
- CI: dev deploys now show the real build version instead of a placeholder.
- The Apple subscription icon was a solid black mark on a near-transparent chip, so it vanished in dark mode; it now sits on Apple's light chip and stays visible in both themes.
- Modals are now responsive on small and short screens: overlays scroll vertically and top-align tall dialogs (with a consistent 16px margin) so nothing is clipped off the top or bottom, and modal containers are capped at `calc(100vw - 2rem)` / `calc(100dvh - 2rem)` with `box-sizing: border-box` so they never force horizontal scrolling. Applied consistently across the feature-page modals (Add Transaction, Add Bill/Subscription, Accounts, Goals, Budgets, Portfolio, Housing, Loans, Retirement, Categories) and the shared modal components. Verified headlessly at 390×844 (phone) and 900×420 (landscape).

## [5.3.0] - 2026-07-13

### Changed

- The dashboard "Dashboard Views" button is now a compact "Views" button with a properly sized eye icon (the cog rendered oversized because the icon had no explicit dimensions) and a tooltip explaining it shows/hides widgets; dashboard widget cards (Budget Alerts, Savings Rate) now keep the same vertical spacing as the other cards instead of gluing to whatever follows.
- The dashboard header is now two rows: the title on the left with the view actions (Dashboard Views, Refresh) anchored right, and all period controls (month navigator + quick-select) together on their own row below — no more cramming everything onto one line.
- The dashboard period selector is now a compact segmented control (Today / Week / Month / Quarter / Year / 7D / 30D / 90D / All) that fits on one row — about half the header on desktop — and scrolls horizontally on phones instead of wrapping into multiple rows. Full period names show as tooltips.

### Fixed

- Budgets: changing an existing category allocation failed with a 400 ("Budget already exists"). Allocating is now an upsert — re-allocating a category for the same month updates the amount — and the per-category action stays available as a **Change** button (pre-filled with the current amount) once a budget is set, instead of disappearing.
- Budgets: the 6-month forecast under-projected any month that fell in the next year — the inflation adjustment was derived from the month-of-year alone, so a forecast crossing a year boundary (e.g. December → February) computed a negative month offset and applied no inflation. It now accounts for the year.
- Sign-in autofill: the login form inputs regained `name`/`id` attributes and use the `username`/`current-password` autocomplete tokens, so Android Chrome and password managers recognize and autofill saved credentials again (the redesign had dropped these; iOS still worked because it fills from `autocomplete` alone).
- The Auto-Categorize dialog now follows the app theme; it previously rendered with a hardcoded white background in dark mode (its dark styles were behind a class that was never applied).

### Added

- Preview the real notification emails on demand: Settings → Reminders now has "Preview spending report" and "Preview budget alert" buttons that immediately email you the actual report/alert built from your data (without touching the scheduled sends).
- The Bills calendar now shows small brand icons directly in the day cells for due subscriptions, so you can see what's due at a glance — especially on phones, where the hover tooltips never worked.
- Settings → About now shows which account (email) you are signed in with, or that you're in local mode.

### Fixed

- The Savings Goals doughnut no longer has its bottom edge shaved flat (the ring rendered at exactly the canvas boundary); it now keeps a small margin and is always a full circle.
- OneDrive gets its own cloud icon instead of the Microsoft four-squares, and five more common services resolve to proper brand icons: Twitch, Adobe (Creative Cloud/Photoshop/Lightroom), Notion, and ChatGPT/OpenAI.
- The Bills calendar tab failed with "not found" in local/demo mode — the calendar endpoint existed only on the cloud API and is now served locally too.
- Netflix, Amazon, and Disney+ subscription icons were malformed (Netflix literally rendered the letter "M"); replaced with proper simple marks and audited the whole icon set.
- The Savings Goals progress chart could grow past its card; it now stays contained.
- Mobile: transaction summary totals no longer overflow the screen (compact two-column layout), pagination wraps instead of clipping, and the sidebar toggle becomes a back-chevron at the sidebar's top-right when open instead of covering the logo.
- Storage-mode options renamed to fit the dropdown: "Server (Backend Database)" and "Local (Browser Storage)".

- Subscriptions: the "Monthly Total" now normalizes each plan to its monthly cost (a yearly plan counts as amount/12, weekly as x52/12) instead of summing raw amounts, and each card shows its real billing period ("/yr", "/wk") instead of always reading like a monthly price. The bill form also offers a Yearly frequency now.
- Adding a bill or subscription in the local/demo (serverless) mode failed with a validation error — the form sends the same field names as the cloud API (`dueDate`), which the local validator did not accept.

### Added

- Richer demo data: each example profile now carries a realistic set of subscriptions that scales with income (a lean pair on the low-income profile up to a dozen — streaming, cloud storage, gaming, developer tools — on the high-income one), all using real brand names so the Bills → Subscriptions view shows proper brand icons.

### Fixed

- Profile switching no longer makes a profile vanish from the selector. Switching the active profile could corrupt the in-memory profile list (the previously selected entry was overwritten with the new profile and then deduplicated away), a long-standing annoyance that hit on nearly every switch; the store now replaces instead of merging and never aliases list entries.
- Demo mode is now resilient to blocked browser storage (strict private browsing / "block all cookies"): the storage-mode setting falls back to an in-session value instead of silently flipping the deployed app into server mode, which made demo sessions fire unauthenticated API calls.

- Demo (no-account) mode on the hosted app now truly runs offline in the browser. Deployed builds address the API by absolute URL, and the serverless interceptor only recognized relative `/api/*` paths — so every call in demo mode bypassed the local IndexedDB, hit the real API without a session (constant 401s), and the local database never initialized. The interceptor now recognizes the deployed URL shape as well; after entering the demo, the app makes zero network calls to the API.

- Guided onboarding tours now navigate to each feature's page and reliably highlight it. They were rebuilt on stable `data-tour` anchors (instead of the fragile CSS/label selectors that often missed), steps that couldn't be shown without data or extra clicks were removed or re-pointed at always-visible elements, and the walkthrough overlay was hardened against page-navigation timing.
- Mobile: pages no longer render at desktop width and get clipped on phones — the app layout now genuinely shrinks to the viewport (the root container previously refused to shrink below its widest content, ~780px). The menu button no longer covers page titles; the Bills tabs, transaction date-range filters, portfolio holdings, and the Rent-vs-Buy form now fit or scroll properly on small screens.
- Mobile: opening a dropdown or focusing an input no longer makes iOS Safari zoom/jump the page (form controls now stay at the 16px size iOS requires), which read as the app "crashing" from the Settings chart-export dropdown.
- Debug logs are now readable on phones (entries stack as cards instead of a fixed five-column table wider than the screen), and "Copy" falls back to a legacy clipboard path or a file download when the clipboard is blocked (iOS).
- Demo mode: fresh demo data failed the app's own response validation on the accounts, transactions, and categories endpoints (stale `checking`/`investment`/`retirement` account types from before the v4 rename, and seeded rows missing now-required fields), flooding the console with errors and breaking parts of the UI. The seeder now writes schema-complete rows and the serverless read path normalizes legacy rows from existing installs.

### Changed

- Public-repo hygiene ahead of open-sourcing: removed operator-specific infrastructure and internal notes from the tree — the `apache/` vhost configs, the root `deploy.sh`, and internal planning/postmortem docs that referenced private hostnames, certificate paths, and server directories — and sanitized the remaining path references. Stopped tracking the generated PWA service-worker artifacts (`sw.js`/`sw.js.map`), which are rebuilt into `dist/` at build time. Aligned the root package version and the README badge to 5.2.0. Reverse-proxy and deployment guidance lives in `docs/self-hosting.md`.

## [5.2.0] — 2026-07-01

### Security

- Fixed an insecure direct object reference (IDOR) in custom reports. They were held in a shared in-memory map keyed by a guessable id with no ownership check, so one signed-in user could read, edit, or delete another user's report. Custom and saved reports are now persisted in D1 and scoped per user.
- Completed the SheetJS (`xlsx`) 0.20.3 security patch on the backend importer (the frontend and worker were patched in 5.1.2), closing the prototype-pollution and ReDoS advisories on server-side Excel parsing.
- CORS now fails closed when the allowed origin is unconfigured, instead of reflecting `*` with credentials.
- Google Sign-In now verifies the token issuer and expiry in addition to the audience.
- Dropped `script-src 'unsafe-inline'` from the served production Content-Security-Policy (it is kept only for local Vite HMR in development).

### Fixed

- Account balances are now updated atomically with the transaction that changes them, on both the self-host backend and the worker. A failure mid-update can no longer leave a transaction recorded with its balance change half-applied.
- Fixed a crash when more than one profile was selected for a transaction operation (a multi-profile query bound its parameters incorrectly).
- Bulk-deleting a transfer credited only to a destination account now reverses that credit (it was previously skipped, permanently inflating the account).
- Profile names are now unique per user rather than globally, so two users can each have a default "Personal Profile".
- The cross-origin session cookie could be dropped when an API caller passed its own `credentials` option; it is now always sent.
- Money now renders in the user's selected currency across the client PDF reports and dashboard cards (including zero-decimal currencies such as JPY), instead of a hardcoded symbol.
- Transactions page crash caused by a `createMemo` TDZ reference in SolidJS.
- Missing `swagger-ui-express` and `mime-types` backend dependencies.

### Performance

- Import duplicate detection is now O(N+M) instead of O(N·M), and import execution batches all inserts and account-balance updates into a single atomic transaction.
- Budget forecast/history and monthly statistics are computed in a single pass instead of rescanning the transaction list per row.
- The transactions list attaches tags with one batched query instead of one query per row.
- Added indexes on `transactions.account_id` and `transfer_account_id` for account-scoped queries.

### Changed

- Fixed the API worker deployment (the CI install used `--frozen-lockfile` against an intentionally unpinned worker), added a pre-migration D1 backup step, made the self-host Docker image buildable again, and added the OWASP baseline security headers to the Apache vhost.
- Relicensed the project from MIT to the GNU Affero General Public License v3.0 (AGPL-3.0).
- Vendored the SheetJS (`xlsx`) tarball into `vendor/` and reference it via a `file:` dependency, so installs no longer depend on the SheetJS CDN being reachable.
- The in-app changelog now renders the repository `CHANGELOG.md` directly (single source of truth) instead of a separate hardcoded copy.
- Improved public repo readiness: CODE_OF_CONDUCT, CONTRIBUTING, issue/PR templates
- Cleaned docs/ directory structure with organized specs, postmortems, and archive
- Replaced internal todo.md with public ROADMAP.md
- Added `.env.example` with documented environment variables

## [5.1.2] — 2026-06-30

### Security

- Updated SheetJS (`xlsx`) to the patched 0.20.3 build in both the worker and the frontend, fixing the known prototype-pollution and ReDoS advisories in spreadsheet (Excel) import.

### Changed

- Rewrote the README for the current Cloudflare Worker + D1/R2 architecture (local-first / self-host / managed-cloud), replacing the outdated Express/SQLite description.

## [5.1.1] — 2026-06-30

### Security

- Sign-up is now rate-limited per email address (not just per IP), curbing unsolicited account creation and email spam.

### Fixed

- A reminder email that fails to send is now retried on the next cron run instead of being skipped for that period (the dedup slot is rolled back on a failed send).

## [5.1.0] — 2026-06-27

### Added

- Account deletion: permanently delete your account and all of its data from Settings → Billing (confirm by typing your account email). Dev = hard delete; production soft-delete to follow; shown on the dev build only for now.
- Optional Cloudflare Turnstile bot protection on the register / login / forgot-password forms (enable by setting `VITE_TURNSTILE_SITE_KEY` and the worker secret `TURNSTILE_SECRET`).

### Security

- Per-account login throttle (on top of the per-IP limit) and constant-time password verification, so login no longer reveals whether an email is registered.
- Registration no longer reveals whether an email is already registered: it returns the same neutral response and emails either a welcome or an "account already exists" notice, with no session set (you sign in afterward).
- Profile-limit and rate-limit enforcement made atomic, so concurrent requests cannot slip past a limit.
- Stripe billing webhook hardened ahead of go-live (still inert until keys are set): idempotent + ordered event processing (a redelivered or stale event can't double-apply or resurrect a canceled plan), a dunning grace window for `past_due`, and line-item `current_period_end` handling.

### Fixed

- The periodic spending-report email could be sent multiple times per month (cron day-of-month/day-of-week OR semantics) — now sent once per period, with per-period idempotency.
- Re-running a failed or interrupted import no longer creates duplicate transactions (idempotent via a stable per-import id; migration `0008`).
- The billing page could label a paid plan as "Free"; it now shows your real tier and, when a plan is canceled, the date access ends.

## [5.0.0] — 2026-06-27

### Added

- Cloud sync via a Cloudflare Workers backend (D1 + R2) — sign in to sync across devices.
- Accounts: Google sign-in, email/password register + login, a no-account demo, and forgot-password reset by email.
- Pricing & plans (Free / Basic / Advanced / Ultimate) with a 4-tier comparison in Settings → Billing, plus Stripe billing (checkout, portal, status, webhook).
- Email reminders — budget alerts and a periodic spending report (Resend) — with per-profile toggles and one-click unsubscribe.
- Contact-support form (sign-in, reset, and Settings) with an auto-acknowledgement and a TC-XXXX reference id.
- Tabbed Settings: General / Exports / Billing.

### Changed

- Per-plan limits enforced (profiles, receipt storage, monthly reminder quota); advanced reports (tax & P&L) gated to Basic and up.
- Email now sends from a repliable address (hello@) instead of no-reply.

### Security

- Pre-merge review hardening: receipt-upload IDOR and cross-profile savings-goal recompute fixed; user-supplied IN-lists chunked to stay under D1's bound-variable limit; rate limiter made atomic; the support auto-acknowledgement no longer reflects arbitrary attacker-supplied content to unverified recipients.

### Fixed

- Profile creation failing with a response-validation error (missing `created_at`).
- "Access denied" for old/profile-less accounts (a default profile is now created automatically); password-reset no longer leaves a half-logged-in state.
- Large transaction pages timing out (N+1 tag query) and import of thousands of rows failing (D1 bound-variable limit); several invalid CSS transforms that silently dropped animations.

## [4.0.0] — 2026-05-11

### Added

- Portfolio tracker with real-time Yahoo Finance price lookup and allocation pie chart
- Counterparties page showing who-owes-who from beneficiary/payor transaction data
- Account balance auto-update when transactions are created/updated/deleted
- Starting balance and starting date fields for accounts with dynamic balance computation
- Transfer handling between accounts (FROM/TO with balance adjustments on both sides)
- Bulk action bar: Change Category and Change Type modals for multi-transaction editing
- Auto-categorization modal for bulk-mapping uncategorized transactions
- Nuke scripts: `nuke-demo.sh` (demo profiles only) and `nuke-all.sh` (all data)
- Google Sheets import improvements: auto-populated account inputs, cash account type

### Changed

- Account types aligned with backend: giro/savings/ib/cash (was checking/savings/credit/investment)
- Import now resolves account_id from Means of Payment (FROM) instead of Category (TO)
- Transaction FROM/TO column shows MoP → Category with transfer amounts without `-` prefix
- Analytics labels changed from "Monthly" to "Period" to reflect actual data range
- Navigation labels simplified: "Loan Calculator" → "Loans", "Housing Calc" → "Housing"
- Dropdown UX: category/tag dropdowns auto-close when clicking outside

### Fixed

- Critical import bug: account_id was resolved from Category (TO) instead of Means of Payment (FROM)
- Post-import balance recalculation handling all transfer directions (FROM only, TO only, both)
- Bulk DELETE sets account balance to starting_balance instead of 0
- Import: existing accounts now pre-populated in accountIdMap for MoP resolution
- Portfolio seed data: tier string passed directly instead of undefined config.tier property
- Yahoo Finance v3 ESM import: use `new YahooFinance()` pattern
- Mobile overflow on all pages: added overflow-x containment, responsive breakpoints for tables/charts
- SolidJS anti-patterns: replaced createEffect+isMounted with onMount, fixed ChartWrapper reactivity

## [3.0.0] — 2026-04-01

### Added

- Serverless mode with full IndexedDB storage adapter
- Multi-profile support with demo data (low/mid/high income) spanning 2000-2026
- Zero-based budgeting with allocation and rollover
- Daily heatmap visualization (D3.js) for spending patterns
- Sankey flow diagram for income/expense flow visualization
- PDF report generation: monthly spending, annual summary, P&L, tax summary
- Reconciliation workflow with bulk toggle and reconciliation summary
- Transaction tags with filtering and color coding
- Receipt upload and attachment to transactions
- Recurring transactions with auto-populate scheduling
- Quick Add modal (Ctrl+Shift+T) for rapid transaction entry
- Dark/light theme with CSS variables and persistence
- PWA support with service worker for offline access
- Chart export as images

### Changed

- Migrated from vanilla JS to SolidJS + TypeScript + Vite
- CSS Modules instead of global CSS
- Hash-based routing with query parameter support

## [2.0.0] — 2026-03-15

### Added

- Savings goals with progress tracking and contributions
- Loan calculator with amortization tables, prepayments, and variable rates
- Bills tracker with recurring payment scheduling
- Housing cost calculator
- Retirement calculator with projections
- Compound interest calculator
- Emergency fund calculator
- Rent vs Buy comparison calculator
- Budget rollover support
- Category auto-mapping from transaction descriptions
- Google Sheets CSV/XLSX import with column mapping and preview

## [1.0.0] — 2026-03-01

### Added

- Initial release: vanilla JS SPA with Express/SQLite backend
- Transaction management (CRUD, filtering, search, pagination)
- Category management with colors and icons
- Account tracking with balances
- Dashboard with income/expense charts and metrics
- Basic budgeting per category
- Analytics with category breakdowns
- User authentication (bcrypt + sessions)
- Settings management
- Data export/import (JSON)
