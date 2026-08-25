# Developer changelog (detailed)

Full technical detail of every change, for developers and self-hosters. The concise,
user-facing summary — and what the app shows in-product — lives in [CHANGELOG.md](CHANGELOG.md).

All notable changes to Token Circles are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Worker dependencies bumped to their current releases**, and Dependabot taught not to hand
  us the same broken PRs again. `hono` 4.6.0 -> 4.13.4, `postal-mime` 2.7.5 -> 3.0.0,
  `@cloudflare/workers-types` 4 -> 5, `@cloudflare/vitest-pool-workers` 0.17.0 -> 0.22.0,
  `vitest` 4.1.9 -> 4.1.11. `wrangler` deliberately stays at 4.126.0.
  - Landed as one commit rather than the five PRs Dependabot opened (#467, #468, #470, #471),
    because every one of them failed CI the same way: Dependabot rewrote `worker/package.json`
    and left `worker/pnpm-lock.yaml` untouched, so `pnpm install --frozen-lockfile
    --ignore-workspace` refused each with `ERR_PNPM_OUTDATED_LOCKFILE`. Not a stale snapshot —
    an explicit `@dependabot recreate` produced the same manifest-only diff. `worker/` is not
    listed in `pnpm-workspace.yaml`, so its standalone lockfile is not one Dependabot's pnpm
    updater manages. `.github/dependabot.yml` now documents the drill and groups all worker
    updates into a single PR, since each one costs that manual lockfile step.
  - `postal-mime` 3 is a major on a path with **no test coverage**: the suite covers
    `parseAttachment` but never `PostalMime.parse`, so 488 green tests proved nothing about it.
    Checked by hand instead — `email.attachments` is still `Attachment[]`, and the three fields
    `import-email.ts` reads (`filename`, `mimeType`, `content`) are unchanged. v3 types `content`
    as `ArrayBuffer | Uint8Array | string`; `toBytes` already handles all three arms explicitly.
  - `@cloudflare/workers-types` 4 -> 5 is clean under `tsc --noEmit`.
- **GitHub Actions bumped past several majors** (#462-#466): `actions/checkout`,
  `actions/setup-node`, `actions/upload-artifact` 4 -> 7, `actions/github-script` 7 -> 9,
  `cloudflare/wrangler-action` 3 -> 4. The artifact/checkout/setup-node majors are Node-runtime
  bumps with no behavioural change, which matters because `upload-artifact` carries the
  pre-migration D1 backup and `deploy-worker.yml` never runs on a PR — green PR CI does not
  cover it. `github-script` v9 breaks `require('@actions/github')`; we use the injected globals
  and Node builtins only. `wrangler-action` v4's one breaking change is defaulting to wrangler
  v4, which our explicit `wranglerVersion` overrides.
- **TypeScript 7 held back** (#469, #474 closed). `typescript-eslint` 8.x crashes on it
  (`Cannot read properties of undefined (reading 'FunctionType')`) and `tsc` rejects our own
  config: `baseUrl` is removed in 7 and every `paths` entry is non-relative. That is a
  migration, not a bump. Pinned via `ignore` in `dependabot.yml` with the reason recorded.

## [5.11.0] — 2026-08-25

### Added

- **Update notices carry an action; the toast stack moved top-right** (`frontend/src/core/toastStore.ts`, `frontend/src/components/ToastContainer.tsx`, `Toast.module.css`, `frontend/src/core/appVersion.ts`, `frontend/src/core/api.ts`). `ToastItem` gains `title`, `action` and `channel`; `ToastOptions` gains `durationMs`, with per-type defaults (info/success 5s, warning 8s, error 10s) and a non-finite value falling back to the default rather than scheduling `setTimeout(NaN)`. `MAX_TOASTS = 4` drops the oldest. Stored items pick their fields explicitly instead of spreading options, so `durationMs` does not leak onto the item. New `removeToast`, `removeToastsByChannel` and `hasToastOnChannel` share a timer map, so evicting a toast cancels its pending dismissal instead of leaving a timer to fire against an id that is gone. `ToastContainer` renders a per-type icon, `role="alert"` for errors and `role="status"` otherwise, the title as a coloured inline prefix, and the action button. `appVersion.ts` adds `announceUpdate()` — channel `app-update`, 60s, Reload wired to `reloadToLatest` — which re-announces on a later poll only once the previous notice has expired, and clears the channel on rollback.
- **`userIsMidEntry(doc)` gates the hashchange auto-reload** (`frontend/src/core/appVersion.ts`). The safe-moment reload now waits out a focused text control and any _open_ dialog. "Open" is decided by computed `pointer-events !== 'none'`, because `CommandBar` and `GuidedOrbit` keep `role="dialog"` nodes mounted permanently — a naive presence check was true on every page and disabled auto-reload outright. `NON_ENTRY_INPUT_TYPES` excludes checkboxes, radios and the rest, whose focus is a resting state rather than mid-entry.
- **Android install hint** (`packages/pwa-kit/src/install.ts`, `frontend/src/components/InstallAppButton.tsx`). `needsAndroidInstallHint()` plus a shared `hintEligible()` gate and a `promptSeen` signal that outlives the event's consumption, so the hint stays suppressed on any session where `beforeinstallprompt` fired. Android WebViews (`; wv)` in the UA) are excluded — they cannot install. `InstallAppButton` flattens the nested `Show` fallbacks into one `<Switch>` with prompt → iOS hint → Android hint priority.

### Fixed

- **Every tier switch created a second subscription** (`worker/src/routes/billing.ts`, `worker/migrations/0026_stripe_subscription_id.sql`, `frontend/src/features/Settings.tsx`, `frontend/src/components/BillingPlans.tsx`). `POST /api/billing/checkout` built a Checkout Session on every click, and `mode: subscription` creates a new subscription each time — Stripe permits one customer to hold several, so nothing ever refused. Basic → Advanced → Basic on dev left **three live subscriptions on one customer**, all billing the same card, while `users` showed whichever webhook landed last. Worse, `customer.subscription.deleted` matched on `stripe_customer_id` alone and dropped the account to `free` unconditionally, so cancelling any one of several meant losing access while the others kept charging. Checkout now asks Stripe what the customer holds (`liveSubscriptions`, `status=all` filtered through `ENTITLED_STATUSES`, so `trialing` and `past_due` count); if something entitles them the request is a change — `POST subscriptions/{id}` replacing the existing item's price via `items[0][id]`, not appending a second item, with `proration_behavior=create_prorations` so the difference lands on the next invoice rather than raising one that could demand SCA with nowhere to send anyone. It answers `{ url: null, changed: true }` and the page never leaves. It asks Stripe rather than our own column because the accounts most likely to carry strays are the ones predating the column, and a failed lookup fails the request: not knowing what exists is never a reason to create another one. Migration 0026 adds nullable `users.stripe_subscription_id`; entitlement-removing events are ignored when they concern a subscription the row is not tracking, and when they concern the tracked one the handler moves the account onto a surviving live subscription rather than to Free. `NULL` tracks nothing and behaves exactly as before, so rows predating the migration keep working and fill the column in on their next event. The metadata is rewritten alongside the price — `customer.subscription.updated` reads the tier back off it, and a stale value would re-apply the tier just left. Covered by `worker/test/billing-single-subscription.test.ts` and `worker/test/billing-webhook-strays.test.ts`.
  - Does **not** clean up duplicates already out there — that is a refund decision belonging in the Stripe dashboard, where the invoices are visible. Affected customers keep paying twice until someone acts.
- **Choosing a plan after cancelling kept the cancellation** (`worker/src/routes/billing.ts`, `frontend/src/features/Settings.tsx`). Cancel, think better of it, pick a different tier, and the subscription carried `cancel_at_period_end` through the price change: charged for one more period on the tier just chosen, then dropped to Free, with "Your Advanced plan is canceled" sitting under the upgrade the person had just made. Choosing a paid plan is asking to be billed for it, so the switch now sends `cancel_at_period_end=false` alongside the new price — and only when there is a cancellation to lift, so an ordinary change makes no write nobody asked for. Stripe's own portal keeps the cancellation through a price change too, but it has a Renew button to undo it and this grid does not, so a cancelled subscriber had no way back except through Stripe. The same-tier case stops answering "you already have that plan": asking for the plan that is about to end is asking to keep it. The response carries `resumed` so Settings can say so rather than leaving somebody to reload and check.
- **The plan grid froze at first paint** (`frontend/src/components/BillingPlans.tsx`). `const mine = isCurrent(p.id)` inside `<For>` — the callback runs once per item, so the const froze at whatever the plan was on first render, which before `/api/billing/status` answers is `free`. Hence the "YOUR PLAN" border staying on Free, an Upgrade button on the tier already being paid for, and the status line one paragraph above correctly saying otherwise. Switching settings tabs "fixed" it by remounting. Now an accessor, like `price` and `per` beside it already were. Covered by `frontend/src/components/__tests__/BillingPlans.reactivity.test.tsx`.
- **The new plan needed a manual reload to appear** (`frontend/src/core/billingActivation.ts`, `frontend/src/features/Settings.tsx`, `worker/src/routes/billing.ts`). Stripe redirects to `/?billing=success` the instant payment succeeds, but the plan is written by `checkout.session.completed`, which arrives out of band — measured at ~3s on dev. Settings read `/api/billing/status` once in `onMount` and so raced that webhook and normally lost, leaving the billing card on Free; the same branch toasted "Subscription activated." before reading anything back. `success_url` now carries the tier and the page re-reads on a backoff (600ms..6s, ~17s total) until that tier reaches an entitled status — `active`, `trialing` or `past_due`, matching `isEntitled` in the worker, since `past_due` is a dunning grace window and the page must not show Free to someone who still has access. The tier travels in the URL rather than being inferred from a baseline because a checkout return is a fresh page load: comparing against the first value read is wrong exactly where it matters, since Advanced → Ultimate reads `advanced` on the first poll, which is the tier being left. A timeout says payment was received and the plan will appear shortly — Stripe took the money either way, so it is "not seen yet", never "failed". Generalised by the tier-switch work above, which waits on our own webhook instead of Stripe and wants different wording.
- **Checkout 400'd for every account with a Stripe customer** (`worker/src/routes/billing.ts`). The Session already set `automatic_tax` and `tax_id_collection`; Stripe refuses a Session combining those two with an _attached existing customer_ unless it also sends `customer_update[name]=auto` and `customer_update[address]=auto`. Only accounts with a `stripe_customer_id` take the `params.customer` branch, so first-time checkout — which takes the `customer_email` branch — was unaffected and the failure was invisible in testing. Both params are now set on the `customer` branch. Covered by `worker/test/billing-checkout-params.test.ts`.
- **Stripe error text no longer reaches the client verbatim** (`worker/src/routes/billing.ts`). `stripePost`'s handler logs a structured line (`type`, `code`, `param`, `message`, Stripe's `request-id`) and returns Stripe's own wording only for `card_error` as a 402. Anything else is a 502 whose text depends on the upstream status: a Stripe 4xx is permanent and says it has been logged our side, a 5xx keeps "try again shortly".
- **Subscription interval is recorded** (`worker/migrations/0025_subscription_interval.sql`, `worker/src/routes/billing.ts`). Nullable `users.subscription_interval`. Checkout stamps `metadata[interval]` and `subscription_data[metadata][interval]`; `intervalForPrice()` resolves monthly-vs-annual from the Price id as a webhook fallback, so subscriptions predating this backfill on their next `customer.subscription.*` event. `checkout.session.completed` COALESCEs the column (null = unknown, keep what is there) while `applySubscription` writes through (null = clear it); cancellation clears it alongside the plan. Covered by `worker/test/billing-webhook-interval.test.ts`.
- **A comped plan offered billing controls that could not work** (`frontend/src/features/Settings.tsx`, `frontend/src/components/BillingPlans.tsx`). The portal route 400s when there is no Stripe customer to manage. Settings adds a `status === 'comped'` billing-summary branch and passes a `comped` prop that swaps Manage-billing for a "Granted — nothing to manage" label. Covered by `frontend/src/components/__tests__/BillingPlans.gate.test.tsx`.
- **The delete confirm dialog closed before the delete landed** (`frontend/src/core/confirmStore.ts`, `frontend/src/components/ConfirmDialog.tsx`, `frontend/src/features/Transactions.tsx`, `frontend/src/core/storage/handlers/transactions.ts`). `ConfirmRequest` gains `busy`, `stalled`, `progress` and `error`, and an optional `onConfirm: ConfirmWork` — a `(report) => Promise<void>`. `acceptConfirm()` runs the work, patches progress as it reports, resolves on success, and holds the dialog with an error banner on rejection. `finish()` is split out from the guarded `resolveConfirm` precisely because it must bypass the busy guard, which otherwise refuses to close the dialog it is meant to close. `STALL_GRACE_MS = 10_000` flips `stalled` so Cancel becomes Close: review found the first version guarded _every_ exit at once — both buttons disabled, overlay guarded, no Escape handler, and no timeout or `AbortController` anywhere in the request path — so a never-settling socket or a blocked IndexedDB open left an undismissable `z-index: 5000` overlay with page reload as the only recovery. An empty `Error.message` falls back to a generic sentence. `ConfirmDialog` renders `<Index>` rather than `<For>`, since a progress patch replaces the request object and `<For>` (keyed by reference) would rebuild the whole dialog on every tick; it drops its own label because `OrbitSpinner` already renders `label` visibly.
- **Deleting refetched the entire profile** (`frontend/src/features/Transactions.tsx`). `refreshTransactions()` calls `api.getTransactions()` with no arguments and the worker appends no `LIMIT`, so every delete refetched every transaction plus a tags join and a `COUNT(*)` — which is why it was fast for small datasets and slow for the customer who reported it. Both handlers now drop rows from local state with `setTransactions(prev => prev.filter(...))`; the refetch is kept on the error path only, where the local state is no longer trustworthy. Single delete treats a 404 as success, otherwise "Try again" is unwinnable after a lost response.
- **The bulk selection kept ids for rows that no longer existed** (`frontend/src/features/Transactions.tsx`). `handleDeleteTransaction` dropped the row from `transactions()` but never from `selectedTransactions()`, so ticking a row and deleting it with its own row-level button left the bar reading "1 selected" over a table that no longer held it, and the next bulk action posted an id the server had already deleted — the worker skips it and the serverless path fails its ownership check, so nothing corrupts, but the action silently under-applies. Pre-existing, not from #449: the `refreshTransactions()` that replaced did not clear the selection either. Fixed with one `createEffect` intersecting the selection against the ids present in `transactions()`, rather than a line at the delete call site, because the refetch paths cannot unselect anything themselves — `refetchOnActive('transactions', …, refreshTransactions)` swaps the whole list on a profile switch while the keep-alive host leaves the page mounted, so selecting rows and switching profile left ids from the previous profile in the bar. Deliberately intersected against `transactions()` and **not** `filteredTransactions()`: filtering here is a derived memo, so a row hidden by a filter or sitting on another page stays selected, which is what makes selecting across pages and acting on the lot work. The functional setter form does not track `selectedTransactions`, and returning `prev` unchanged keeps the array reference, so there is no feedback loop and no notify in the common case. Covered by `frontend/src/features/__tests__/transactionsSelection.test.tsx`.
- **Serverless bulk delete opened one IndexedDB transaction per row** (`frontend/src/core/storage/handlers/transactions.ts`). Now deduplicates ids and calls the adapter's `bulkDeleteTransactions` once. The old per-id loop skipped repeats while the up-front ownership check counted them, so `deleted` could exceed what was removed.
- **The import preview rejected every transfer into an account it was about to create** (`worker/src/routes/imports.ts`, `frontend/src/core/storage/handlers/importFlow.ts`). Accounts are inserted only when the run is not a dry run, and `accountIdMap` learns new ids only from the `loadAccounts()` that follows that insert — so during a preview the map held existing accounts only, and every transfer naming a pending account produced `no account named "X" (Means of Payment, the source)`. Reported from production as 300+ rejected rows on a 5183-row first import. Both paths now seed the to-be-created accounts into `accountIdMap` when `dryRun` is set, with placeholder ids counting down from `Number.MAX_SAFE_INTEGER`: distinct, so the "both sides resolve to the same account" check still fires, and positive, because the shared invariant rejects non-positive account ids. A dry run inserts nothing, so no placeholder is ever persisted. A preview with nothing approved still rejects, and still names the side and the value. Covered by `worker/test/import-transfer-accounts.test.ts`.
- **The crash modal reloaded straight back into the dead build** (`frontend/src/components/ErrorBoundary.tsx`, `frontend/src/core/bootRecovery.ts`). `window.location.reload()` is re-served the crashed build from the service worker's precache; it is now `reloadToLatest()`. `bootRecovery` adds a `recoveryInFlight` signal with a 10s deadline (`isChunkRecoveryInFlight()`), and both global handlers route through a shared `escalate()` that suppresses chunk errors while recovery is in flight, with the render fallback wrapped in `<Show when={!isChunkRecoveryInFlight()}>` — so the modal stops flashing over a page that is already quietly recovering. `vite:preloadError` is `preventDefault`ed only when a reload will actually follow: a prevented event makes Vite resolve the import as `undefined`, which surfaces later as an unclassifiable TypeError.

- **The spotlight tour claimed ArrowRight/ArrowLeft/Enter unconditionally** (`frontend/src/core/spotlightStore.ts`, `frontend/src/components/Spotlight.tsx`, `frontend/src/App.tsx`). The overlay is `pointer-events: none`, so the page underneath stays fully live while a tour runs, but the window `keydown` handler had no focus check, no modifier check and no `preventDefault`. Three consequences, all reachable during any tour: ← pressed to fix a typo in a focused field moved the caret _and_ stepped the tour back; Enter on the tour's own Next button activated the button _and_ advanced, so one press skipped two steps; and every ArrowRight also reached `App`'s period stepper, which had no `spotlightActive()` guard, so the focus period drifted a month per step and the user left the tour on a different period than they entered it. The decision now lives in `tourKeyAction`, pure and unit-tested, and the component asks `isEditableTarget` from `core/domFocus` — the predicate extracted just above, whose module header already claimed every global key handler needed it; this was the one still carrying no check at all. `includeResting`, because ←/→ are exactly the keys a range input and a radio group drive themselves. Escape stays exempt deliberately: someone who wants out of a tour has to be able to leave from wherever they are, including mid-typing.
  - The guard then took Enter away from every _other_ button, since `isEditableTarget` answers false for a `<button>`: tab to "End Tour", press Enter, and the tour stepped forward instead of closing — as did "Back". Both worked before the guard, because nothing was prevented and the button's own activation still ran. `isActivatableTarget` (`core/domFocus.ts`) now covers what activates itself on Enter — `button`, `a[href]`, `[role=button|link]`; `input[type=button|submit|reset]` is already covered by `includeResting`, the only mode a caller guarding Enter would use. Arrows stay the tour's, since a button does not use them. Caught reviewing the release range, not from a report — Space still activates the buttons, which is likely why it went unnoticed.

### Changed

- **The worker's toolchain is pinned and reproducible** (`worker/package.json`, `worker/pnpm-lock.yaml`, `worker/.gitignore`, `.github/workflows/e2e.yml`, `.github/workflows/deploy-worker.yml`, `.github/dependabot.yml`). `worker/` is not a workspace member, and its lockfile was gitignored from the scaffold days ("deps installed fresh"), with `wrangler` at `^4.0.0`. So both CI jobs installed `--no-frozen-lockfile` and resolved the toolchain afresh every run: CI never ran the wrangler anyone had tested locally, a `wrangler dev` crash could not be told from a code change because the version moved underneath the suite, and — the part that matters most — **every prod deploy bundled whatever npm served that morning**, which is neither reproducible nor rollback-able. Note where that bites: the deploy CLI itself was never the exposure, because `wrangler-action@v3` pins `wranglerVersion: '4.106.0'` on the backup, migrate and deploy steps. What floated into production was the `pnpm install` that `wrangler deploy` bundles FROM — `hono` (43 imports; the entire HTTP and auth layer), `zod`, `pdf-lib`, `postal-mime` and `xlsx`. Those are not dev tooling. They run on every request and handle user data, and they were resolved unreviewed and integrity-unchecked on each deploy. The lockfile is now committed (209 resolutions, integrity-hashed, so a republished or tampered tarball is refused rather than installed), `wrangler` is pinned exactly at 4.126.0 to match `vitest` and `@cloudflare/vitest-pool-workers` which were already exact, and both workflows use `--frozen-lockfile`. `deploy-worker.yml`'s header comment had claimed it installed "against worker/pnpm-lock.yaml" all along; it is true now.
  - The counter-argument was security — leave it floating so an urgent fix arrives on its own. It does not survive contact: floating IS the supply-chain exposure (unreviewed, integrity-unchecked downloads straight into a deploy pipeline is the path a hijacked or republished package takes), and nothing was watching for advisories in the first place — there was no `dependabot.yml` in the repo at all, so new versions arrived silently and untested. The dev-tool-versus-runtime split matters here: a CVE in wrangler threatens CI runners rather than user data, but `hono` and friends are not wrangler. `.github/dependabot.yml` closes the gap for the workspace root, `worker/`, and the GitHub Actions themselves (a compromised action runs with the workflow's token). **Security updates are raised as soon as an advisory lands regardless of the weekly cadence**, so pinning surfaces fixes faster and more visibly than floating did, because a human is actually told.
  - Left alone deliberately: `wrangler-action`'s `wranglerVersion: '4.106.0'` now differs from the 4.126.0 in `package.json`, so the CLI that applies migrations to prod is not the one the tests ran against. Aligning them changes the production deploy path and cannot be rehearsed without deploying, which is not a thing to do in the same patch as a lockfile — worth its own PR against a quiet main.
  - `wrangler` minors and majors are on the ignore list: it ships a new minor most weeks, each carrying a different miniflare, and an unattended bump is exactly how a dev server that crashes mid-run reaches main. Patches and advisories still come through.
  - This does **not** fix the intermittent `wrangler dev` crash on the E2E job (`Error inside ProxyWorker` → `cause: Network connection lost.`, from miniflare's loopback fetch service, killing the server mid-run). That crash was observed on 4.125.0 at 17:44 and on 4.126.0 — which was published at 19:13 the same day — so it spans versions and is not a regression in either. Pinning makes it _diagnosable_: the toolchain is finally a fixed variable, so the next occurrence can be bisected instead of guessed at. Every recent wrangler 4.x depends on a `-alpha` miniflare; that is Cloudflare's normal channel for the miniflare 5 line, not a prerelease pulled in by accident.

- **One shared focus predicate behind the global key guards** (`frontend/src/core/domFocus.ts`, `frontend/src/App.tsx`, `frontend/src/components/GuidedOrbit.tsx`, `frontend/src/core/appVersion.ts`). New `isEditableTarget` consolidates four drifted copies of the "is focus in an editable control" check. `GuidedOrbit`'s copy had omitted `SELECT`; only `appVersion`'s knew that a checkbox keeps focus long after the click. `userIsMidEntry` keeps its own open-dialog scan, which is specific to the deploy watcher. The period stepper passes `includeResting` because ←/→ are owned by a focused `RangeField` slider (`RetirementPlanner`), where the narrower mid-entry semantics would let one keypress both drag the slider and step the period. Extraction surfaced a bug it also introduced: `isContentEditable` is typed `boolean` but reads back `undefined` in jsdom, so the function returned `undefined` despite its `: boolean` signature. The attribute fallback is gated on `typeof el.isContentEditable === 'boolean'`, since in a real browser it was overriding an authoritative `false`, and it matches lowercased keywords — `contenteditable` is a case-insensitive enumerated attribute whose invalid values mean NOT editable, so a focused `<div contenteditable="FALSE">` read as editable and would veto both shortcuts and the auto-reload while it held focus. `frontend/src/core/__tests__/domFocus.test.ts` asserts through `document.activeElement` rather than held element references, which is what let the original suite pass vacuously.
- **Removed the dead `SettingsDialog` and `Modal` components** (`frontend/src/components/SettingsDialog.tsx`, `SettingsDialog.module.css`, `Modal.tsx`, `Modal.module.css`; 826 lines). `SettingsDialog` had no importers anywhere in `frontend/src`, and the generic `Modal`'s only importer was that dead `SettingsDialog`; both were flagged by the 2026-07-23 code-and-data-integrity audit. `Modal` was unsafe to adopt as it stood — `if (!props.isOpen) return null` sat in the component body, so Solid read the prop non-reactively and evaluated `isOpen` exactly once at mount — and was deleted rather than repaired with a `<Show>`. `ConfirmButton`, `SettingsDialog`'s other local import, stays: fifteen other importers. Also drops a stale comment in `worker/src/routes/settings.ts` naming `SettingsDialog` as a caller of the storage-mode endpoints.
- **The worker suite got a timeout that fits what it does** (`worker/vitest.config.ts`). `session-lockout > lets the real owner back in once they get it right` hit vitest's 5s default on main, on a commit whose two earlier runs of the same job passed. That default assumes a pure unit test; nothing in `worker/test` is one — every file boots its own workerd and applies the migrations, and the auth tests run PBKDF2 at 100,000 iterations per login (`worker/src/auth.ts`), twenty of them in that test. It takes ~274ms locally, so an 18x stall is contention rather than a slow runner: the failing run reported 112s of setup against 90s of wall clock, and locally the same suite reports 739s against 45s — 16x oversubscribed — so files boot workerd in parallel and a CPU-bound test scheduled into a burst of those startups is starved of the runner's 4 shared vCPUs. `testTimeout: 20_000` is ~70x the slowest test's real cost, so a genuine hang still fails, on being hung rather than on being unlucky.

## [5.10.1] — 2026-08-25

### Fixed

- **A first import rejected every transfer row** (`worker/src/routes/imports.ts`, `frontend/src/core/storage/handlers/importFlow.ts`, `frontend/src/features/import/importFlow.ts`). A transfer's `account_id` resolves from the Means-of-Payment column and its `transfer_account_id` from Category — but account creation was driven entirely by `categoryTypes`, a map built from the CATEGORY column's distinct values, and the preview's `new_accounts` scan read only that column too. Means-of-Payment values were enumerated nowhere, classified nowhere, offered nowhere. On a profile with no accounts yet — which is what onboarding is — every transfer row failed the shared invariant and was rejected; the reported sheet had 341 of them.
  - Both `new_accounts` scans (worker and serverless) now read both columns. A Means-of-Payment value qualifies unconditionally: it is the account the money moved from, by definition of the column. A Category value qualifies when marked 'account' as before, or when the row's own `type` says `transfer` — there is no reading of "transfer to Groceries" that makes Groceries a category, and a first-time import has no way to have marked anything yet.
  - The mapping step (`detectAccountValues`) enumerates the same set and seeds `categoryTypes` with them as 'account', after the keyword classifier so they win over any guess; an explicit user choice still wins over both (`?? 'account'` fills gaps only). `applySavedMapping` gets the same treatment on BOTH branches — a mapping saved before this fix has no entry for any Means-of-Payment value, and restoring it verbatim would keep every transfer unresolvable for exactly the people who had already set the source up.
  - The mapping table renders `mappingValues()` — the category values plus the account-by-construction ones — rather than `detectCategories()` alone. Without the union the Means-of-Payment accounts were created invisibly: real accounts, never listed in the table, so no starting balance, no date, and no way to opt out. Categories keep their order; the extras append after.
  - The rejection now names the side and quotes the value: `no account named "Erste Current" (Means of Payment, the source); no account named "Revolut" (Category, the destination)`. The invariant lives in `shared/` and only sees ids, so the naming happens where the names are, in both import paths, self-transfer case included.
  - Tests: 3 worker (`worker/test/import-transfer-accounts.test.ts`) + 3 serverless (`importFlow.transferResolution.test.ts`), the same three scenarios each — the preview offers both sides, the rejection names the failing value, and the row imports once both are approved, with both legs linked and distinct. Confirmed red against the pre-fix code: the preview offered `[]`, then `['erste current']` without the transfer-destination rule.

### Changed

- **Rules-editor confirmation moved beside its button; success banners auto-dismiss and clear on navigation** (`frontend/src/features/import/BankRulesEditor.tsx`, `importFlow.ts`, `Import.module.css`). `saveBankRules`/`resetBankRules` set the global `resultMessage`, which renders at the top of the page/panel — the editor sits far down a scrolling step, so on a phone the confirmation appeared a full screen above the click and was never seen. The editor now owns an inline confirmation (`role="status"`, check icon, 4s, timer cleaned up on unmount) rendered in the same flex row as the buttons, and the flow no longer routes those two actions to the banner at all.
  - The banner itself never cleared: "Preview recalculated from your rules." was still sitting there on the NEXT step, which reads as a stuck page, not a confirmation. Success messages now go through `announceResult` (6s auto-dismiss) and `goToMapping`/`goToPreview` clear any banner on entry. Errors are untouched — they stay until acted on.
  - Tests: 3 in `BankRulesEditor.confirmation.test.tsx` — beside-the-button placement, self-dismissal under fake timers, and a save-after-reset keeping the newer message on the newer clock.
- **The "Expected columns" table matched neither the importer nor itself** (`frontend/src/features/import/ImportDataEntry.tsx`). It listed Date and Description as required. Neither is: only Amount hard-fails a row (`checkImportRowNumbers`), a missing date imports as today and is flagged (`MISSING_DATE_WARNING`), and a blank description imports outright — a contract the worker pins in `import-blank-description.test.ts` because a stricter local rule once silently dropped 291 rows. The header is now "Sample (default when missing)" and every optional column with non-obvious absence behaviour says it in parentheses: Currency → base currency from Settings, Type → from the amount's sign, Amount Local → same as Amount, Category → uncategorized / a transfer's destination account, Means of Payment → the account the money left.
  - Tests: 3 in `expectedColumnsTable.test.ts` — only Amount may claim Required, the table's column set equals the downloadable template's `TEMPLATE_HEADER`, and the columns with defaults must state them.
- **Auto Categorize rebuilt around the rows that actually reach it** (`frontend/src/components/AutoCategorizeModal.tsx`, `features/Transactions.tsx`). Every uncategorized row comes from an import — the app will not create one — so the person looking at the list did not type these rows in, and a bare description was unidentifiable. The reported experience: "bunch of transactions I don't know what they are (no amount, date metadata etc, from/to accounts)".
  - The modal's transaction type carried only `{ id, description }` even though the host was already passing full `Transaction` objects; the row now renders date, signed amount (`−` for expense, coloured both ways, `tabular-nums`) and the account line, `Erste Current → Revolut` for a transfer, via a host-supplied `accountName` resolver.
  - A row with no mapping match gets a category `<select>` (filtered to the row's own type where known — an expense is not offered Salary), so "no suggestion" is no longer a dead end. `Select all matches` stages every suggested row at once.
  - Staging and applying were entangled: the row's `+` called `onApply` immediately AND `applyAll` called it again for every staged row — a double write per row, and a footer label ("Apply N") that described neither. Staging is now local state; `Apply N` is the only writer, sequential on purpose, with a new `onApplied` fired once so the host refetches once instead of after every row (the old handler reloaded the entire transaction list per application — "Apply 50" was 50 full refetches).
  - `uncategorizedTransactions` in `Transactions.tsx` now excludes transfers: a transfer has no category by design, so they filled the modal with rows that could not and should not be categorized.
  - Tests: 5 in `components/__tests__/AutoCategorizeModal.test.tsx` — the metadata line, the manual pick (and its type filter), a manual pick counting toward Apply, stage-then-apply writing each row once with one `onApplied`, and select-all-matches.
- **Onboarding: the footer button carries its own progress, and the panel scrolls to the work** (`frontend/src/components/onboarding/OnboardingWizard.tsx`, `Onboarding.module.css`). The processing spinner and the import summary render at the top of the wizard body; with a 5000-row preview the user is a whole table below, so "Import selected" looked like it did nothing. `FooterAction` gained `busy` — the primary button disables, shows an inline spinner and switches label ("Importing…", "Building the preview…", "Processing…", "Adding…") — and every long-running footer action first scrolls the body back to the top (`showTheWork`). Spinner respects `prefers-reduced-motion`.
- **Onboarding: one primary action on the subscriptions step** (`frontend/src/components/SubscriptionScan.tsx`, `OnboardingWizard.tsx`). The scan panel's own "Add N" sat mid-panel while the footer's "Continue" silently did not add. `SubscriptionScanPanel` gained `expose` (hands the host `chosenCount` / `submitting` / `addSelected`, which now resolves with how many were created) and `hideAddButton`; the wizard folds both into the footer: "Add 2 subscriptions & continue" when something is selected, "Continue" otherwise. The standalone Bills modal keeps its own button — `hideAddButton` is opt-in.
  - `tests/onboarding.spec.ts` asserts the in-panel button is GONE in the wizard and the unified label adds and advances in one click.

### Tooling

- **The tour walk fails fast when the page never renders.** `walk-tours.mjs` polled the sidebar button with an unbounded `boundingBox()` — on a page that never mounted (an intermittent dev-stack flake), each poll waited the 30s default and a bounded-looking retry loop became twenty minutes of silent hang until `timeout` killed it, reporting "browser has been closed" from the kill rather than anything about the page. The poll is bounded at 1s now, and the drawer failure names the URL, whether the button was attached at all, and saves a screenshot.

## [5.10.0] — 2026-08-24

### Added

- **A sticky period bar, and the `overflow-x` that had been quietly disabling `position: sticky` app-wide** (`frontend/src/core/uiPrefs.ts`, `components/PeriodBar.tsx`, `PeriodBar.module.css`, `components/Layout.module.css`). The month control is how you change period, and on a long page — Budgets above all — it scrolls away exactly when the numbers being read make you want to change month. Settings > Appearance > "Keep the period bar in view" pins it to the top. **Off by default**: it changes how every page with a period bar behaves and costs a line of screen on each, which is not a change to make on someone's behalf.
  - **`Layout.module.css` set `overflow-x: hidden` on `html, body`, which makes the body a scroll container and stops `position: sticky` working anywhere in the app.** Nothing sticky had ever pinned; the first attempt here measured the bar at `y = -792` after a scroll, with `position: sticky; top: 8px` correctly computed on it. Changed to `overflow-x: clip` in three places — `html, body`, and `.main` inside both the 768px and 480px media queries, which were overriding it back to `hidden` on mobile. `clip` still prevents sideways scrolling but does not create a scroll container. The sidebar's own `overflow-x: hidden` is left as it is: that one is a real scroll container and is meant to be.
  - `PeriodBar` gained a host wrapper so the sticky positioning, the pinned styling and the tour/test anchors live in the one component the pages already share, rather than in a per-page wrapper div repeated four times. Budgets, Dashboard and Transactions pass `tourAnchor` / `hostTestId` and drop their wrappers; page CSS keeps only the spacing that is genuinely per-page.
  - The "stuck" look (a shadow and a solid background, so content passing underneath does not show through) needs to apply only once the bar is actually pinned, and CSS has no selector for that. An `IntersectionObserver` with `threshold: [1]` and `rootMargin: '-<top+1>px 0 0 0'` fires the moment the element stops being fully visible against its own offset, which is the same instant it pins — no sentinel element, no scroll listener. The offset is read from the element's own computed `top`, so the media queries stay the single source of truth for it.
  - `top` is `8px` on desktop and, on mobile, clears the fixed menu button rather than sliding under it. `data-sticky` and `data-stuck` are exposed for the e2e suite.
  - **The bar is two rows on a phone rather than three.** Six pills at `flex: 1 1 auto` wrapped to two lines and stranded the sixth alone, where `justify-content: space-between` stretched it across the full width — a whole row spent on "All". `PERIOD_PILLS` is now rendered as two groups (`ROW_PILLS` and `TRAILING_PILL`, both derived from the one list so they cannot disagree), which lets the mobile rules `order` the trailing pill up onto the stepper row, where there was already spare width. The five below divide one row at `flex: 1 1 0`. On a desktop the groups sit adjacent and `.bar`'s column gap was set to match the gap inside `.pills`, so the split is invisible. This applies whether or not the bar is pinned — and it is why a pinned bar on a phone is a control rather than an obstruction.
  - `readBool` accepts only the two strings this module writes; anything else falls back to the default rather than being read as a deliberate choice.
  - `uiPrefs.ts` keeps the preference in `localStorage`, not on the account: it describes how this screen should behave, and a phone wanting the bar pinned says nothing about a desktop. Every read and write is in a `try`/`catch` — a private window or a browser set to block site data _throws_ on the accessor rather than returning null, and a display preference must never be the thing that stops the app rendering.
  - Tests: 7 unit (`core/__tests__/uiPrefs.test.ts` — default off, both directions remembered, a value it did not write, and both throwing-storage paths) plus 12 e2e (`tests/sticky-period-bar.spec.ts`). The e2e ones scroll a real page and read where the bar ended up, on all three pages, at desktop and at 390px, including that the month steppers still work while pinned, that the app as it ships lets the bar scroll away, and that turning the switch on in Settings pins it. Two more measure the mobile layout: every control in the bar resolves to exactly two distinct row centres, "All" shares the steppers' centre and sits to their right, and no pill runs past the bar. They are scoped to the page container: pages are kept alive, so several `PeriodBar`s are mounted at once and a bare locator matches all of them.
  - `spotlightStore.test.ts` now recognises `tourAnchor="key"` as well as a literal `data-tour="key"`. The anchors moved from per-page wrapper divs into the shared component's prop; both declare the key at the call site, which is what that test is checking for.
- **A category icon gallery** (`frontend/src/components/IconPicker.tsx`, `IconPicker.module.css`). The icon field resolves a typed keyword through `iconFromUserValue` / `findIcon`, which is a good input and a terrible discovery mechanism: the only way to learn that `shield-check` or `more-horizontal` exist was to type them. A button beside the field opens a scrollable grid of every icon, with a filter for when 62 becomes more than that. Picking writes the key into the same text field rather than into parallel state, so the field stays the single source of truth and a chosen icon can still be edited or cleared by hand. One modal serves both create and edit on the Categories page, so this lands in both.
  - `PICKABLE_ICON_NAMES` is derived from `iconNameMap` rather than written out beside it — a second hand-maintained list goes stale the first time someone adds an icon. It excludes `tag` and `folder`: both are real glyphs, but both are also in `defaultIconValues`, so `getCategorySvg` reads them as "nobody chose an icon" and pattern-matches the category name instead. Offering them would have offered a choice the renderer silently ignores. A test asserts the property directly rather than the exclusion — for every key on offer, storing it must change what is drawn.
  - `iconSvgByKey()` draws one icon by exact key. The gallery cannot use `getCategorySvg`, which is built to _resolve_ a value and would happily show a glyph for a key other than the one being offered.
  - Escape is handled on the capture phase with `stopPropagation`, so dismissing the gallery does not also close the category modal and discard a half-filled form. The filter input is deliberately uncontrolled — binding `value` back to the signal is the write-to-a-focused-field bug the `solid-forms` skill exists to prevent.
  - Tests: 12 unit (`IconPicker.test.tsx`) plus 6 e2e (`tests/category-icon-picker.spec.ts`). The e2e ones cover the wiring the unit tests cannot: that the button is reachable from inside the modal, that the panel lands above it (a click that Playwright refuses is the stacking assertion), and that a pick reaches the field the form submits.
- **A maskable icon and manifest screenshots** (`frontend/src/pwaManifest.ts`, `frontend/public/icon-maskable-512.svg`, `frontend/public/screenshots/`, `docs/pwa-install-assets.md`). The manifest declared four `any` icons and no `screenshots` at all, so Chrome's install dialog fell back to name-icon-URL, and Android — given nothing maskable — did not mask ours: it shrank the whole square into a white circle, which is the small dark tile in a white ring on the home screen.
  - `icon-maskable-512.svg` is the same artwork with two required differences: a full-bleed background (no `rx` — the platform supplies the shape, and our own corners would be masked a second time into a rounded square inside a circle), and `scale(0.8)` on the artwork so all of it sits inside the safe circle. It is not decorative: the unscaled artwork reaches 207px from the centre of a 512 canvas, past the 204.8px safe radius, so a circular mask clipped the orange marker.
  - Six screenshots — dashboard, transactions, analytics, each `wide` (1280x720) and `narrow` (720x1280). Chrome shows the rich dialog only with a `wide` entry and falls back to the plain one on phones without a `narrow` entry.
  - **`icon-192.svg` was declared `192x192` and is a byte-identical copy of `icon-512.svg`, which draws a 512 canvas.** Collapsed to one entry at `sizes: 'any'`, the spec's value for a scalable icon. The test found this, not a reading of the file.
  - `purpose` is now explicit on every entry. Left implicit on some and explicit on others is how a maskable icon ends up serving both roles.
  - The manifest moved out of `vite.config.ts` into `src/pwaManifest.ts` so it can be tested. Everything in it fails silently in a browser — an unresolvable `src` is a swallowed 404, a wrong `sizes` is a screenshot dropped without a word — and none of it reaches a build log.
  - Screenshots are deliberately **not** precached: `injectManifest.globPatterns` is an explicit allowlist, and they are read by the install UI, never by the page.
- **`npm run pwa:shots`** (`frontend/playwright.shots.config.ts`, `frontend/tests-shots/pwa-shots.spec.ts`) — re-shoots the six screenshots against the same two servers the e2e suite uses (wrangler on a local D1, vite proxying `/api` at it) and the same setup project, so the stills and the suite cannot disagree about what the data looks like. A second config rather than a spec in the main suite: these write into `public/` and are not assertions.
  - The theme is pinned to dark through `finance-theme` — the key `public/theme-init.js` actually reads. With nothing pinned the app follows `prefers-color-scheme` and headless Chromium reports light, so an unpinned run returns a whole light set to sit beside a `#0a0e1c` splash. (The e2e fixture state's `darkMode` key is dead; nothing has read it since the theme moved to `core/theme.ts`.)
  - Animation and scrollbar suppression is an init script, not `addStyleTag`: a style tag belongs to the document that was live when it ran, so it evaporates on the first navigation and only the first shot comes out clean.
- **`npm run pwa:icons`** (`frontend/scripts/gen-pwa-icons.mjs`) — rasterizes every manifest PNG from its SVG master with `rsvg-convert`. Not run in CI: the PNGs are committed, because a build that rasterizes its own icons fails on any machine without librsvg.
- Tests: `src/__tests__/pwaManifest.test.ts` (24) reads the PNG IHDR chunks back off disk and compares them to the declared `sizes`, plus the maskable pair, explicit `purpose`, both form factors, one aspect ratio per form factor, Chrome's 320-3840 and 2.3:1 bounds, a label on every screenshot, and the `scale()` and absent `rx` in the maskable master. `tests-shots/tsconfig.json` puts the new directory under `npm run typecheck`.
- **Per-session revocation: `auth_sessions` + `sid` in the JWT** (`worker/migrations/0024_sessions.sql`, `worker/src/auth.ts`, `worker/src/routes/auth.ts`, `frontend/src/components/SignedInDevices.tsx`). Sessions were purely stateless — a JWT plus a single `users.token_version` counter — so the only revocation primitive the system had was "invalidate every token this account has ever been issued". `POST /api/auth/logout` used it, which is why signing out on one device signed out all of them.
  - `issueSessionCookie` now inserts a row (`crypto.randomUUID()`, user agent, IP, provider) and embeds its id in the JWT as `sid`. `authenticateRequest` looks the row up and fails with `session_ended` when it is gone; `last_seen_at` is touched at most once per `SESSION_TOUCH_SECONDS` (300) and fire-and-forget, so a read path stays a read path.
  - Named `auth_sessions`, not `sessions`: `0001_init.sql` already creates a `sessions(sid, sess, expire)` table for the retired Express server's session store. `CREATE TABLE IF NOT EXISTS sessions` against it is a silent no-op, and the next `CREATE INDEX ... (user_id)` fails with `no such column`.
  - Routes: `POST /api/auth/logout` deletes one row; `GET /api/auth/sessions` lists them with a server-derived device label; `DELETE /api/auth/sessions/:id` is scoped `AND user_id = ?` (an id alone is not authority — 404 otherwise) and clears the cookie when you end your own; `POST /api/auth/logout-all` batches the row delete with the `token_version` bump, which stays the only handle on a token issued before this table existed.
  - `deviceLabel(ua)` (`worker/src/deviceLabel.ts`) derives "Chrome on Linux" at render time rather than at write time, so improving the parser never needs a backfill. Order matters: Edge/Opera/Samsung are matched before Chrome, CriOS/FxiOS before Safari.
  - `frontend/src/components/SignedInDevices.tsx` renders the list. `parseServerTime` normalises D1's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, UTC, no zone marker) to a real instant — `new Date()` reads that string as local time, which puts "last active" hours off for anyone not on UTC.
- **Server-side auth audit trail** (`worker/migrations/0023_auth_logs.sql`, `worker/src/authlog.ts`). Every login, logout and denied request is logged to the console; `auth_logs` persists the ones worth keeping — all login/logout outcomes, plus session denials that arrived _with_ a cookie (a denial with no cookie at all is just an unauthenticated request and would bury the signal). Records event, outcome, reason, user, email, IP, user agent, request id and how many session cookies the request carried.
- **The Express/SQLite backend is gone** (`backend/`, `Dockerfile`, `docker-compose.yml`, `db/`, `test/backend/`, `test/e2e/backend-api/`, `test/benchmark/`). It had not shipped for some time — `ci.yml` stopped testing it, nothing deploys it, browser-only mode is IndexedDB and cloud mode is the Worker — but it was a complete server with routes, models, repositories and its own test suite, and it kept attracting fixes. 144 files.
  - Policy, now written down in the repo docs rather than implied by what happened to be in the tree: self-hosting means running your own copy of the **Worker** on Cloudflare's free tier. That had been true for a while; the tree said otherwise.
  - An existing Docker image keeps working — nothing is revoked — but it receives no further fixes.
  - The one thing still holding it in the tree was `e2e.yml`: 35 Playwright specs drive the real built frontend, and something had to answer `/api`. That is now `wrangler dev` against a local D1 — the runtime that actually serves the app.
  - `frontend/playwright.config.ts` starts both servers (`wrangler dev` on :8787 after `d1:migrate:local`, then vite on :3800 with `API_PROXY_TARGET` pinned at it) and runs a `setup` project before the suite.
  - `frontend/tests/global.setup.ts` registers the fixture account through `/api/auth/register`, marks it verified and puts it on `ultimate` (Free caps profiles at 2, and specs that need isolation create their own — a plan error surfacing inside a subscription-scan spec is a true fact about the Free tier and a useless place to learn it), creates the fixture profile, seeds it, signs in once and saves the `storageState` every spec starts from. It also clears `rate_limits` first: the local database survives between runs and so did the login counters, so the seventh run of an afternoon failed at sign-in with a 429.
  - Signing in once rather than per browser context also fixes a real limit: `workers: os.cpus().length` meant a context per CPU, each spending the per-IP login budget.
  - `frontend/tests/e2e-seed.ts` is the dataset — two accounts, four months of transactions, six categories, a paid and an unpaid bill. It replaces `reseed-demo` on the Express server, so what a spec asserting on "recent activity" is looking at is now readable in the repo. A new profile gets no categories from any code path, which is why they are seeded explicitly: a categories page with none renders its empty state, not its grid.
  - `test-helpers.login()` no longer makes a request; `firstProfileId()` replaces the hardcoded `X-Profile-Id: '1'`, which only ever held because the Express seed always produced it.
  - Root scripts `start`, `lint:backend`, `test:backend` are gone; `test:worker` and `test:e2e` added. `better-sqlite3`, `bcrypt` and `sqlite3` leave `onlyBuiltDependencies` with the server that needed them.
- **`BillingPlans` marks the current plan.** `mine` now outranks `RECOMMENDED` for both the border and the badge. Before, the two competed and `RECOMMENDED` always won: a subscriber on `advanced` (which _is_ `RECOMMENDED`) saw a card highlighted as a recommendation, never as theirs, and a subscriber on any other plan saw the highlight on somebody else's card. The only signal that a card was yours was the CTA text, which reads as one more button in a row of Upgrade buttons.
  - Current card: 2px `var(--success)` border (padding drops to 15px so its contents do not shift a pixel against its neighbours) plus a "Your plan" badge in the slot "Recommended" used to occupy. Free gets it too — a Free row has no price and no Manage button to infer it from.
  - `data-testid="plan-card-current"`, so the marking is assertable rather than eyeballed.
- **"Manage billing" → "Manage subscription"**, with "Change plan, update your card, or cancel" under it. The Stripe portal is where cancelling lives and nothing said so.
- **A `Manage or cancel your subscription` link under the billing status line** (`Settings.tsx`, shown only on a paid plan, `data-testid="billing-manage-link"`). Someone looking for how to cancel reads the status line first; making the only route to the portal a button inside the grid put it where it competes with the Upgrade buttons beside it.
- Tests: `BillingPlans.gate` grows to 11 — which card is marked, the badge taken back from Recommended when they are the same card, the legacy `premium` status mapping onto the `advanced` tier, and the border itself (asserted on the inline style, because a badge alone is not what makes a card read as selected). Three mutations run — badge text, badge condition, border condition — each killed.
- **The service worker is now `injectManifest` over a hand-written `frontend/src/sw.ts`, on top of `@komediruzecki/pwa-kit`'s `sw-runtime`** — ported from mercurypitch, not invented. Closes the second half of #417.
  - **Model: a precached shell, one build at a time.** `install()` fetches the shell and refuses it unless every `<script src>` it names is in this build's manifest, then stores it with its first-paint assets; navigations answer from that shell; assets answer cache-first and only for URLs this build shipped; `activate()` drops the other builds' caches. The previous build's cache is copied forward first, so an unchanged chunk costs no request.
  - **`skipWaiting` and `clientsClaim` are gone.** A worker that took over mid-session paired its own chunk map with the page's already-loaded HTML, which is what the multi-reload deploy loop was made of. The waiting worker is adopted only when the page decides to move.
  - **`generateSW` + `runtimeCaching` is gone with them**, along with the network-first navigation rule (`SW_CLEANUP_EPOCH = 'nav-network-first-1'`). That rule was the right fix for the failure it was written for and could never be tested; this replaces it with rules that can.
  - **The three update signals converge.** `version.json` polling (`core/appVersion.ts`) still detects a deploy, and so now do a waiting worker and the worker's own stale-build broadcast — all three set the same pending state and wait for the same safe moment (the next hashchange), under the same rolling reload cap.
  - **Every reload goes through `reloadToLatest()`, never `location.reload()`.** With a precached shell the controlling worker answers a plain reload from its own cache, so a page whose chunks are gone re-serves the same dead shell forever. The ladder is: adopt the waiting worker → else unregister and reload → else (offline) reload plainly. `bootRecovery.activateUpdatedServiceWorker` is deleted; its premise — that skipWaiting makes the new worker claim the page on its own — no longer holds.
  - **`SW_CLEANUP_EPOCH = 'precache-shell-1'`**, and the inline reset script now deletes the old caches as well as unregistering (the new worker only ever deletes its own `tokencircles-assets-` prefix, so `finance-manager-*` and `workbox-precache-*` would have sat in the quota forever). It publishes `window.__SW_CLEANUP__` and registration awaits it — an unregister resolving _after_ a register would silently remove the worker it had just installed, a race the previous version of that script contained.
  - **The worker ships with every build, not only production** (`command === 'build'`, exposed as `__SW_ENABLED__`). Chrome does not fire `beforeinstallprompt` without a fetch-handling worker, so gating on production meant `dev.tokencircles.com/sw.js` was a 404 and the install button added in #420 could never appear there. `vite dev` still ships none and still removes a stale one.
  - **`theme-init.js` is in the precache list and has to be**: index.html loads it with a `<script src>`, and the shell check refuses any document naming a script this build did not ship. Leaving it out would have failed every install.
  - **HTML references are resolved, not matched on a leading slash.** This repo builds with `base: './'`, so index.html says `./assets/index-*.js` and `./theme-init.js`; mercurypitch's `/assets/` pattern would have matched nothing, precached nothing and validated nothing — silently. Verified against a real `vite build --mode dev`: 115 precache entries, both shell scripts present.
  - Tests: 93 new in `packages/pwa-kit` (58 caching rules against a fake CacheStorage, 35 registration/update against a fake `ServiceWorkerContainer`), 104 in the kit overall. `bootRecovery.test.ts` loses the `activateUpdatedServiceWorker` cases with the function.
- **Dunning mail on the Stripe webhook.** The handler covered `checkout.session.completed` and the three `customer.subscription.*` events and no `invoice.*` event at all, so a decline produced no outbound mail anywhere in the system. It now handles `invoice.payment_failed` and `invoice.payment_action_required`, and mails on `customer.subscription.deleted`.
  - `worker/src/billingMail.ts` — `mailForBillingEvent(type, obj, account, appUrl)`, pure. The interesting part of this feature is not the sending but the decisions, several of which are "send nothing"; kept out of the route they can be asserted directly. (`fetchMock` is not exported by `cloudflare:test` in `@cloudflare/vitest-pool-workers@0.17.0`, so the alternative was no unit coverage of the wording at all.)
  - `invoice.payment_failed` with `billing_reason: 'subscription_create'` sends nothing. That is the first invoice of a checkout, and the user is looking at Stripe's own error on screen; the mail would arrive after they had already tried again.
  - `payment_action_required` is deliberately not the decline mail. Nothing has failed, and the only thing that resolves it is the user opening a page — which a "your payment failed" subject makes them less likely to do.
  - `subscription.deleted` reads the account **before** `applySubscription`, because afterwards the plan is `free` and the mail would say "your Free plan has ended"; and it only sends when `applied.meta.changes` is set, so an event that lost to the ordering guard cannot announce a cancellation that did not happen.
  - Amounts arrive from Stripe in minor units and are divided before rendering; `next_payment_attempt`, `amount_due`, `currency` and `hosted_invoice_url` are all treated as optional, with the app's own billing screen as the fallback link.
  - Sending is best-effort inside a `try`/`catch`: an unacked webhook is retried, and the `stripe_events` insert makes the handler idempotent, so a mail that could not be sent must not cost us the ack and earn a second delivery.
  - `renderPaymentFailed`, `renderPaymentActionRequired`, `renderSubscriptionEnded` in `worker/src/emailTemplates.ts`.
  - Tests: `worker/test/billing-dunning.test.ts` (20) — the decision table, plus end-to-end assertions on the outbound Resend call for the two guards that are invisible from either side alone (the plan column cannot show a mail, and the pure function cannot see a stale event). Four mutations run: dropping the first-invoice guard, the no-address guard, the ordering guard on the mail, and reading the account after the plan drops — each killed.
- **`POST /api/billing/checkout` refuses an unconfirmed password account** (403, "Confirm your email address before subscribing"). The check is a fact about the account, so it runs before the Stripe config and price lookups — and in the route rather than only the UI, since the route is reachable with a session and a fetch whatever the page drew. `GET /api/billing/status` reports `email_verification_required` so the panel never offers a button that would be refused.
  - `POST /api/billing/portal` is deliberately NOT gated. Someone already paying has to be able to reach the portal and cancel whatever else is blocked; a gate that strands a subscriber away from the cancel button is worse than no gate.
  - Google accounts are never gated. `auth_provider = 'google'` with `email_verified = 0` is a real state — Google reports an unverified address by leaving it off the account — and there is no password to reset, so gating on the flag alone would lock those users out of paying with no way to fix it.
  - `mustVerifyEmail()` is shared by the two routes so the policy cannot drift between what the UI is told and what the server enforces.
- **`<ResendVerification/>`** — the resend control extracted from the banner, now that the same ask appears in the billing panel: one request at a time, a terminal "sent", and a failure that returns to idle instead of stranding the user on a disabled button. `inline` and `button` variants.
- `BillingPlans` gains `upgradeBlockedReason` — separate from `configured`, which is about the server; this is about the account.
- Tests: `worker/test/billing-verified-gate.test.ts` (7) plus `BillingPlans.gate` and `ResendVerification` on the front end (8).
- **`packages/pwa-kit` — the install half of the PWA, ported from mercurypitch.** A workspace package with no imports from the app that uses it, so extracting it to its own repository later is a `git filter-repo` and a publish rather than a rewrite. `solid-js` is a peer dependency. Consumed through a `@pwa-kit` alias in `vite.config.ts`, `vitest.config.ts` and `tsconfig.json`; its tests run under the frontend's vitest so CI covers them with no extra job.
  - `installPwaInstallListeners()` runs in `index.tsx` **before render**: Chrome fires `beforeinstallprompt` once, early, never replays it, and that event is the only handle on the native install sheet. Cancelling it also suppresses Chrome's own mini-infobar and is what keeps the event usable later.
  - `canInstall()` / `needsIosInstallHint()` / `isStandalone()` are the three questions worth asking, and `<InstallAppButton/>` renders nothing when all three say no. A dead Install button would appear on every desktop Firefox and inside every already-installed window.
  - iPadOS 13+ reports itself as a Mac, so the iOS check falls back to touch points; Chrome/Firefox/Edge on iOS are excluded because they are WebKit underneath but cannot add to the home screen at all, and a hint there points at a menu item that does not exist.
- Manifest: `id` (without it the identity is derived from `start_url`, so changing that later reads as a different app and offers a second install beside the first), plus explicit `scope`, `launch_handler: navigate-existing`, `orientation` and `categories`. Dropped `version: Date.now()` — not a manifest member, and it churned the file on every build.
- Tests: 11 for the kit, 6 for the button.

### Fixed

- **The month pills overflowed their own buttons on a phone** (`frontend/src/utils/period.ts`, `components/PeriodBar.tsx`, `PeriodOrbit.tsx`, `PeriodBar.module.css`). `PERIOD_PILLS` gave the first two pills the short forms "This mo." and "Last mo.", which at `flex: 1 1 0` on a 320-390px viewport were wider than the pill they sat in — and with only `white-space: nowrap` and no `overflow`, the glyphs ran straight out through the border.
  - `PERIOD_PILLS` is replaced by `periodPills(now = new Date())`, which names the first two for the months they actually select: `label` "August"/"July", `short` "Aug"/"Jul". A function and not a constant, because a constant captures the month at import and a tab left open across midnight on the 1st would keep naming the month it was opened in.
  - A new `title` field carries the wording the label gave up ("This month (August)"), so the tooltip still explains a pill whose label is only a month. `PeriodOrbit` gained the same tooltip; it previously had none.
  - `.pill` gets `overflow: hidden; text-overflow: ellipsis`. The labels are short now, but a pill that cannot contain its own text is a bug waiting for the next longer word. Mobile padding drops 10px → 8px, which buys the text a few pixels before the ellipsis does.
  - Tests: 6 unit in `utils/__tests__/period.test.ts` (both months, the January→December year boundary, the titles, that the ids are untouched, that every short form is ≤ 4 characters and no longer than its label, and that the result is computed per call) plus 3 e2e at a 320px viewport.
  - **The e2e test that already covered this passed the whole time.** It compared each pill's bounding box against the bar's, and the box was inside it — only the glyphs were not. The new one reads `scrollWidth - clientWidth` on the pill and on its visible label, which is the difference between "the button fits" and "the text fits". Against the old labels it fails with `"This mo." overflows its pill`.
  - The label assertion reads the visible `<span>`, not the button: both the full and the short label are in the DOM at all times with CSS choosing between them, so `toHaveText` on the button returns them concatenated ("AugustAug").
- **The onboarding import step's footer promoted the wrong action** (`frontend/src/components/onboarding/OnboardingWizard.tsx`). The wizard already moved the import flow's forward action into the footer for the `mapping` and `preview` sub-steps; the `upload` sub-step was left out, so with a statement staged the primary button still read "Continue without importing". `ImportDataEntry` renders its own forward button — `bank-process-btn`, `import-continue-mapping` — inside the step body, below that tab's inputs, which on a phone put it under the account pickers and off-screen. The action that abandons the step was the one under the thumb.
  - `readyEntryAction()` returns the active tab's forward action once that tab has something to act on, and null before then: with no file chosen there is nothing to promote and the footer should still offer to move past the step. Bank imports promote `processBankFiles()`; Google Sheets and the two CSV tabs promote `goToMapping()` once `sheetResult()` / `uploadResult()` is set.
  - Skipping is demoted to the existing `secondary` ghost slot — the same shape `mapping` and `preview` already use — so it stays one tap away.
  - The import PAGE is untouched. It renders the same `ImportDataEntry` without this footer, and its inline buttons stay exactly where they are.
  - `.footer` / `.footerRight` wrap under 620px. The step can carry four buttons (Back, Skip setup, Don't import, primary), which does not fit a 360px phone on one line; wrapping keeps the primary at full width instead of squashing all four until none reads as the main one.
  - Tests: 1 e2e in `tests/onboarding.spec.ts` — asserts the primary is the skip before a file lands, becomes "Process & continue" after, that "Don't import" is still reachable beside it, and that the footer button does what the inline one does.
- **Every paid plan card said "Upgrade"** (`frontend/src/components/BillingPlans.tsx`). From Advanced, the Basic card said Upgrade — the opposite of what clicking it does — and the grid gave a subscriber nothing to tell which tiers were above them and which below. The CTA now reads the plan's position in the catalogue and says `Downgrade` or `Upgrade` accordingly.
  - Direction comes from the catalogue's own order, not a second list in the component. `GET /api/plans` returns `Object.values(PLANS)`, which preserves plans.ts's declaration order (free, basic, advanced, ultimate) and is the order the grid already renders in — so a tier slotted into plans.ts later is labelled correctly with no change to the frontend.
  - A current plan that is not in the catalogue falls back to `Upgrade`. A legacy value, or one granted out of band, says nothing about direction, and guessing `Downgrade` from an unknown starting point would be worse than the old honest default. `premium` still maps to `advanced` through `currentId()` first.
  - Free is untouched: it has no CTA in either direction. Ending a subscription belongs in the portal, and a `Downgrade` button opening a Stripe checkout for a 0 EUR plan would be a trap.
  - Tests: 8 in `BillingPlans.direction.test.tsx`, against a four-tier catalogue — the interesting cases only exist when something sits both above and below you.
- **Picking a colour saved the category and closed the form** (`frontend/src/features/Categories.tsx`, `Budgets.tsx`). The colour swatches are `<button>`s inside the category `<form>` and carried no `type`, so they took the HTML default — `type="submit"`. Clicking one submitted the form: the category was written and the modal closed, mid-edit, before the name or the icon had been touched. It read as the modal auto-closing rather than as a swatch that was quietly the Save button.
  - Both instances fixed with `type="button"`: the Categories page's category form, and the category form on the Budgets page, which is a second copy of the same picker.
  - Nothing catches this on its own. The diff looks right — the handler does the one thing it should, and nothing anywhere says "and also submit". Solid does not warn, TypeScript cannot see a missing attribute, and eslint's JSX rules do not cover it. `frontend/src/__tests__/formButtonType.test.ts` scans every `.tsx` for a `<button>` opened inside a `<form>` whose attributes omit `type`, and fails on any. It matches `<button` with a negative lookahead rather than requiring a following space or `>`, because attributes usually start on the next line and `<button` alone is the shape the bug actually ships in — the first draft required the space and found nothing.
  - Tests: 4 unit (including a fixture of the bug as it shipped, so the scanner cannot silently stop working) plus 4 e2e in `frontend/tests/category-color-swatch.spec.ts`, covering both forms. Verified against the pre-fix source: the scanner flags exactly `Categories.tsx:543` and `Budgets.tsx:1385`, and 2 of the 3 Categories e2e tests fail without the fix.
  - The e2e test for the add form watches for the `POST /api/categories` request rather than the modal. Submitting closes the modal only once the POST returns, so an immediate `toBeVisible()` passes in the gap — the first version of that test did exactly that against the buggy build and would have shipped saying nothing.
- **A category card with a budget drew its divider twice, and cost three extra rows** (`frontend/src/features/Categories.tsx`, `CategoriesPage.module.css`). The budget block was four stacked rows — "Spent / amount", a 6px `.progress-bar`, then `.spending-footer` carrying "X limit" and "Y remaining". `.spending-footer` set its own `border-top: 1px solid var(--border)` directly beneath that track, and at 6px against 1px the two read as one horizontal rule painted twice. `.spending-footer` was also the only one of the card's label/value rows without `display: flex`, so its two spans stacked left-aligned instead of sitting at either end of one line — which is where the third row came from.
  - Rebuilt as two rows. The limit rides with the amount it bounds ("EUR 254.70 of EUR 220.00", `.spending-of`), and what is left rides beside the bar that shows it (`.meter-row`: a 10px capsule `.meter` plus a `.meter-note` reading "EUR 34.70 left" or "EUR 34.70 over"). No second border anywhere in the block; the card's one divider stays on `.category-spending`.
  - The note sits **beside** the bar, not inside it. Inside is tighter until the fill reaches it, at which point the text is on the fill in one theme and on the track in the other, with no single colour that reads well against both.
  - `.meter` carries `role="img"` and an `aria-label` naming both numbers — a bar whose meaning is carried entirely by a width is nothing to a screen reader. `.meter-note` uses `font-variant-numeric: tabular-nums` so figures line up across a grid of cards. The `width` transition is behind `prefers-reduced-motion: no-preference`.
  - Under 380px `.meter-row` wraps and the bar takes the full width, rather than squeezing to nothing to keep the number on the same line.
  - **Removed a dead twin of this whole design**: `.categories-page .budget-limits` / `.budget-limit{,-label,-amount}` / `.remaining-{amount,label,amount-value}` / `.budget-progress{,-bar}` and its four state variants, plus `.remaining-amount` and the `.progress-fill` warning/danger/success/normal set. None had been referenced from any component — `.budget-limits` carried the same `border-top` as the footer that caused the report, and `.budget-progress` was a second copy of the same 6px bar.
  - Tests: 5 in `frontend/tests/category-card-budget.spec.ts`. They measure boxes rather than read text, because both defects are layout facts a text assertion cannot see: exactly one drawn `border-top` in the card's whole subtree; the bar and the note sharing a vertical centre with the note to the right of the bar; the block no taller than header + meter + 40px; the fill between 0 and 1 of the track and the track no more than 14px tall; and no sideways overflow at 360px.
- **`styles.formInput` on the Budgets page resolved to a rule that matched nothing** (`frontend/src/features/BudgetsPage.module.css`). `vite.config.ts` sets `css.modules.localsConvention: 'camelCase'`, which exports a camelCase alias for every original class name — so `.form-input` (line 168) and a later `.iconField .formInput` block both arrived in the JS as `styles.formInput`, and the later one won. All six form controls in `Budgets.tsx` therefore rendered with **no background, no border and no padding**, because the only rule they could match was scoped under `.icon-field`.
  - Visible as the reported bug in the Allocate Budget modal: a transparent `<select>` is what Chrome paints its option list white behind, while the page's light `--text` still cascades in — white on white. The amount input looked unstyled for the same reason. Confirmed by reading computed styles off the running app: `background: rgba(0,0,0,0)`, `border-top-width: 0px`, `padding: 0px`. After the fix: `rgb(10,14,28)`, `1px`, `10px 14px`.
  - Fixed by writing that block in kebab-case like the rest of the file, which removes the duplicate local name entirely. No rule changed; one simply stopped being shadowed.
  - **Seven more collisions of the same shape exist** and are listed in the new test rather than fixed here — each one has a dead rule set, and merging them changes how a page renders, which wants looking at rather than doing blind: `Layout.module.css` (`sidebarNav`), `BillsPage` (`billsSection`), `BudgetsPage` (`categoriesSection`, `categoryChartSection`), `LoansPage` (`loansPage`), `TransactionsPage` (`modalFooter`, `modalTitle`).
  - Tests: 4 in `frontend/src/__tests__/cssModuleNaming.test.ts`. It reads every `*.module.css` off disk and fails on any NEW collision; a fourth test fails if an entry on the known list is fixed but left there, so the allowlist cannot rot into decoration. Nothing about this class of bug fails a build, a type check or a lint — this test is the only thing that catches it.
- **Signed-in devices listed sessions that had expired weeks ago.** A session token is good for seven days and is never refreshed — `issueSessionCookie` is only ever called at sign-in — but nothing deleted the `auth_sessions` row when the token died. `GET /api/auth/sessions` selected the table unfiltered, so the list grew by an entry per sign-in forever: a browser signed into once a month showed up a dozen times, every entry looking exactly as live as the real one, and "sign out this device" on any of them revoked nothing because there was nothing left to revoke.
  - The list is now bounded by the token lifetime (`created_at > datetime('now', '-7 days')`). `last_seen_at` cannot answer this — it says when a session was last used, not when it expires, and a token issued seven days ago and used a minute ago is dead either way.
  - `sweepExpiredSessions()` joins the existing cron alongside `sweepRateLimits`, so the table stops growing rather than merely being filtered on read. It leaves a day of slack past the TTL: being swept early would end a session a moment before its token was due to expire, for no reason beyond two clocks disagreeing.
  - Tests: 4 in `worker/test/session-lockout.test.ts`.
- **The E2E job on `main` was killed by its own timeout, and reported it as `cancelled`.** `.github/workflows/e2e.yml` runs the 44-test smoke subset on a pull request but all 515 tests on a push to `main`. The 30-minute bound added alongside `workers: 1` was sized against the smoke run: the last green full run already spent 22m25s of it, and the next push went over and was killed. GitHub reports a `timeout-minutes` kill as _cancelled_, not _failed_, so `main` showed a non-green E2E while CI and both deploys were green and no test had actually broken.
  - Fixed by sharding the push path across four jobs (`--shard=i/4`), not by raising the bound. `workers: 1` stays — four headless Chromiums against one wrangler got workerd killed twenty seconds in, after which every remaining spec failed on a 502 from the vite proxy. Four _jobs_ buys the wall-clock back without putting a second browser on any one workerd: each shard is its own runner with its own wrangler and its own local D1. Playwright splits it 130/130/129/129 and runs the setup project in every shard; a shard is 5.0m of tests locally at `workers: 1`. The bound is now 25 minutes per shard, a hang detector rather than a budget.
  - `fail-fast: false`, so one bad shard shows the other three instead of cancelling them.
- **Failure traces from E2E were never actually uploaded.** Both artifact steps pointed at `playwright-report/` and `test-results/` in the repo root; Playwright writes them next to its config, under `frontend/`. Every run since produced zero artifacts. Now one step uploads `frontend/test-results/` on failure, named per shard — `upload-artifact@v4` rejects a second upload under a name another job has claimed.
- **The captcha had exactly one visible state for two very different failures** (`frontend/src/components/Turnstile.tsx`, `LoginScreen.tsx`, `LoginModal.tsx`). `<Turnstile/>` reported a token or an empty string and nothing else, so "the challenge has not been solved yet" and "the widget script never arrived" were indistinguishable to the form. The blocked case rendered an empty `<div>`, the hint "Complete the verification above to continue" under it, and a permanently disabled submit button — and the server, failing closed, could only answer a submit with a generic 403. There was no route out of it short of a page reload.
  - `TurnstileStatus` names the seven states, and `onStatus` reports them. `captchaIsStuck()` separates the two the user cannot clear by waiting or clicking (`unreachable`, `failed`) from the rest; `expired` is deliberately not one of them, because the widget re-arms itself.
  - The stuck states render their own panel from inside `Turnstile`, so both auth forms get the same wording with no duplication: what failed, the domain to allow (`challenges.cloudflare.com` — the only actionable fact in the whole situation), and a Retry.
  - **`loadScript` gained a 12s timeout.** `onerror` fires in milliseconds for a refused connection and never at all for a null-routed or silently-dropped host, which is the shape most DNS filters and corporate proxies take. Without it the widget sat in `loading` forever and the button stayed disabled with no explanation.
  - **A failed load no longer caches its rejection.** `scriptPromise` was memoised unconditionally, so every later attempt — Retry, or the fresh widget `LoginScreen` mounts for the register to sign-in handoff — replayed the original failure without asking for the script. Allowing the domain and retrying could not work.
  - `error-callback` now logs Cloudflare's numeric code. It is the only way to tell a blocked subrequest from a bad site key after the fact, and it was being discarded.
  - `clearCaptcha()` replaces the four `resetTurnstile()` + `setTurnstileToken('')` pairs per form: a spent token has to take the status with it, or the form explains nothing under a button it has just disabled. A stuck widget stays stuck — resetting a script that never loaded does not load it.
  - `LoginModal` had no hint at all, only the disabled button; it now shares the same one.
  - Tests: `Turnstile.blocked.test.tsx` (12) — the message names the domain, `captchaIsStuck` over all seven states, the blocked panel and its Retry, the never-answering host, Retry as a real second request, a remount after a blocked load, the happy path, `error-callback`, and `expired` staying unblocked. Six mutations run — cached rejection, no timeout, `expired` as stuck, blocked-reports-ready, the domain dropped from the message, and `error-callback` reporting ready — each killed.
- **The marketing capturer and its guide still drove the deleted Express server** (`frontend/scripts/gen-marketing-shots.mjs`, `docs/marketing-screenshots.md`, `frontend/tests/e2e-seed.ts`). Retiring `backend/` took `nuke-demo.js` and the three-profile demo with it, so the documented setup — `node backend/scripts/nuke-demo.js`, `node backend/index.js`, shoot profile 3 — named three things that no longer exist, and the script's login posted `{username, password}` at a Worker that wants `{email, password}`.
  - The capturer now runs against the e2e suite's app: `wrangler dev` on a local D1, vite proxying `/api` at it, and the seeded fixture account. One fixture shot by both the suite and the stills, on purpose — a screenshot pipeline with its own idea of the data drifts from the app the moment either side moves, and it drifts silently, because the frames still render.
  - **The profile is looked up by name, not pinned.** `PROFILE=3` was a fact about a database that no longer exists; the fixture's id is whatever D1 handed out and differs per worktree. The script reads `GET /api/profiles` and takes `E2E Fixture`, warning if it falls back. A wrong id is not an error anywhere — it is six shots of an empty profile.
  - `EMAIL` / `PASSWORD` are overridable, defaulting to the fixture account.
  - The doc's three-step setup is deliberate: the capturer needs the servers still up when it runs, and Playwright stops the ones it starts. Step three is `--project=setup` so seeding does not also re-shoot the PWA install screenshots.
  - The stale `POST /api/profiles/reseed-demo` warning is replaced with the one that is now true: on the Worker it resets the current profile to default categories, so it empties the profile you are about to shoot. Same for the portfolio quote path, which is `worker/src/routes/portfolio.ts` now and fails the same silent way.
- **The e2e fixture seeds budgets** (`frontend/tests/e2e-seed.ts`) — four monthly ones on the spending categories that carry transactions. The budgets page and the dashboard's budget alerts had nothing but an empty state to render, which is also what made `03-budgets` the one marketing frame that could not be re-shot. `start_date` is the first of the current month: a budget's period is derived from it, so one dated mid-month reads as a partial period and every figure on the page becomes a fraction.
- **`exportBackup` aborted the entire backup on one unreadable R2 object** (`worker/src/backup.ts`, `worker/src/routes/exports.ts`). A receipt row whose `storage_path` no longer resolved threw `503 Receipt file "…" is unavailable; full backup aborted`, so an account with one orphaned receipt out of hundreds could not take a backup at all — and no retry fixes a blob that is gone.
  - Missing objects are now skipped and reported in `skippedReceipts` (`{receipt_id, original_name, reason}`) plus an `X-Backup-Skipped-Receipts` response header, because the browser downloads the file without parsing it and the UI needs somewhere to read the warning that is not a hundred megabytes of JSON.
  - The receipt's **metadata row is dropped with its bytes**. `validateBackup` requires every `receipts[]` entry to carry a matching `receiptFiles[]` entry, so a backup that listed a receipt it had no file for would export cleanly and then be rejected with a 422 on the way back in. Transactions pointing at a skipped receipt keep their row with `receipt_id` cleared — losing a purchase because its photo is missing would be a far worse trade than losing the pointer.
- **`GET /api/export` scoped the full backup to `X-Profile-Ids`, while `restoreBackup` deletes every profile the user owns** (`worker/src/routes/exports.ts`, `frontend/src/features/Settings.tsx`). The account-wide guarantee lived entirely in the caller: `Settings.tsx` passed `allProfiles()`, and nothing on the server required it. A stale header, a household mid-switch, or any script hitting the endpoint produced a backup that silently destroyed the profiles it omitted. The route now reads the user's profiles itself and ignores the header; `handleExport` no longer sends one. A user with no profiles gets a 404 rather than an empty file that restores as a wipe.
- **The profile cap made your own backup unrestorable** (`worker/src/routes/exports.ts`). `POST /api/import` rejected any backup with more profiles than the plan limit. Combined with the account-wide export above, an account holding more profiles than its current plan allows — a downgrade, a plan change, profiles created before the cap — could not restore its own data. The ceiling is now `max(planLimit, profiles currently owned)`: putting back what you had is always allowed, exceeding it is still capped.
- **Six read-then-write races between concurrent requests** (`worker/src/routes/{bills,recurring,transactions,receipts,auth}.ts`). Each was atomic in its write and non-atomic in its decision: a `SELECT`, a check in JS, then a `DB.batch` encoding a conclusion drawn from a row that could already have moved. D1 has no interactive transactions, so the fix throughout is to make the write itself the claim — a conditional statement inside the batch — and to report a lost race instead of applying a stale conclusion.
  - `POST /api/bills/:id/mark-paid` — read `last_paid_date`, checked `isBillPaidForCurrentPeriod`, then batched INSERT + balance + UPDATE. Two taps inserted two transactions and debited the account twice. Every statement now carries `(SELECT COUNT(*) FROM bills WHERE id = ? AND profile_id = ? AND (last_paid_date IS NULL OR last_paid_date <> ?)) = 1`, with the UPDATE last so the writes before it still see the pre-state; zero changes on the claim → 409.
  - `POST /api/recurring/:id/populate` — same shape against `next_date`. The guard is `next_date IS ?` bound to the value read, so the losing batch matches nothing. The invariant is one transaction per period advanced, not one per request: an overdue rule populated twice legitimately takes two periods.
  - `PUT` and `DELETE /api/transactions/:id` — the worst of the six, because it left permanent drift rather than a duplicate. Both paths reverse the transaction's OLD effect using values read before the batch, so two concurrent edits each reversed the same original: a 100 expense edited to 50 and to 30 credited 200 and debited 80, leaving the balance 50 out with no row to explain it. `unchangedSince(row, id, pid)` builds a predicate over exactly the fields the reversal arithmetic reads (`type`, `amount`, `amount_local`, `account_id`, `transfer_account_id`); every balance statement carries it and the row write moved to the END of the batch. A lost race is a 409, not a silent partial. Edits that touch only non-balance fields do not collide.
  - `POST /api/receipts` — `COUNT(*)` then insert. The insert is now `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`, with the R2 object cleaned up on refusal by the existing catch. The pre-flight count stays so an over-quota upload is refused before the file is streamed.
  - `POST /api/auth/reset-password` — `SELECT ... WHERE used_at IS NULL` then an unconditional `UPDATE`, plus three unbatched writes. The SELECT no longer filters on `used_at`: spending the token is the only gate (`UPDATE ... WHERE id = ? AND used_at IS NULL`, 0 changes → 400), and the password change and the retiring of the account's other pending links are one batch. Two gates for one fact meant the read could refuse before the write was ever exercised, so nothing proved the write was conditional.
  - `GET /api/auth/verify-email` — same single-gate restructuring.
- **`apiPut` / `apiGet` / `apiDelete` / `apiPost` threw before parsing the error body** (`frontend/src/core/api.ts`), so every failure through them read `Request failed with status 409` and the sentence the server wrote for the user was discarded. `parseJsonResponse` already raises with the server's own wording; the pre-throw is gone.
- **A thrown API error now carries `status`** (`frontend/src/core/api.ts`, `errorStatus()`), and `Transactions.tsx` uses it: a 409 toasts the server's message and refreshes the list, instead of the previous `console.error` that left Save looking inert.
- **`readCookie` returned the first `fm_session` header value; a browser can hold several.** Cookie identity is `(name, Domain, Path)`, not name alone, so a browser that had visited both `tokencircles.com` and `dev.tokencircles.com` held two `fm_session` cookies — one scoped `.tokencircles.com`, one `.dev.tokencircles.com` — and the prod-scoped one domain-matches the dev API. RFC 6265 §5.4 sorts equal-path cookies oldest-first, so a first-match-wins reader deterministically picked the stalest one: sign-in succeeded, the redirect authenticated with the wrong token, and the user landed back on the login screen. Only on a browser that had used both origins, which is why it reproduced on one machine and nowhere else.
  - `readCookies` returns every value; `authenticateRequest` tries each and the first that verifies wins. `AuthResult` carries `cookieCount` and the most informative failure reason, so the log distinguishes "no cookie" from "three cookies, none valid".
- **The login rate limit counted successes.** A successful login proves the credentials are right; spending the anti-guessing budget on it means signing in and out across a few devices produces "Too many requests" for a legitimate user. Limits are now per-IP (30/15min) and per-email (10/15min), counted on failure only, and both buckets are cleared on success (`clearRateLimit`). `humanWait` renders the retry as "in about 4 minutes" rather than a bare "please wait a bit".
- **The bank-import account error is now on the field, not only at the top of the page.** `runBankTransform` refused with `setError('Choose a target account for every recognized file')` and nothing else; on a phone that line is off-screen by the time the button is reachable, so the refusal was indistinguishable from the button doing nothing.
  - `rowsMissingAccount(rows)` is extracted and exported from `importFlow.ts`, and **both** the transform's guard and the UI's red-marking now call it — so what is coloured red is by construction exactly what the transform refuses on. Unrecognized rows are excluded: the transform skips them, so demanding an account there would be an error the user cannot clear.
  - `bankFilesMissingAccount()` gates that list behind `showBankFieldErrors`, set on the first failed attempt. Derived rather than stored, so filling one in clears its own error with no second submit and removing a row cannot leave a stale index behind.
  - `AccountSelect` gains `invalid` / `invalidMessage`: a `--expense` border plus a 1px ring (a 1px border on a 13px control is easy to miss on a phone, which is the screen this is for), `aria-invalid="true"`, and the message under the control.
  - The row itself takes a red border and `data-invalid="true"`, and the first offending row is scrolled into view — marking a field only helps if it is on screen.
- **`vitest.config.ts` now mirrors `vite.config.ts`'s `css.modules.localsConvention: 'camelCase'`.** Without it a kebab-case class reached through its camelCase name — `styles.createCard` for `.create-card`, which is how this codebase writes them — resolved to `undefined` under test, so every rendered component carried `class="… undefined"` and no test could assert on a class at all. Found by writing the first test that tried.
- Tests: `rowsMissingAccount` (5) and `AccountSelect.invalid` (5). Five mutations run — flagging unrecognized rows, indexing among recognized rows only, dropping the invalid class, dropping `aria-invalid`, never rendering the message — each killed.

### Removed

- `frontend/public/manifest.json` — dead since VitePWA started generating `manifest.webmanifest`. Nothing linked it, and its `short_name` ("Circles") disagreed with the one actually being served.
- **Email verification for password accounts (Worker).** `users.email_verified` has existed since `0001_init.sql` and was written but never asked for: `POST /api/auth/register` inserted it as `0`, and the only things that set it to `1` were Google's own `email_verified` claim and completing a password reset. Nothing read it — login did not check it and `/api/auth/me` did not return it, so a password signup was indistinguishable from a confirmed one.
  - `0022_email_verifications.sql` — same shape and the same reasoning as `password_resets` (0005): only the token's SHA-256 is stored, single-use, superseded on resend, expiry checked at use time. 24h TTL, longer than the 2h reset TTL because a reset link is a live credential and a confirm link is not. The row keeps the `email` it was minted for as well as the user id.
  - `GET /api/auth/verify-email?token=&returnTo=` — a top-level navigation with nothing to fill in, so it does the work and bounces back to the app as `#everified=1` / `#everified_error=…`, the way the Google callback already does. `returnTo` goes through `isAllowedReturnTo`, an unknown token and a spent one get the identical answer, the token is spent whatever the outcome, and the account's address must still be the one the link was sent to — otherwise changing it after asking for a link would confirm the NEW address on the strength of mail delivered to the old one.
  - `POST /api/auth/resend-verification` (session required) — 3/hour per address on top of the per-IP cap, and answers `{ ok: true, alreadyVerified: true }` rather than an error when there is nothing to confirm. The 429 can be shown here, unlike forgot-password: the caller already proved the account is theirs, so there is no address-existence oracle to protect.
  - `renderWelcome` takes an optional `verifyUrl`, which turns the primary button into "Confirm your email" and demotes "Open Token Circles" to a text link. One mail rather than two — a welcome and a confirm arriving together read as a duplicate. `renderEmailVerification` is the stand-alone resend, where welcome copy would be wrong.
  - `/api/auth/me` returns `email_verified`; the banner is the only thing that reads it, and this is the call it already makes.
- **`<VerifyEmailBanner/>`** — mounted at the top of `<main>`, above the page host, since the pages there stay mounted and hidden and a per-page home would render it once per page. Self-checking (asks `/api/auth/me` itself, re-asks on every session change, so it appears straight after an in-session signup), dismissible for the tab via `sessionStorage`. It shows nothing when `/me` omits `email_verified` — which is how the legacy self-hosted backend answers — rather than reading the absence as "unverified" and nagging every user of it with a Resend button that server has no endpoint for.
- `core/emailVerification.ts` reads the `#everified…` fragment in `index.tsx` before render and strips it: it is not a page, so the hash router would resolve it to a 404, and a fragment left in the address bar re-announces the outcome on every reload.
- Tests: `worker/test/email-verification.test.ts` (17) and `frontend/src/{core,components}/__tests__/` (26). Each guard is covered by a test that fails without it — verified by mutation for the address-still-matches check, single-use consumption, the `returnTo` allow-list, the absent-field case and the Google-account case.

### Notes

- Worker only. The legacy Express backend has no `/api/auth/register` at all, and browser-only mode has no accounts, so there is nothing to verify in either.
- Soft gate on purpose, copying the shape used in mercurypitch: the account works unverified and the banner is the only consequence. Making it a hard gate is a one-line change in login, but it strands anyone whose confirm mail is lost.

## [5.9.3] — 2026-08-23

### Fixed

- **`POST /api/profiles/reseed-demo` was additive.** It deleted a hand-written list of seven tables (`transactions`, `budgets`, `loans`, `categories`, `accounts`, `savings_goals`, `bills`) and then called `seedThreeTierProfiles()`, which re-seeds a profile as soon as that profile has no transactions and then inserts into `portfolio_holdings` and `recurring_transactions` unconditionally. Neither table was ever deleted, so every call appended another full copy — a database reseeded four times held SPY x4 and VTI x4 — while the response still returned `{ ok: true, message: 'Demo data has been restored' }`.
- **The same endpoint cleared one profile and re-seeded three.** The clear ran against the active profile only, so the other two demo profiles kept their rows; since the seeder skips a profile that still has transactions, "restore the three example profiles" restored whichever one was active. A demo profile that had been emptied another way hit the opposite case — the seeder re-seeded it on top of the accounts, holdings and goals the clear never reached. It now clears every demo profile the caller owns before seeding, and answers 403 to a caller who owns none of them instead of wiping that caller's active profile.
- **`DELETE /api/profile/data` carried the identical seven-table list**, so "clear this profile's data" left `portfolio_holdings`, `recurring_transactions`, `tags`, `receipts`, `housings`, `category_mappings`, `budgets_zero_based`, `retirement_goals` and `emergency_fund_config` in place. It now clears the same full set. Per-profile `settings` are still kept — they are configuration, not data.
- **`ProfilesRepository.deleteAllDataForProfile` deleted `categories` before `budgets_zero_based` and `category_mappings`**, both of which hold real foreign keys into it while the connection runs with `foreign_keys = ON`. Deleting a profile that had either populated could fail on a constraint. The shared list is ordered children-before-parents.

### Changed

- `backend/lib/profileTables.js` is now the single source of truth for what belongs to a profile: 16 tables with a `profile_id` column plus 4 child tables reached through a parent (`transaction_tags`, `loan_rate_periods`, `loan_prepayments`, `account_balance_history` — the middle two have no foreign key at all, so nothing cascades them). `routes/profiles.js`, `ProfilesRepository`, `scripts/nuke-demo.js` and `scripts/nuke-all.js` all read it; the four copies they used to keep had already drifted apart.
- `ProfilesRepository` gains `clearDataForProfile(pid, { includeSettings })`; `deleteAllDataForProfile` is that plus the profile row.

### Added

- `backend/test/unit/routes/profile-data-clearing.test.js` — in-process supertest against the real
  router, real repositories and the real seeder.
  - **Reseed.** Reseeds twice and asserts every table holds identical per-profile counts
    (`Math.random` is pinned, because the seeder randomizes how many dining/lunch/health rows it
    writes), asserts one holding per ticker, asserts a demo profile emptied by other means is
    rebuilt rather than doubled, asserts a stale row planted in profile 3 is gone after a reseed
    run from profile 1, and asserts a caller who owns none of the demo profiles gets a 403 with
    their own data untouched.
  - **Clear.** Plants a row in every per-profile table and then names the tables that still hold
    rows after `DELETE /api/profile/data`, so a failure says which table the delete list forgot
    rather than that a count was wrong. Rows are planted from `PRAGMA table_info` rather than a
    hand-written list, so a per-profile table added to `schema.sql` later is probed by the next
    run instead of being quietly skipped; child rows hang off a parent of the same profile,
    because `loan_rate_periods` and `loan_prepayments` declare no foreign key and
    `PROFILE_CHILD_TABLES` is the only place that link is written down. Also covers what the
    clear deliberately keeps — per-profile `settings` survive it, and deleting the profile
    outright takes them with it.
  - **Schema drift.** `PROFILE_DATA_TABLES + settings` must equal every table in `schema.sql`
    carrying a `profile_id`, so a new per-profile table cannot be added without landing in the
    shared list.
  - Eight of the twelve fail on the pre-fix tree. One fails with a 500 rather than an assertion:
    the old order deleted `categories` while `budgets_zero_based` and `category_mappings` still
    pointed at them. That path had no test at all — `BE-PRF-019` only asserted the response says
    `ok: true`, which it also said while leaving holdings, tags, receipts and housing behind.

### Notes

- Legacy backend only. #375 ("make destructive operations complete") swept the same class of bug out of the IndexedDB adapter and the Worker but never touched `backend/`, which is what a self-hosted Docker install runs. The Worker's `reseed-demo` calls `clearProfileData` and has no three-tier seed; browser-only mode does `clearAllData({ includeProfiles: true })` before `seedDemoProfiles()`. Both were already symmetric.

## [5.9.2] — 2026-08-23

### Added

- `shared/retirement.ts` — a month-by-month projection model with no I/O, run by the Worker
  and by the browser-only storage layer, replacing three hand-written copies that disagreed
  with each other and with the chart the page drew from their output. Covers what the old
  code could not express: inflation as a real/nominal pair rather than a discarded
  parameter, an opening balance, planned income steps and annual raises, dated expense
  periods, several lifestyle targets at once, and a return band.
- Simple and Advanced modes on the planner (`frontend/src/features/RetirementPlanner.tsx`,
  `settings().mode: 'simple' | 'advanced'`). Simple takes a contribution, a return and a
  target spend. Advanced projects income and spending separately — planned raises, a job
  change, a career break, dated periods of higher spending — and adds an allocation section
  ("Work the return out from an allocation") that derives the expected return from how the
  money is split rather than taking a typed rate. Both drive the same `shared/retirement.ts`
  projection; Simple is a reduced surface over it, not a second calculation.
- Inflation is a control, not just a model parameter (`RetirementPlanner.tsx`). On, the chart
  reads in today's money and the target line is flat — which is the point of reading it that
  way, since a target that drifts with inflation cannot be aimed at. Off, everything is
  nominal. The rate is kept either way, so toggling is non-destructive.
- `shared/retirementSettings.ts` — the saved shape of the assumptions, its normaliser, and
  derivation of unset fields from a user's accounts and transactions. The settings row is
  JSON last written by whatever version of the app saved it, so every field falls back
  rather than throwing; rates are clamped to a range a projection survives, expense windows
  that end before they start lose the end rather than silently contributing nothing, and
  duplicate lifestyle ids are made unique. Normalisation runs before storage as well as
  after, so the row can only ever hold something the model accepts.
- `GET`/`PUT /api/retirement/settings` on both runtimes. GET returns the saved assumptions
  with anything unset derived, plus what was filled and where from, and what could not be
  answered from the data at all.
- `frontend/src/features/RetirementPlanner.tsx` — the editable panel. The projection runs
  in the browser from the shared module, so the chart redraws on every keystroke instead of
  after a round trip, and still agrees with the server by construction. Only saving is a
  request.

### Fixed

- Every copy of the projection accumulated interest in a bucket that was never added back
  to the balance before the next month's return, so gains earned nothing. Over 30 years at
  7% that is 303k where the answer is 761k. The model is checked against closed-form
  arithmetic — a lump sum has to land on `pv * (1+r)^n`, level contributions on the annuity
  future value — which the replaced code fails outright.
- Annual rates were converted to monthly by dividing by twelve, which overstates the return
  by roughly 3% of itself at 8% and compounds from there. Now `(1 + r)^(1/12) - 1`
  everywhere, including `/api/calculators/retirement`.
- Real returns are netted with Fisher rather than by subtraction: 8.1% against 3.5% is
  4.44% real, not 4.6%, which is ~11% of the final balance over 40 years.
- `/api/calculator/retire` reported the balance after twice the projection horizon as
  "savings at retirement". It now reports the balance at the retirement age.
- The browser-mode FIRE calculator accepted an `inflationRate` and discarded it. It is
  passed through.
- `/api/retirement/projection` had always accepted overrides on the query string; the page
  called it with none, and had no controls that could have supplied any. The page now owns
  the inputs.

### Changed

- An income step now sets the salary outright instead of only raising it. It previously
  applied only when it beat what raises had already produced, so a sabbatical or a career
  change typed into the field was silently discarded and the chart did not move. Raises
  compound from whatever the step set, and a step already in force at the start month is
  the opening income. The spreadsheet fixtures are unaffected -- their steps all increase.
- `projectRetirement` clamps the horizon at 150 years. No plan reaches it, but
  `/api/calculator/retire` builds a horizon from a retirement age taken straight from the
  request body, which could otherwise allocate a row per month without bound.
- A month still being typed (`2026`) no longer counts as a start date. Comparing it yielded
  NaN, which fails every comparison, so an expense period quietly applied from the beginning
  of time while the user was mid-keystroke.
- "Plan until age" is disabled, with a reason, until a date of birth is set: stopping at an
  age means nothing without a date to count it from, and the projection ignored the field.
- The withdrawal-rate hint no longer prints "Infinityx your annual spending" when the field
  is cleared.
- The retirement page's chart came from a fourth formula applied to the endpoint's output
  (`cumulative += annual_contribution * (1 + return/100)^y`), which is neither the
  endpoint's arithmetic nor correct. The page renders the shared model's own series.
- Two e2e assertions on the retirement page stop swallowing a slow first paint into a fixed
  timeout, and retry properly instead.

### Changed

- **Removed 84 verbatim-duplicated rules from five CSS modules** — 519 lines, all pure deletions: `CategoriesPage` (-43 rules, lines 301-579 duplicated 580-858), `BudgetsPage` (-21), `GoalsPage` (-13), `HousingPage` (-5), `RetirementPage` (-2). Only rules whose selector _and_ whole source span (comments included) were byte-identical were touched, and the last occurrence is the one kept — the copy that already won the cascade, so nothing that sat between the copies changes. A selector repeated with _different_ declarations is a deliberate override and was left alone: `.btn-primary` appears twice in each of these files on purpose, the second time to apply the azure-glass recipe. This supersedes the note in 5.9.1 that the duplication was left for a separate change.
- Verified by rebuilding before and after and comparing the emitted stylesheets: after normalising the CSS-module name hashes (they embed file content and line numbers, so every generated class name shifts), all five affected chunks expand to an identical ordered list of selector/declaration pairs. The only textual difference is in `Retirement.css`, where esbuild now merges `.goal-balance` and `.goal-progress` — adjacent once the duplicates were gone — into one selector list.

- **Ten selectors that overrode themselves are now single rules.** `.modal-overlay` (Accounts), `.analytics-chart` / `.rate-label` / `.rate-value` (Analytics), `.budget-summary` / `.stat-item` / `.btn-outline` (Budgets), `.goal-progress` / `.goal-actions` (Goals) and `.ruleEditor` (Tags) were each declared twice in one file, the later copy quietly winning on some properties. They are merged into the first declaration, keeping the resolved value of every property.
- Each merge is proven order-independent before it is applied: no rule between the copies has equal specificity, sets an involved property, _and_ can land on the same element (checked against the class combinations the JSX actually puts on one element, so two single-class rules only count as a conflict when some element carries both). Declaration order was checked for shorthand/longhand hazards — `border` next to `border-radius` is not one, since `border-radius` is not part of the `border` shorthand.
- Verified by rebuilding: every selector in every built chunk resolves to an identical set of declarations.

- **The primary-button skin is defined once, in `styles/index.css`.** The azure-glass recipe was pasted into thirteen stylesheets, and in twelve of them appended a second time so it could override the solid fill the same file still declared — that appended block is what made deleting a duplicated rule look risky in the first place. Six tokens (`--btn-primary-bg`, `-fg`, `-border`, `-shadow`, `-bg-hover`, `-border-hover`) now name what the theme primitives are used for, and each page's single `.btn-primary` rule consumes them while keeping its own geometry. 240 lines removed, 116 added. Component modules that never got the retrofit (Layout, Spotlight, SettingsDialog, RecurringSection, DashboardSettings, BulkActionBar) are deliberately untouched: pulling them in would change how they look, not how they are written.
- Each page's `:hover` and `:hover:not(:disabled)` rules are collapsed into one `:hover:not(:disabled)`. That is the single deliberate behaviour change: **hovering a disabled primary button no longer applies the hover style.** It used to turn solid blue on nine pages (Dashboard, Transactions, Accounts, Budgets, Goals, Housing, Bills, Categories, Import), drop to 90% opacity on Retirement and brighten on Portfolio, because the plain `:hover` rule outranked the appended skin and nothing excluded disabled buttons.
- Verified in a browser rather than on paper: a probe carrying each page's own hashed button class, measured base and hover across all 13 pages. **4,544 computed values compared for enabled buttons — zero differences.** For disabled buttons the only differences are the eleven described above. Hover is a real mouse move and every measurement asserts `el.matches(':hover')`; an earlier attempt forced hover over CDP, which failed silently on some probes and hid most of these differences.

### Removed

- **Nine CSS modules nothing imported**, 629 lines that never reached a bundle: `Button`, `Card`, `Filter`, `Table`, `ModalContent`, `ModalActions`, `TaskList`, `CategoryMultiSelect` under `components/`, and `Page` under `pages/`. These are the shared-component stylesheets from the SolidJS migration whose contents were copied into each page module — the origin of the duplication above. They looked referenced under a substring grep: `Button.module.css` also matches `ExportChartButton.module.css`, and `Page.module.css` matches every `*Page.module.css` in `features/`.

### Added

- `cssModuleHygiene.test.ts` guards both defects for every `*.module.css`: no rule repeated verbatim inside one file, and no module left unimported. Both fail on the pre-change tree.
- `vitest.config.ts` now sets `css: true`. Under the default (`css: false`) vitest short-circuits every CSS import to empty content, so a `?raw` import of a stylesheet resolves to an empty string and any test asserting on stylesheet source passes vacuously ([vitest#10788](https://github.com/vitest-dev/vitest/issues/10788)). Cost measured at roughly +1s on the full suite, with all 1001 tests unaffected.

### Added — planner interaction

- `NumberField` — a numeric input that renders once untracked and syncs from the model only
  while `document.activeElement` is not the input. A controlled `value={n}` compiles to an
  effect that writes on every model change, and a partly-typed number (`3.`, `-`) makes
  `<input type="number">` report `value === ''` while still showing the text, so any write at
  that instant discards the keystroke.
- `MonthPicker` — a month `<select>` plus a year `<select>`, emitting and accepting `YYYY-MM`,
  replacing `<input type="month">`. The native control steps to a birth year one year at a
  time.
- `InfoTip` rewritten. The first version used the native `title` attribute, which is
  hover-only: on a phone every explanation in the app was unreachable. It opens on hover, on
  focus and on tap, pins on click, closes on Escape / outside press / blur, and is
  `position: fixed` from the trigger's measured box so it escapes any `overflow` ancestor and
  occupies no layout. Writing its tests turned up that Escape closed the panel and the focus
  it handed back reopened it in the same tick, so Escape appeared to do nothing.
- `RangeField` — a themed slider. Used for the withdrawal rate, paired with the existing
  number box, which doubles as its readout.
- `Toggle` gains a compact size and an optional label rendered inside the button. Putting the
  text in the control is what makes clicking the words flip it and what names the control for
  a screen reader; a `<label>` wrapped round a `<button>` does neither. The pill moved into
  its own span, so a label-less toggle is the same 44x26 box it always was.
- `frontend/src/features/lifestyleMarkers.ts` — a Chart.js plugin drawing a dashed line at
  each lifestyle's crossing with a pill label in that lifestyle's target-line colour. A
  plugin rather than an HTML overlay: it redraws with the chart on every data change, resize
  and theme swap, and clips to the plot area. Stateless — the markers arrive through
  `options.plugins.lifestyleMarkers`, because one plugin instance is shared across updates.
  Pills stack when they would overlap and labels are truncated with `measureText`.
- `frontend/src/features/chartZoom.ts` — scroll, pinch and drag over the x scale's
  `min`/`max`, which a category scale reads as point indices, so the axis relabels itself
  from whatever range it is given. No new dependency: `chartjs-plugin-zoom` would have been
  one for behaviour that is a hundred lines of arithmetic, and the window maths is separated
  from the DOM so anchoring, clamping and gesture fall-through are testable without a canvas.
  A wheel that would zoom out from the full extent does not `preventDefault`, so the chart is
  not a trap you can never scroll past.
- `Chart` takes an inline `plugins` array.
- `shared/retirement.ts` gains `yearsOfWithdrawals(swrPct, realReturnPct)` —
  `ln(s/(s-r)) / ln(1+r)`, with the pot cancelling out. Infinite when `s <= r`, `1/s` at
  `r = 0` (the formula's limit, where it is otherwise 0/0), zero at `r <= -1`.

### Fixed — the planner

- Editable lists used `<For>`, which keys by reference, over `.map(x => ({...x}))` — a new
  object per keystroke, so every row's DOM was disposed and rebuilt and focus went to
  `<body>`. Now `<Index>`, which keys by position. A `.claude/skills/solid-forms` skill
  records this and the controlled-input rule, with review greps, since it had been fixed and
  reintroduced before.
- Derived numbers are rounded. A contribution derived as a difference of two averages could
  be `7.292500000001382`, which is not a whole multiple of the field's `step` and so is
  `:invalid` — and one invalid field blocks the whole `<form>` from submitting, so the plan
  could not be saved at all.
- `deriveSettings` decided "the user has not set this" by comparing the stored value to the
  default. Every default is also an ordinary answer, so saving one was indistinguishable from
  never having saved: a contribution of 500, a net worth of 0, an income or spending of 0, a
  retirement spend of 2000. It now takes the **stored row** rather than a normalised object
  and asks which keys are present — normalising invents a default for every absent key and
  destroys exactly the distinction the function turns on. A key counts as set when present
  and not null, since `null` is how the client says "no value" for an optional field such as
  `birthMonth`. All three loaders return raw rows to match. Mutation-checked: restoring the
  old sentinel for any of the five numeric fields fails a test each.
- Both `PUT /api/retirement/settings` handlers re-derive and return `filled`/`missing`.
  Saving is what stops a field being derived, so a client that only took `settings` back went
  on crediting "filled in from your data" for figures the user had just typed.
- In browser mode the settings store is keyed by `key` alone — no profile column — and the
  assumptions were saved under a bare `retirement_settings`, so every profile in the browser
  shared one plan. The profile is now part of the key; a row saved under the old key is
  adopted by whichever profile opens the page first and the old row removed. Both server
  runtimes were always correct, separating profiles through the settings table's
  `(key, profile_id)` primary key. The legacy backend keys per profile rather than sharing
  the Worker's plain key because its settings repository looks rows up by key alone with no
  profile filter.
- The retirement page reloaded through `onMount`, which under the keep-alive page host
  (#317) fires once per session, so a profile switch left the panel showing the previous
  profile's plan. Now `refetchOnActive`, which refetches while visible and defers while
  hidden. Reverting it fails two of three tests.
- `GET`/`PUT /api/retirement/settings` added to the legacy backend, which had no route for
  them — a guaranteed 404 on every visit, surfacing as an intermittent E2E failure whenever
  `page-loading.spec.ts` sampled the console at the wrong moment. The Import page was
  requesting endpoints that server never had for the same reason, with the same result; it
  no longer calls them when the backend is the legacy one.
- `verifyTurnstileDetailed` reads Cloudflare's `error-codes` and separates a deployment fault
  (`invalid-input-secret`, `missing-input-secret` — logged, answered 503 with
  `captcha_not_configured`) from a client one (403). `/api/health` reports
  `captcha: configured | disabled | missing`, and `secret:{dev,prod}` now sets
  `TURNSTILE_SECRET`, which is how an environment came to be a secret short with nothing to
  notice it: `5caef64` switched the dev widget on, the dev worker had no secret, and
  `verifyTurnstile` took its fail-closed branch for every password sign-in from that day.

### Changed — planner layout

- Field hints move from block text under the controls into info tips on the labels. A field
  that carried one was taller than the field beside it, so its control sat out of line — the
  date-of-birth picker floating above the net worth box. An e2e test measures it: no field
  may carry text below its control, checked across every field in the form, so the next hint
  someone adds inline is caught wherever it lands.
- The left rail is 440px rather than 360px, `.form-row` aligns on the end edge, and
  `.list-row` wraps rather than shrinking its month selects to 80px.
- Skeleton placeholders are tinted from `--primary` via `color-mix(in oklab, …)` in both
  themes, at percentages chosen to keep their perceived weight (dark luminance 44.2 -> 42.8,
  light 215.9 -> 216.5).

## [5.9.1] — 2026-08-22

### Fixed

- **Orphaned `categories` route.** `App.tsx` navigates to each spotlight step's `requiredPage`, and the Categories tour's page is `categories` — a route present in `router.tsx` but absent from `navItems`, so it was reachable only via the tour or a hand-typed `#categories`. Added to the sidebar between Transactions and Accounts. Bills' "Categories" is a count of subscription groups and Budgets' is an embedded editor, so neither replaces the standalone manager.
- `.category-header` was `display: flex` with no `gap`; the 40px icon chip and the name rendered 0px apart. Set to `gap: 12px`, matching `.catCardHeader` on the Budgets page. The rule is triplicated in `CategoriesPage.module.css` (lines 570-839 duplicate 300-569 verbatim); all three copies were updated. The duplication itself is left for a separate change, since removing it can alter cascade order.
- `.color-btn` / `.color-picker-btn` were 24px circles with no flex centring and default button padding, so the 12-14px check SVG sat on the text baseline instead of the centre. Now `display: flex` + `padding: 0`; measured offset from centre is 0x0 in both the card swatches and the modal.
- Category icon fields were capped at `maxlength="2"` while advertising `e.g., food, home, car`. Raised to 32, and `getCategorySvg` now resolves a typed value through `iconFromUserValue`: exact `iconNameMap` key first, then the same keyword matching used on category names, so "food" and "groceries" land on real glyphs. `Object.hasOwn` guards the lookup so `constructor` / `toString` cannot resolve to a non-icon object now that longer strings are typeable. Applied to both `Categories.tsx` and the add-category modal in `Budgets.tsx`.
- The icon preview is a `createMemo`, not a bare `<CategoryIcon>`: a Solid component body runs once, so passing the signal as a prop rendered the icon held at mount and never updated as the user typed.

### Added

- `frontend/scripts/walk-tours.mjs` (`pnpm run test:tours`) — walks every spotlight tour step in a real browser against the seeded demo account and fails a step on either the app's own `targetMissing` banner or a degenerate highlight rect. 51 steps across 15 tours, desktop and mobile. Not wired into CI by choice; it is a pre-tag gate, documented in the `prod-update` skill.
- `spotlightStore.test.ts` gains two guardrails: every route in `router.tsx` must be reachable from the sidebar, and no tour may navigate to a page the sidebar omits. Both fail on the pre-fix tree.
- `.claude/skills/` is now tracked (`.claude/*` ignored, `!.claude/skills/`), carrying the `tour-check` and `prod-update` skills.

## [5.9.0] — 2026-08-21

### Added

- Tag rules — saved filters that attach a tag to matching transactions, implemented identically in both runtimes. Matching semantics live in `shared/tagRules.ts` (imported by the Worker and by the IndexedDB handlers) so a rule can never match differently in cloud and local-first mode: normalization coerces any stored/POSTed blob into a complete criteria object, unknown fields narrow rather than widen a rule, inverted amount/date bounds are swapped, and empty criteria match nothing so a half-filled rule can never sweep the ledger during a bulk apply.
- Storage: Worker migration `0021_tag_rules.sql` (`tag_rules` with profile/tag/`(profile_id, auto_apply)` indexes and `ON DELETE CASCADE` from `tags`); IndexedDB `DB_VERSION` 11 → 12 adds a `tagRules` store with `by_profile` / `by_tag` indexes. Criteria are stored as an opaque JSON blob — rules are always evaluated in memory, never compiled into SQL, so new condition types need no migration.
- API (both runtimes): `GET /api/tags/summary`, `GET|POST /api/tags/rules`, `POST /api/tags/rules/preview`, `PUT|DELETE /api/tags/rules/:ruleId`, `POST /api/tags/:id/apply`, `GET /api/tags/:id/summary`. Literal `rules` / `summary` segments are registered before `/api/tags/:id` (same ordering constraint as `categories.ts` `/mappings`), covered by a routing regression test. Apply is idempotent via `INSERT OR IGNORE` on `transaction_tags`; a single-rule apply pushes date/type/category/account conditions into SQL as a pre-filter only, with the shared matcher still making the final per-row decision, and reports `scanned`/`truncated` against a 20,000-row scan cap.
- Transaction create in both runtimes applies `auto_apply` rules to the new row after the balance batch commits, fail-soft: a tagging error can never fail or roll back a transaction the user successfully saved.
- New `Tags` page (`features/Tags.tsx`, registered in `router.tsx`, `PageName`, and the sidebar's Analytics group) with tag CRUD, per-tag totals for the global focus period, a monthly income/expense/transfer chart, a category breakdown, and a rule editor with dry-run preview and apply-to-existing. `#transactions?tag=<id>` deep-links into a filtered transactions list, adopted on `hashchange` as well as mount since pages stay mounted once visited. The link's source affordance is a "View" action on the tag chips rendered on the Transactions page itself, so a tag is a way into its own filtered list rather than only a label.
- Destructive and backup manifests updated for the new table: `tag_rules` is listed before `tags` in the Worker's profile-cleanup and backup `PROFILE_TABLES` (FK on `tag_id`), included in Worker export/restore with `tag_id` remapped through the restore's tag map and validated against the backup's tag ids, and added to IndexedDB `clearProfileData`, `clearAllData`, export/import, and the backup validator's optional/profile-scoped array lists.
- Bulk tag/untag endpoint `POST /api/tags/:id/transactions` (`{ transactionIds, mode: 'add' | 'remove' }`) in both runtimes, powering the Transactions selection-bar **Tag** action (Add/Remove toggle, multi-select chips, inline tag creation). Additive — adding leaves a row's other tags intact (unlike the whole-set `PUT /api/transactions/:id/tags`), and `add` is idempotent via `INSERT OR IGNORE`. Transaction ownership is validated against the active profile before linking, since `linkTransactionsToTag` is not itself profile-scoped (its rule-apply caller passes an already-scoped id list). `TAG_RULE_SCAN_LIMIT` moved into `shared/tagRules.ts` so the Worker's SQL `LIMIT` and the IndexedDB runtime's in-memory scan cap agree; the local scan now orders newest-first and reports real `scanned`/`truncated`.
- Saved import sources ("Connected Sources") — a reusable Google-Sheet link with its column mapping, category types and schedule. Worker migration `0020_import_sources.sql` plus `routes/import-sources.ts`; IndexedDB gets the mirror store and `handlers/importSources.ts`. The column mapping is persisted BY HEADER NAME rather than column index, resolved back to indices at fetch time (`shared/importMapping.ts`), so a source survives the sheet owner reordering columns.
- Daily cron sheet sync (`worker/src/import-sync.ts`), wired into the Worker's `scheduled` handler on the `0 8 * * *` trigger. Each `schedule='daily'` source is fetched server-side and run through the SHARED `executeImport` with a fresh `importId`, so the execute-side dedup lands only genuinely new rows and previously imported transactions are never disturbed. Best-effort per source: one unreachable sheet cannot stop the rest. Public sheets only — no credentials are stored.
- `shared/importNumber.ts` — one number parser for both runtimes, replacing the divergent hand-rolled copies. A single `.` or `,` is always the decimal separator (never thousands grouping); with both present the last one wins; grouping is validated strictly, so `1,2,3` and `12 34` stay rejected. Values are rounded to two decimals, and the result carries flags (`ambiguous-separator`, `rounded`) that the caller turns into a per-row warning. The `rounded` flag fires only when the value actually moved half a cent, so float residue does not flag hundreds of clean rows.
- `shared/importCsv.ts` — a single RFC 4180 scanner that tracks quote state across newlines, replacing two hand-rolled parsers that split into lines first. Both dropped any row containing a quoted line break and replaced it with shifted junk rows, silently. Also handles the `""` escape and strips a leading BOM, which would otherwise ride along inside the first header and break a saved header→column mapping.
- `shared/importRowChecks.ts` and `shared/importRowLabel.ts` — row-level validation and the human label used in rejections and warnings, shared so the two runtimes cannot diverge on which rows import.
- Theme resolution split into `applyTheme()` (paints, does not persist) and `setTheme()` (persists), with `hasExplicitChoice()` deciding whether the OS preference is followed. Previously the first `prefers-color-scheme` change wrote a preference and the app stopped following the OS from then on.
- `core/hashRoute.ts` centralizes hash→page resolution with explicit aliases and non-page routes, so an unknown hash renders a 404 page instead of leaving the previous page mounted.
- Loading skeletons for the Transactions, Dashboard and Budgets pages, replacing the bare word "Loading". The app-wide `.sr-only` class the status roles depend on was missing and is now defined.
- Tests for the daily sheet sync (`worker/test/import-sync.test.ts`) and for saved-source CRUD in both runtimes. The cron test pins the schedule string against `wrangler.jsonc` per environment — the coupling that would otherwise let a schedule edit switch the sync off with nothing failing — plus dedup across runs, header-name remapping, skip-without-syncing on a lost column, and per-profile isolation.

### Changed

- Account and Settings currency selectors now share one complete currency list. Currency inputs are normalized to uppercase three-letter codes instead of being limited by the old six-code frontend validation list.

### Fixed

- Local transaction lists now resolve `tags` from `tag_ids` against the `tags` store rather than trusting each row's denormalized copy, so renaming or recoloring a tag is reflected everywhere without a data migration; `tagsUpdate`/`tagsDelete` also write through to the stored copies, and deleting a tag drops its rules so it cannot keep auto-tagging.
- Tag-rule apply/preview no longer exceed D1's ~100 bound-variable limit: the "already tagged" `COUNT` chunked its id IN-list at 100, so together with `tag_id` it bound 101 variables and returned 500 whenever a rule matched ≥100 rows (the "apply to all previous" case). The link helper and the preview loop now chunk at 90; a 105-row apply regression-tests it.
- The single-rule date pushdown and the summary date window now compare `substr(date, 1, 10)` instead of the raw `date` column, matching the shared matcher's day-slice — so a transaction whose stored `date` carries a time component is no longer dropped from a same-day `dateTo` in the Worker while the IndexedDB runtime keeps it.
- Tags page layout and affordances (no change to matching, storage or the API). Selection is stated rather than implied — a left rail, tinted surface and focus ring on the selected card, a context bar naming the tag in its own colour, and "Rules for <tag>" on the rules card; a lone tag selects itself, since leaving it unselected hid the rules behind a click nobody knew to make. The rule count moved out of the card's main button into its own button that selects the tag and scrolls to its rules ("Add rule" when there are none) — nested inside, it could not be clicked on its own. The rule editor's `repeat(auto-fit, minmax(230px, 1fr))` packed ten unrelated fields into four columns on a wide screen; it is now a capped single column in four labelled sections. Multi-rule OR is stated on screen, and `#transactions?tag=<id>` appends `&period=all` when the tag has nothing in the focus period, so the link cannot land on an empty table that reads as a broken filter.
- Tags page: the detail chart and category breakdown refetch after "apply to existing"; an open rule draft resets when the selected tag changes (it no longer silently retargets the rule to the newly-selected tag); an in-flight preview can no longer overwrite a newer edit; the rule editor's category/account chips are scoped to the active profile; and the local `PUT /api/tags/rules/:id` returns `{ ok }` to match the Worker and the client type.
- Destructive operations now use complete, child-first cleanup manifests. Worker/D1 executes profile cleanup atomically with `DB.batch`, removes receipt objects from R2, and includes account history, transaction-tag links, loan rate/prepayment children, mappings, import logs, and every profile-owned feature table. IndexedDB uses one multi-store transaction and deletes balance history by the target account IDs. `Reset All` targets every profile owned by the signed-in user while preserving the profile records; client-only demo reseeding is the only action that replaces profiles. Account deletion is enabled with typed confirmation in production and removes user-scoped reports, error logs, reminders, reset tokens, and all profile data.
- Category reset preserves canonical default category IDs where possible, updates their metadata, detaches nullable references to removed custom categories, deletes dependent budgets that require a category, and reseeds the same default set in both runtimes. Regression tests cover cross-profile survival, all supported stores/tables, R2 deletion, category referential integrity, account deletion, and D1 rollback on an injected failure.
- Account starting/current-balance fields are locale-safe text inputs: the raw value is preserved while typing so the caret does not jump, and submission accepts either comma or dot decimals while rejecting ambiguous thousands-separated values.
- Manual account creation and import-created accounts now use the configured local currency in both the IndexedDB/serverless and Cloudflare Worker paths. Missing or malformed currency preferences fall back to EUR; currency-less imported transactions use the same fallback so their account and ledger currency cannot diverge. Worker account/settings defaults were aligned to EUR.
- Subscription catalogue custom prices now have separate draft and committed state: typing preserves raw comma/dot input and caret position, the row checkmark validates and visibly commits the normalized price/total, and batch Add validates and commits any remaining drafts. Invalid, zero, or ambiguous values stay highlighted and never reach `/api/bills`; component tests cover checkmark commit, API payload, malformed input, and caret preservation.
- Bill and Housing modal headers now share the compact `OrbitalAccent`, replacing their straight header rule with the branded orbit. Their shared `ToggleField` keeps Autopay as a borderless title/subtitle and switch row with stable narrow-modal layout and `aria-labelledby`/`aria-describedby` wiring.
- Bill mutations now include `autopay`; IndexedDB create/update responses normalize it to a boolean, and Worker/D1 adds and persists the missing `bills.autopay` column. Worker partial updates preserve unrelated bill fields. Regression tests cover the form payload plus local and Worker create/list/update/get round trips.
- Account recent-activity amounts now use `accountActivityPresentation()` for explicit income, expense, and transfer states. Transfers use `var(--transfer)` and a neutral `±` prefix rather than falling through to the green income presentation.
- Import no longer rejects a row for having no description, and no longer rejects a row for having no date — a dateless row imports dated today and says so. The blank-description rejection existed only in the IndexedDB runtime, so the same sheet imported cleanly in cloud mode while silently losing hundreds of rows locally.
- Rejected-row messages identify the row by its date and description instead of a bare index, and a self-transfer names the account both legs resolved to and the column each came from. The preview surfaces the per-row warnings (rounded amount, guessed date) alongside the rejections.
- The import preview's row numbers now match the spreadsheet's own row numbers (`sourceRowNumber`), instead of being one off.
- The daily sheet sync records `rows_skipped_invalid` and `rows_with_warnings` in the session it writes to Recent Imports, and no longer stamps `last_synced_at` when `executeImport` rejected the batch. Nothing is watching a cron run, so a guessed date or a rounded amount had no way to reach the user at all.
- E2E: the transaction-create spec pinned a hardcoded future date that the calendar eventually overtook, failing the suite on a date rather than a change.

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
