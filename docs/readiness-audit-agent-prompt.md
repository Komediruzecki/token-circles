# Agent Prompt — Token Circles Public-Readiness Audit

> Copy everything below this line into the agent session (Claude Code or similar), run it from the repo root.
> Recommended execution: one phase per session/PR, in order. Phases 1–3 produce code + tests; Phases 4–5 produce reports/design docs.

---

## Mission

You are auditing **Token Circles** (this repository), an open-source personal finance manager, for public readiness. Your priorities, in order:

1. **Security** — the app handles people's financial data; treat every finding through that lens.
2. **Data correctness & consistency** — money math, balances, transfers, imports, bulk operations, multi-profile isolation.
3. **Test coverage** — write tests for the untested segments listed below; every bug fix lands with a regression test.
4. **Architecture & scalability** — assess and report; do not perform large refactors without explicit sign-off.

You must **verify before fixing**: for each suspected bug, first write a failing test (or a reproduction script) that demonstrates the incorrect behavior, then fix it, then show the test passing. If a suspect turns out to be correct behavior, document why and move on — do not "fix" working code.

## Architecture context (read this before touching anything)

- **Frontend** (`frontend/`): SolidJS + TypeScript. Has **two mutually exclusive storage modes**, routed per-call by `frontend/src/core/apiFetch.ts`:
  - `serverless` (default, local-first): an in-browser reimplementation of the whole REST API — `frontend/src/core/storage/localApiRouter.ts` (~940-line route table) dispatching to `frontend/src/core/storage/handlers/*.ts`, persisted in IndexedDB via `frontend/src/core/storage/idb.ts` (DB `finance-manager`, version 9, autoIncrement integer IDs).
  - `self-hosted`: real `fetch` to the Worker API with cookie credentials (`frontend/src/core/api.ts`).
  - **There is no sync engine** — switching modes is a one-shot export→clear→import migration (`frontend/src/core/storage/storageFactory.ts`, `migrateData()`). "Cloud sync" in marketing terms means "server is the store". Keep this in mind: any "sync bug" you look for is actually a migration or dual-implementation-drift bug.
- **Worker backend** (`worker/`): Hono 4 on Cloudflare Workers, D1 (SQLite) + R2 (receipts), Zod validation (narrow — `worker/src/validation.ts` only), raw WebCrypto (no auth/Stripe SDKs). Routes in `worker/src/routes/*.ts`, mounted in `worker/src/index.ts`. Migrations in `worker/migrations/0001–0018`.
- **Legacy backend** (`backend/`): deprecated Express server, slated for removal. **Do not fix bugs here**; only flag if it's deployed anywhere or shares secrets/schema with the Worker.
- **Dual implementation hazard**: every entity operation exists **twice** (local handlers + worker routes). Fixing a bug on one side usually requires the same fix on the other, plus a test on each side. Always check both.
- **Multi-profile model**: scoping unit is `profile_id` (a "household" is just multiple profiles of one `user_id`). Server: profile resolved from `X-Profile-Id` / `X-Profile-Ids` headers in `worker/src/profile.ts`; enforcement is **per-query**, there is no scoping middleware. Client: localStorage keys `currentProfileId` (write target) and `selectedProfileIds` (read view), resolved in `idb.ts:181–201`.

### Commands

- Frontend unit tests: `pnpm -C frontend run test` (vitest, fake-indexeddb). E2E: `pnpm -C frontend run test:e2e` (Playwright, chromium preinstalled — do not run `playwright install`).
- Worker tests: `pnpm -C worker run test` (vitest-pool-workers; runs real workerd + local D1 built from `worker/migrations/`).
- Typecheck/lint: `pnpm typecheck`, `pnpm lint` (frontend); `pnpm -C worker run` scripts as defined.
- Run the full relevant suite before every commit. A phase is not done until all suites pass.

### Working rules

