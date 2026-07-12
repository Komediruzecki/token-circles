# Deferred audit work — remaining items and plan

This tracks everything the readiness audit surfaced that has **not** yet been fixed in the four merged/open batches (PRs #286–#289). Each item says what it is, what it fixes, rough effort (S ≤ half a day, M ≈ 1–2 days, L ≈ 3+ days), and risk. Pick from here in any order; nothing below blocks the others.

Priorities are the maintainer's call — the ★ marks what I'd do first for a public launch.

---

## A. Correctness / data integrity

### A1 ★ Balance recompute-and-repair routine (audit D3) — M, low risk

**What:** There is no "recompute every account balance from its transactions" routine on either side; balances are only ever mutated incrementally. The one authoritative recompute lives inside the worker import handler.
**Fixes:** Gives a way to repair any balance that has drifted (from a past bug, an interrupted write, or a manual DB edit). Also underpins a "something looks wrong, recalculate" button.
**Plan:** Extract the worker import recompute into a shared `recomputeBalances(profileId)`; add the same on the client; expose a maintenance endpoint/action; add an `assertBalancesMatchLedger` test helper and use it across the balance suites.

### A2 Account/type/currency-aware import dedup (audit I4 remainder) — M, medium risk

**What:** Import duplicate detection keys only on date+description+amount(±0.01). Account, type and currency aren't in the key because they aren't known until _after_ dedup runs (type is inferred from the amount sign; the account is resolved in `importExecute`).
**Fixes:** Stops two legitimately-different transactions that share date/description/amount (e.g. the same bill paid from two accounts) from being silently dropped as duplicates.
**Plan:** Move duplicate detection to _after_ account/type resolution in `importExecute`, then key on (date, description, amount, account, type, currency). Add an explicit "flag, don't silently drop" path for genuine in-file duplicates.

### A3 Worker import atomicity (audit I5) — L, medium risk

**What:** `/import/execute` runs 5+ independent `DB.batch()` calls (accounts, balance-history, categories, tx chunks of 100, balance recompute). D1 makes each batch atomic but gives no cross-batch transaction, so a mid-run failure commits some and leaves the rest, with balances un-recomputed. The `import_id` idempotent-retry is the only mitigation and it's incomplete (retries without an `import_id` duplicate inserted chunks; auto-created accounts/categories are never rolled back).
**Fixes:** Removes partial-import / orphan-account states on a failed import.
**Plan:** Make `import_id` mandatory and always delete-by-`import_id` before reinsert (idempotent by construction); cap the transaction count; on failure, clean up auto-created accounts/categories created in the same run. Pairs well with A1 (recompute repairs any residual drift). _Bigger change — worth doing when import reliability becomes a priority._

### A4 Budget schema drift — rollover fields stripped (audit D6) — S, low risk

**What:** `BudgetSchema`/`Budget` omit `rollover_enabled/_amount/_used`, but the handlers read/write them via casts. Because `ApiClient` returns `schema.parse(raw)` and Zod strips unknown keys, **rollover settings are silently deleted from every budget fetched in server mode.**
**Fixes:** Budget rollover actually persists/round-trips in self-hosted/cloud mode.
**Plan:** Add the three fields to the interface and Zod schema; add a round-trip test.

### A5 Account starting-date field-name unification (audit D7) — S, low risk

**What:** The same concept is written under three names — `starting_date` (canonical, only one read), `starting_balance_date` (demo seed), `balance_date` (CSV/bank import). Seeded/imported accounts show a blank "starting balance date."
**Fixes:** Consistent starting-date display; removes dead phantom keys.
**Plan:** Unify on `starting_date`; one-time IDB fix-up to copy the old keys over.

### A6 Account deletion cascade (audit D10) — S, low risk

**What:** Client `deleteAccount` is a bare delete; transactions/transfers referencing that account linger forever in lists/analytics.
**Fixes:** No orphan rows pointing at a deleted account.
**Plan:** On delete, either block while referenced, or null-out/re-point references and recompute; mirror on the worker.

### A7 Budget summary: multi-profile + open-ended stacking (audit D12/D13) — M, low risk

**What:** (D12) `budgetsSummary` (and history/improvements/forecast/zeroBased) use the single current profile, so the household ("selected profiles") view drops other members' budgets — while `budgetsList` includes them. (D13) `budgetsAllocate` writes one open-ended row per month, and the summary filter `!end_date || end_date >= start` returns _all_ prior months' rows for a category, inflating any consumer that sums them.
**Fixes:** Correct household budget totals; no double/triple-counted budgets.
**Plan:** Thread `selectedProfileIds` through the summary endpoints; filter budgets to the queried month (as `budgetsZeroBased` already does) or set `end_date` on allocation.

---

## B. Security / privacy

### B1 ★ Full content CSP for the SPA (audit S2 remainder) — M, medium risk

**What:** Batch 3 added framing/sniffing/transport headers but deliberately not a `default-src`/`script-src`/`connect-src` CSP, because the app loads third-party scripts/frames (Stripe, Turnstile, Google sign-in) and calls external APIs — a wrong directive white-screens the app.
**Fixes:** Real defense-in-depth against XSS/data exfiltration for an authenticated finance app.
**Plan:** Enumerate every external origin the app talks to, write a strict CSP, and **validate it in a real browser** across sign-in, billing, imports and reports (report-only mode first, then enforce). Ship via `frontend/public/_headers`.

### B2 Cross-profile guards on client by-id handlers (audit S18) — S, low risk

**What:** In local mode, `reconcileBatch`, `reconcileToggle`, and single-item `transactionsUpdate`/`transactionsDelete` act on a row by id without checking it belongs to a selected profile — diverging from the worker's per-profile scoping. (Same-browser household members only; not a cross-user leak.)
**Fixes:** A stale id can't touch another household member's row locally.
**Plan:** Add the `selectedProfileIds.includes(row.profile_id)` guard to each by-id handler.

### B3 Profile-fallback hard-error on writes (audit S4) — S, low risk

**What:** The worker silently falls back to the user's first profile when `X-Profile-Id` is unowned/stale, including on writes — so a stale header can write into the wrong household member's profile (within the same user; no cross-user path).
**Fixes:** Writes land in the intended profile or fail loudly.
**Plan:** Keep graceful fallback for reads; return 400/409 on writes when the supplied profile id isn't owned.

### B4 Scoped/complete data export (audit S6) — S, low risk

**What:** Client `exportData()` dumps **all** local profiles; if the UI presents it as "export my profile" it leaks other members' data into the file. (The worker export is correctly scoped.)
**Fixes:** Export matches the user's intent.
**Plan:** Offer per-profile vs all-profiles export explicitly, or scope to selected profiles.

### B5 Category auto-create hygiene (audit I7) — S, low risk

**What:** Any non-matching `category` cell in an import creates a new category (exact-name only, no confirm), so a messy column spawns dozens of junk categories.
**Fixes:** No category-list pollution from a bad import.
**Plan:** Confirm-before-create, or fuzzy-match to existing categories, or only auto-create when the column is explicitly mapped to "category".

---

## C. Architecture / larger

### C1 Integer-cents money representation (audit D5, Phase 4) — L, higher risk

**What:** Money is floating-point end-to-end (JS floats, SQLite `REAL`). The audit soak test showed drift stays far below a cent at realistic volumes, so this is **hardening, not an active bug** — but integer minor-units is the robust long-term representation.
**Fixes:** Eliminates float representation entirely; removes display-artifact rounding.
**Plan:** Introduce a cents integer type at the storage boundary; D1 migration + IndexedDB version bump + API compatibility; roll out worker-first or client-first. Sizeable; do it when there's appetite for a data migration.

### C2 Shared logic between the two API implementations — L, medium risk

**What:** Every operation exists twice (local `localApiRouter`/handlers vs worker routes); this whole audit was largely about the two drifting. A shared core or contract tests would prevent future drift.
**Fixes:** Stops client/worker behavior diverging again.
**Plan:** Either extract a shared TS core executed on both sides, or generate contract tests from one spec. Evaluate cost vs. benefit first.

---

## D. Tests / hygiene

### D1 Exchange-rate tests are network-dependent (audit S12) — S, low risk

**What:** 3 tests in `localApiRouter.test.ts` call the live `open.er-api.com` and fail offline (they pass in CI, which has network). The "local" FX route also isn't truly offline.
**Fixes:** Deterministic offline tests; clarifies FX caching/offline behavior.
**Plan:** Mock `fetch` in those tests; consider a cached/offline FX fallback in the handler.

---

## Suggested first slice for public launch

**A4** (rollover data loss — quick, real), **A1** (balance repair — safety net), **B1** (SPA CSP — the biggest remaining security gap), **A7** (household budget correctness). Everything else can follow.