- Small, reviewable commits: one logical fix + its tests per commit. Conventional-commit style messages matching the repo history (`fix(transactions): …`, `test(worker/import): …`).
- Never change the public API shape, DB schema, or IndexedDB version without calling it out prominently; schema changes need a new numbered migration (`worker/migrations/00NN_*.sql`) and an IndexedDB `oldVersion` block — never edit an existing migration.
- When a fix requires a product decision (e.g. "should bulk type-change adjust balances or be forbidden?"), implement the **safest** option, and record the decision + alternatives in the final report.
- Maintain a running `AUDIT_FINDINGS.md` (local, not committed unless asked): ID, severity (Critical / High / Medium / Low), area, file:line, status (confirmed / fixed / reported-only / false-alarm).

---

## Phase 1 — Data correctness & consistency (fix + regression tests)

Investigate each suspect below. These were flagged by a preliminary scan and most are **unverified** — confirm with a failing test first.

### 1A. Money representation and float drift
- All amounts are floats end-to-end: `z.number()` in `frontend/src/schemas/models.ts`; SQLite `REAL` in `worker/migrations/0001_init.sql`; balances mutated incrementally (`frontend/src/core/storage/idb.ts:375–382` `_adjustAccountBalance`; `UPDATE accounts SET balance = balance + ?` in `worker/src/routes/transactions.ts`).
- Only the worker import recompute rounds (`worker/src/routes/imports.ts:541`); incremental paths never round → drift accumulates across create/update/delete cycles (`updateTransaction` reverses then re-applies deltas, `idb.ts:314–333`).
- **Do:** write a property/soak test (hundreds of add/edit/delete cycles with amounts like 0.1, 0.2, 19.99) asserting stored balance equals ledger-derived balance to the cent, on both sides. Then decide the minimal safe fix: full integer-cents migration is a **Phase 4 recommendation**, not a Phase 1 fix; the Phase 1 fix is consistent round-to-cents at every balance mutation point plus a "recompute balance from ledger" repair routine (see 1C).

### 1B. Transfers
- Single-row model: `type='transfer'` with `account_id` (source) and `transfer_account_id` (dest). Client: a transfer **without** `transfer_account_id` silently produces **no** balance adjustment while the row persists (`frontend/src/core/storage/idb.ts:163–165` in `computeBalanceDeltas`) — balances stop reconciling against history. Check the worker's equivalent path in `worker/src/routes/transactions.ts` and `worker/src/validation.ts` (is a destination required?).
- Test matrix: transfer create/edit/delete; editing a transfer's source account; editing amount vs `amount_local` (delta uses `amount_local` when present, `idb.ts:157`); self-transfer; transfer where source==dest; deleting the destination account of an existing transfer.

### 1C. Stored balances vs ledger
- Balances are denormalized on both sides with no recompute routine (client's only re-derivation is `deleteAllTransactions` → `starting_balance`, `idb.ts:359–373`; the `amount_local` preservation hack at `idb.ts:321–328` exists because drift already occurred).
- **Do:** implement a `recomputeBalances(profileId)` routine on both sides (worker has one inside imports — extract/reuse it), expose it as a maintenance endpoint/action, and add an invariant test helper `assertBalancesMatchLedger()` used across the Phase 1 suites.

### 1D. Bulk operations
- **Worker bulk update does not touch balances** (`worker/src/routes/transactions.ts:373–444`): the allow-list includes `type`, so bulk income→expense flips change balance semantics with no balance correction; bulk **delete** does reverse balances. Confirm and fix (either adjust balances or exclude `type` from bulk update — pick the safe one, and mirror the decision in `frontend/src/core/storage/handlers/transactions.ts:185–256`).
- Client bulk update silently drops `deduction` from allowed types — verify intended.
- Test: focused bulk suite on both sides — allow-list enforcement, 1000-id cap, cross-profile id smuggling (ids belonging to another profile/user in the id array), balance invariant after bulk type-change and bulk delete.

### 1E. Import correctness
Files: `frontend/src/core/storage/handlers/importFlow.ts`, `frontend/src/core/importMapping.ts`, `frontend/src/core/bankImport/*`, `worker/src/routes/imports.ts`.
- **Duplicate detection is weak** (`importFlow.ts:114–158`): key is date+description with amount tolerance ±0.01; ignores account/type/currency; doesn't dedupe rows *within the same file*. Write the test matrix, then tighten (include account/type/currency in the key; in-file dedup with a "same row twice is legitimate" escape hatch — flag, don't silently drop).
- **Date handling inconsistencies**: generic path converts via UTC `toISOString().slice(0,10)` (`importFlow.ts:35,64`) while bank path uses local date (`bankImport/parse.ts:96–101`) → off-by-one-day near midnight and cross-importer mismatch. Ambiguous `xx/yy/zzzz` is always day-first (`importFlow.ts:52–57`) — US dates misparse. Fix: single shared date-normalization utility, local-date semantics, day-first/month-first decided by mapping config or locale with explicit user choice when ambiguous. Full unit-test matrix for `normalizeDate` (Excel serials, gviz dates, all string formats, midnight-boundary cases).
- **Worker import is not atomic** (`worker/src/routes/imports.ts:340,391,496,551` — separate batches for accounts/categories/tx-chunks/balances; mid-run failure leaves partial state, mitigated only by `import_id` retry). Assess whether a single `batch()` is feasible within D1 limits; at minimum add a test for the partial-failure + idempotent-retry path.
- Number parsing: generic path is bare `parseFloat` (`importFlow.ts:149,574`) vs the bank path's locale-aware parsers (`bankImport/parse.ts:131–163`) — European "1.234,56" through the generic path is a corruption risk. Unify.
- Import session store: in-memory `Map`, `Date.now()-Math.random()` keys, never evicted (`importFlow.ts:74,179`) — add eviction and stronger ids (`crypto.randomUUID()`).

### 1F. Multi-profile isolation (correctness half; security half in Phase 3)
- Client fallback to profile `1` when localStorage is unset (`idb.ts:183`, `api.ts:49–58`) — unkeyed operations read/write profile 1. Reproduce (e.g. cleared localStorage with multiple profiles) and fix: fail loudly or resolve the user's actual first profile.
- Worker: wrong/unowned `X-Profile-Id` **silently falls back** to the user's first profile instead of 403 (`worker/src/profile.ts:34–50`). Within-user only, but a stale header writes data into the wrong household member's profile. Decide: keep fallback for reads, hard-error for writes (recommended), and test it.
- Client raw `getAll` bypasses: `exportData()` exports **all profiles** (`idb.ts:616–643`) — verify whether the UI presents that as "export my profile"; logs store is global. Test that every list/read handler respects `selectedProfileIds` and every write targets `currentProfileId`.
- Worker settings GET reads `profile_id IS NULL` global rows (`worker/src/routes/settings.ts:15`) — confirm no sensitive/per-user keys can land in NULL-profile rows.
- Cross-profile reference smuggling: `accountBelongsToProfile` (`worker/src/db.ts:43`) guards transactions — verify equivalent guards exist for every route that accepts a foreign key (budgets→category, receipts→transaction, recurring→account, bills→account, loans, transaction_tags, balance-history→account).

### 1G. Schema/type drift
- `Account.starting_date` (interface) vs `starting_balance_date`/`balance_date` (runtime); `Budget` interface missing rollover fields that handlers read/write (`frontend/src/types/models.ts:103–126`). Align interfaces with reality; boolean coercion in schemas (`schemas/models.ts:18,62,109`) — verify imports/restores can't produce surprising truthiness.
- Budget rollover chains only one month back (`handlers/budgets.ts:276–388`) — confirm intended; verify the worker computes rollover identically (dual-implementation drift). Test both.

### 1H. Concurrency (client)
- Local handlers do read-modify-write across multiple awaits outside a single IndexedDB transaction (e.g. `bulkDeleteTransactions` loop `idb.ts:346–357`); multi-tab is expected (`api.ts:30–32` storage listener). Write an interleaving test if feasible; otherwise wrap balance-mutating sequences in single IDB transactions where the `idb` library allows.

## Phase 2 — Test coverage for missing segments

Beyond the tests written in Phase 1, add coverage where none exists today:

**Worker (16 existing test files; gaps):**
- Auth: register/login/logout, cookie flags, JWT expiry + `token_version` invalidation, malformed tokens, password-reset flow, anti-enumeration responses, rate-limit windows (`worker/test/` has none of this).
- Google OAuth callback: state HMAC validation, `returnTo` allowlist, `aud`/`iss` checks (mock Google's tokeninfo).
- Stripe: webhook signature verification (valid/invalid/expired timestamp/replay), `stripe_events` idempotency, `stripe_event_at` ordering watermark, plan enforcement (`worker/src/plan.ts`) — a free user must get 402 on premium endpoints.
- Profile authorization: the full `X-Profile-Id`/`X-Profile-Ids` matrix (owned, unowned, malformed, missing) against read and write endpoints.
- Account deletion cascade (`worker/src/routes/account.ts:134`): every PROFILE_TABLES row for the user is gone, other users untouched.
- R2 receipts: premium gate, size/type limits, cross-profile access attempts on both file-serving paths.
- Bulk endpoints (from 1D).

**Frontend (35 unit + 30 e2e files; gaps):**
- `importFlow.ts`: `normalizeDate` matrix, `detectDuplicates` matrix, `importExecute` row-skip/auto-create/balance-replay beyond transfers.
- Focused bulk-edit suite.
- Float/soak balance invariant tests (1A).
- `SelfHostedAdapter` + `ApiClient` (network path) unit tests with mocked fetch: header injection, 401 event dispatch, Zod rejection of malformed responses.
- Mode migration edge cases: migration failure mid-way (target already cleared?), large datasets.

Do not chase 100% coverage; cover the money paths and authorization paths exhaustively, UI cosmetics not at all.

## Phase 3 — Security audit (fix what's safe, report the rest)

Run an OWASP-style pass over the Worker + frontend. Known items to verify first:

1. **AuthZ / IDOR sweep**: for every route in `worker/src/routes/`, confirm each query is scoped by `profile_id`/`user_id` and each client-supplied foreign key is ownership-checked. Enumerate any endpoint missing `requireAuth`. Pay attention to sub-resources (loan rates/prepayments, balance-history, transaction_tags, import-logs, custom_reports) and the stub endpoints in `receipts.ts` (share/split/categorize/export).
2. **Silent profile fallback** (`profile.ts:44–46`) — see 1F; from the security side, ensure it can never cross `user_id`.
3. **JWT/session**: HS256 + `JWT_SECRET`; 7-day non-refreshed cookie; `SameSite=Lax` + CORS `credentials:true` reflection of single `CORS_ORIGIN` (`worker/src/index.ts:71`). Assess: CSRF exposure on state-changing endpoints given Lax + custom headers, cookie `Domain` scoping, logout-everywhere correctness (`token_version`), secret rotation story.
4. **Headers/CSP**: verify the Worker and the deployed frontend set CSP, HSTS, X-Content-Type-Options, frame-ancestors; the legacy Helmet claims in `SECURITY.md` belong to the deprecated Express app — update `SECURITY.md` to describe the Worker reality (it also still says bcrypt; Worker uses PBKDF2-SHA256/100k — while you're there, evaluate raising iterations to OWASP-current or migrating to a stronger KDF, and the legacy-bcrypt re-hash-on-login TODO in `worker/src/auth.ts:89–107`).
5. **Data egress**: Google-Sheets import routes user sheet URLs through third-party `corsproxy.io` (`importFlow.ts:302`) — remove or make opt-in with a warning; prefer the Worker as the proxy for cloud users, direct published-CSV endpoints for local mode.
6. **Financial data in logs**: `localApiRouter.ts:926–931` logs full request bodies on validation failure; sweep both codebases for `console.log` of transaction/user payloads; check `worker/src/errorlog.ts` for PII in persisted `error_logs`.
7. **Uploads**: `xlsx` (SheetJS) parses untrusted files on both sides — check the vendored version against known CVEs (prototype pollution, ReDoS); enforce size limits before parse; R2 upload content-type/extension handling.
8. **Rate limiting**: D1 fixed-window exists for auth (`worker/src/ratelimit.ts`) — assess coverage for expensive endpoints (imports, PDF reports, email test-send) and per-user (not just per-IP) limits.
9. **Secrets & repo hygiene**: audit `frontend/.env`, `.env.dev`, `wrangler.jsonc` and git history for committed secrets; check stray files that shouldn't ship (`tsc_errors.txt`, `test-output.*`, `fix-selectors.sh`, `chart.umd.min.js`). Run `pnpm audit` / review lockfiles for known-vulnerable deps.
10. **Turnstile fail-open when unset** (`worker/src/turnstile.ts`) — confirm prod config requires it; document the self-host default.
11. **Demo/reseed endpoints** (`profiles.ts` `reseed-demo`, `/api/profile/data` reset) — confirm they can't be triggered cross-profile/cross-user and are rate-limited (data destruction endpoints).

Deliverable: findings table (severity, exploitability, affected mode: local/self-host/cloud), fixes committed for everything that doesn't require a product decision, and an updated honest `SECURITY.md`.

## Phase 4 — Architecture & scalability review (report only)

Produce `docs/architecture-review.md` covering, with evidence from the code:

1. **Float money → integer cents migration plan**: D1 migration strategy, IndexedDB version bump, API compatibility, rollout order (worker first vs client first), estimated effort.
2. **Foreign keys are not enforced in D1** (no `PRAGMA foreign_keys=ON`; core tables have no FK at all) — orphan-row risk inventory, whether to enforce via triggers/app-level checks, cleanup migration for existing orphans.
3. **Dual API implementation** (localApiRouter vs worker routes): drift risk assessment, options (shared spec + contract tests generated from one source; shared TS core executed on both sides), recommendation.
4. **No real sync**: what device-to-device sync would require (UUID primary keys — note current autoIncrement integer IDs collide across devices; tombstones; `updated_at` cursors; conflict policy), and how that interacts with the E2EE design from Phase 5.
5. **D1/Worker scalability**: per-query limits, `transactions.ts` list/filter/summary query plans vs indexes (`0012_transaction_account_indexes.sql`), pagination presence/absence on list endpoints, import chunking (100-row batches), cron reminder fan-out at 10k users, R2 costs.
6. **Operational readiness**: error_logs review loop, backup/restore story for D1 (export cadence, point-in-time), migration rollback strategy, monitoring/alerting gaps.
7. Prioritized roadmap: what must land **before** public launch vs after, with effort estimates (S/M/L).

## Phase 5 — E2E encryption design spike (design doc only)

Produce `docs/e2ee-design.md`. Constraints: solo-dev budget, Cloudflare Workers/D1/R2, existing features that read plaintext server-side (email reminders with amounts, PDF report generation, receipt storage, cross-device access). Cover:

1. **Threat model**: what E2EE protects against here (server compromise, subpoena of the operator, malicious insider) vs what it can't (compromised client, weak password).
2. **Recommended pattern**: per-user random Data Encryption Key (DEK); DEK wrapped by a Key Encryption Key derived from the password via Argon2id (or PBKDF2-SHA256 ≥600k iterations if sticking to WebCrypto-only); wrapped-DEK stored server-side; encrypt sync payload fields client-side (AES-256-GCM via WebCrypto); recovery key (printable, mandatory at enrollment) as second DEK wrap — otherwise password reset = permanent data loss.
3. **Feature impact matrix**: which current server-side features break under E2EE (server-rendered PDF reports, email reminders with real amounts, server-side analytics/summary endpoints, receipt features) and their client-side replacements or degraded modes.
4. **Incremental roadmap** (validate this staging): Stage 0 (now) — TLS everywhere + D1/R2 at-rest encryption (Cloudflare default) + honest security page; Stage 1 — encrypt the most sensitive columns client-side (amounts, descriptions, counterparties) with server keeping only what its features need; Stage 2 — full blind-server sync (server stores opaque blobs; all reports/analytics move client-side, which the local-first codebase already largely has). Note precedent: Actual Budget ships exactly this shape of optional E2EE sync.
5. **Effort estimate** per stage (dev-weeks), performance notes (Argon2 in WASM vs PBKDF2 native), and test strategy (round-trip vectors, wrong-key, recovery-key restore).
6. **Packaging recommendation**: free vs premium (see market analysis in the accompanying report) — E2EE as a trust feature for all paid-sync users, not a paywalled add-on.

## Final report

End with `AUDIT_REPORT.md`: executive summary (is it ready for public? what blocks launch?), findings table with severities and fix status, coverage before/after, and the prioritized pre-launch checklist. Be honest — the goal is an accurate readiness picture, not a clean report.
