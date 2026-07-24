# TokenCircles Code and Data Integrity Audit

Date: 2026-07-23  
Audited branch: `feat/autopay-toggle-polish`  
Audited commit: `ed85ba4`  
Scope: SolidJS frontend, IndexedDB/local API, Cloudflare Worker/D1, migrations,
tests, and deployment workflows.

## Executive Summary

No Critical vulnerability was confirmed. In particular, this scan did not find a
working cross-user data leak or an authentication bypass in the supported
Cloudflare Worker runtime.

The audit did confirm eight High-priority correctness themes. The most important
ones can materially delete the wrong subset of data, leave supposedly deleted
financial data behind, create malformed transfers, mutate a different selected
profile's account, or misstate balances because currencies are mixed.

The current Autopay polish is also a release blocker for its own feature: the
control is presented as functional, but its value is not persisted consistently
in either supported storage mode. That issue is narrower than the High-priority
architecture findings and is graded Medium, but it should be fixed before the
current polish PR is considered complete.

| Severity       | Count | Meaning in this report                                                             |
| -------------- | ----: | ---------------------------------------------------------------------------------- |
| Critical       |     0 | Cross-user exposure, authentication bypass, or widespread irreversible loss        |
| High           |     8 | Credible material loss, corruption, or financial misstatement in a normal workflow |
| Medium         |    11 | Incorrect behavior with a narrower trigger or recoverable impact                   |
| Low / refactor |     6 | Maintainability, accessibility, reproducibility, or presentation debt              |

## Remediation Status

Status updated: 2026-07-24. The evidence below remains the original audit
snapshot; this table records the resulting isolated implementation PRs. None was
merged as part of the audit task, so each can be reviewed independently.

| Finding | Pull request                                                    | Implemented control                                                                                                                                                  | Regression proof                                                                                                                                                |
| ------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01    | [#374](https://github.com/Komediruzecki/token-circles/pull/374) | Persists Autopay in IndexedDB and Worker/D1, aligns mark-paid behavior, fixes subscription price editing, and completes the requested modal/account-activity polish. | Bill create/update/reopen and mark-paid contract tests in both supported runtimes.                                                                              |
| H-01    | [#375](https://github.com/Komediruzecki/token-circles/pull/375) | Uses explicit deletion manifests, removes child rows and receipt objects, reseeds categories consistently, and preserves non-target profiles.                        | Every-domain target deletion and cross-profile survival tests for local and Worker storage.                                                                     |
| H-02    | [#376](https://github.com/Komediruzecki/token-circles/pull/376) | Enforces finite positive amounts and complete, distinct transfer accounts across create, update, bulk, recurring, and import paths.                                  | Mutation and balance-delta contract tests for valid and malformed transactions in both runtimes.                                                                |
| H-03    | [#377](https://github.com/Komediruzecki/token-circles/pull/377) | Validates profile ownership for linked records and blocks stale or cross-profile foreign keys before writes and balance updates.                                     | Two-profile ownership, stale-selection, and non-target-balance survival tests.                                                                                  |
| H-04    | [#378](https://github.com/Komediruzecki/token-circles/pull/378) | Replaces implicit API headers with explicit current-write, current-read, and household-read scopes.                                                                  | Header contract and two-profile page-data tests that expose accidental mixed scope.                                                                             |
| H-05    | [#379](https://github.com/Komediruzecki/token-circles/pull/379) | Centralizes normalized transaction values and applies them to reports, counterparties, reconciliation, calculators, and account activity.                            | Mixed EUR, HRK, and USD aggregate tests in IndexedDB and Worker/D1.                                                                                             |
| H-06    | [#380](https://github.com/Komediruzecki/token-circles/pull/380) | Keeps balances and starting balances in account-native currency, converts deltas at account boundaries, and converts only for display totals.                        | Mixed-currency create/edit/delete/recompute and total-display tests.                                                                                            |
| H-07    | [#381](https://github.com/Komediruzecki/token-circles/pull/381) | Uses one strict locale-aware parser for all imported amounts and opening balances and rejects ambiguous/non-finite rows.                                             | US/EU separators, whitespace, negatives, ambiguity, invalid-row UI, legacy bulk, and opening-balance tests.                                                     |
| H-08    | [#382](https://github.com/Komediruzecki/token-circles/pull/382) | Adds a canonical v3 backup, every-profile migration, attachment bytes, transactional local restore, staged Worker restore, and an active Settings restore workflow.  | Two-profile/every-domain round trips, cross-user survival, R2 fail-closed export, staged rollback, malformed-profile rejection, and zero-byte attachment tests. |

Supported runtime scope for these fixes is IndexedDB/local API plus Cloudflare
Worker/D1. The Express backend is deprecated and intentionally unchanged; its
parity work remains a documented follow-up if it becomes supported again.

## Priority Findings

| ID   | Severity                | Finding                                                                                                 | Recommended destination          |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| H-01 | High                    | Danger Zone deletion/reset operations are incomplete, non-atomic, and mode-divergent                    | Dedicated destructive-actions PR |
| H-02 | High                    | Bulk and recurring workflows can create one-legged transfers with different balance effects per runtime | Transaction-invariants PR        |
| H-03 | High                    | Household selection can cross-link transactions and mutate another selected profile's account           | Profile-scope PR                 |
| H-04 | High                    | Two API client paths apply different household scopes, producing mixed totals on one page               | Profile-scope PR                 |
| H-05 | High                    | Several reports use original transaction amounts instead of normalized base-currency amounts            | Currency-correctness PR          |
| H-06 | High                    | Account balances combine native starting balances with base-currency deltas and totals                  | Currency-model design PR         |
| H-07 | High                    | Import parsing can turn localized amounts into truncated values or `NaN` balances                       | Import-correctness PR            |
| H-08 | High                    | Storage migration is nonfunctional toward Worker and "full" backup omits financial domains              | Backup/migration PR              |
| M-01 | Medium, release blocker | Autopay does not persist; mark-paid semantics diverge by runtime                                        | Current polish PR                |
| M-02 | Medium                  | Automated bill/recurring transactions use hard-coded or default currency and UTC dates                  | Transaction-invariants PR        |
| M-03 | Medium                  | Undoing an import has a crash window that can leave balances stale                                      | Import-correctness PR            |
| M-04 | Medium                  | Imperative page loaders can let stale requests overwrite current profile/period data                    | Reliability PR                   |
| M-05 | Medium                  | Accounts activity is calculated from only the newest 500 global transactions in Worker mode             | Accounts PR                      |
| M-06 | Medium                  | Goal contributions use race-prone read/modify/write and can be overwritten by category tracking         | Goals PR                         |
| M-07 | Medium                  | Deleting a category leaves dangling references and hidden records                                       | Destructive-actions PR           |
| M-08 | Medium                  | A valid 0% loan is silently stored as 5% in Worker mode                                                 | Loans PR                         |
| M-09 | Medium                  | Production Worker tests are absent from PR CI and Worker installs are not lockfile-pinned               | CI/release PR                    |
| M-10 | Medium                  | Reconciliation totals and write scope differ between runtimes                                           | Accounts/transactions PR         |
| M-11 | Medium                  | Google Sheet fallback can send financial data through a third-party proxy without explicit consent      | Import privacy PR                |

## High-Severity Findings

### H-01: Destructive operations are incomplete, non-atomic, and inconsistent

**Reachable workflow**

Settings -> Danger Zone exposes reset categories, clear profile data, delete
profile, reseed demo data, and reset all data. The copy promises substantially
more complete behavior than some handlers perform.

**Evidence**

- `frontend/src/components/DangerZone.tsx:145` says category defaults are
  restored while transactions remain.
- `worker/src/routes/categories.ts:510` deletes categories without reseeding
  defaults or detaching references.
- `worker/src/routes/exports.ts:166` implements `/api/clear-all` for one profile
  and deletes only transactions, budgets, loans, categories, accounts, and
  settings.
- `frontend/src/features/Settings.tsx:720` calls `/api/clear-all` without an
  explicit target-profile header even though the UI describes broader behavior.
- `worker/src/routes/profiles.ts:16` defines profile cleanup as a sequence of
  independent table deletes. Child rows without `profile_id`, including loan
  periods/prepayments and account history, are not covered by that list.
- `frontend/src/core/storage/handlers/profiles.ts:84` similarly leaves local
  account history behind because history is keyed by `account_id`, not
  `profile_id`.
- `frontend/src/core/storage/idb.ts:945` omits category mappings and import logs
  from local `clearAllData`.
- Receipt metadata and R2 receipt objects are not consistently deleted with the
  owning profile.
- Local and Worker "reseed demo" actions have different semantics.

**Impact**

A user can receive a success message while private financial records, receipt
objects, category links, settings, or import history remain. Reset Categories can
leave transactions, budgets, goals, and bills pointing at deleted IDs. A failed
multi-step deletion can leave a partially deleted profile.

**Required fix and tests**

Define one deletion manifest per operation and apply it transactionally where D1
allows. Explicitly delete child rows and R2 objects. Add cross-profile tests that
seed every supported financial domain, run each action, and assert both complete
target cleanup and survival of all non-target data.

### H-02: Malformed transfers are accepted and affect balances differently

**Reachable workflow**

Transactions -> select rows -> Bulk edit type -> Transfer. Recurring rules can
also be saved as Transfer without a destination account.

**Evidence**

- `frontend/src/components/BulkActionBar.tsx:180` offers Transfer as a bulk type.
- `frontend/src/features/Transactions.tsx:309` submits only
  `{ type: "transfer" }`; it does not collect a destination.
- `frontend/src/core/storage/handlers/transactions.ts:205` and
  `worker/src/routes/transactions.ts:349` accept that partial update.
- `worker/src/routes/transactions.ts:40` debits the source of a transfer even
  when no destination exists.
- `frontend/src/core/storage/idb.ts:193` skips the local balance adjustment for
  the same malformed transfer.
- `frontend/src/components/RecurringSection.tsx:96`,
  `frontend/src/core/storage/handlers/recurring.ts:29`, and
  `worker/src/routes/recurring.ts:163` do not enforce a destination for transfer
  rules.

**Impact**

The same normal UI action can reduce a Worker account balance but leave an
IndexedDB account unchanged. It also creates records that the transaction view
cannot represent as a valid account-to-account flow.

**Required fix and tests**

Create a shared transaction invariant:

- Income: destination/source account required according to the chosen canonical
  representation.
- Expense: source account required when balance tracking is expected.
- Transfer: distinct source and destination accounts required.
- Amount: finite and greater than zero.

Enforce it before create, update, bulk update, recurring generation, and import.
Add contract tests that execute each mutation in both supported runtimes and
compare resulting records and account deltas.

### H-03: Household selection can cross-link and mutate profiles

**Reachable workflow**

Select multiple household profiles, keep a page mounted, choose an account or
category visible from another selected profile, then create or edit a record
under the current profile.

**Evidence**

- `frontend/src/core/storage/idb.ts:233` exposes all selected profile IDs for
  aggregate reads.
- Local list handlers aggregate selected accounts, categories, and transactions,
  while create handlers default ownership to the current profile.
- `frontend/src/core/storage/idb.ts:352` creates a transaction without proving
  that linked account/category IDs belong to the transaction profile.
- `frontend/src/core/storage/idb.ts:469` applies deltas by global account ID, so
  a cross-linked record can mutate another selected profile's account.
- Several local by-ID handlers for bills, recurring rules, accounts, budgets,
  categories, housing, loans, goals, receipts, tags, and mappings lack a current-
  or selected-profile ownership guard.
- `worker/src/routes/transactions.ts:612` validates explicit account IDs against
  the current profile, but name-based resolution searches selected profiles.
  Category ownership is not consistently validated.
- Keep-alive pages preserve previous data while a profile refetch runs, making a
  stale-ID click during profile switching a realistic race.

**Impact**

Records can be owned by profile A while referencing profile B's account/category.
Balance updates can then mutate profile B. Joins constrained by matching
`profile_id` may hide the linked label later, making corruption hard to diagnose.
No cross-user path was confirmed because selected profiles are still checked
against the authenticated user.

**Required fix and tests**

Make profile ownership explicit in every mutation. Reject cross-profile foreign
keys unless a separately modeled household transfer explicitly permits them.
Add stale-page and concurrent profile-switch tests, plus database assertions that
all transaction/account/category profile IDs match.

### H-04: API helpers disagree on current-profile versus household scope

**Evidence**

- The full API client sends both `X-Profile-Id` and `X-Profile-Ids`:
  `frontend/src/core/api.ts:25`.
- The standalone `apiGet`, `apiPost`, `apiPut`, and `apiDelete` helpers send only
  the current profile: `frontend/src/core/api.ts:1214`.
- Dashboard's primary data uses the full client while its Sankey request uses
  `apiGet`: `frontend/src/features/Dashboard.tsx:261`.
- Analytics, Budgets, Categories, Goals, Counterparties, and Portfolio use helper
  paths with current-only scope in at least part of each page.
- Transactions can load household rows but obtain an incomplete account/category
  universe for rendering or editing.
- Reconciliation summary and reconciliation mutations use different scopes.

**Impact**

One page can show a household total in one panel and a current-profile total in
the next. Records from secondary profiles can lose labels or be omitted from
account choices. Behavior also differs between Worker and local mode because
some local handlers independently consult selected profile IDs.

**Required fix and tests**

Replace implicit header behavior with an explicit request scope:
`current-read`, `current-write`, or `household-read`. Centralize header
construction. Add page contract tests with two profiles and intentionally
different values so an accidental mixed scope is visible.

### H-05: Base-currency normalization is not consistently used

The established normalized value is `amount_local ?? amount`, but several
financial calculations still use raw `amount`.

**Evidence**

- Counterparty totals: `worker/src/routes/counterparties.ts:15` and
  `frontend/src/core/storage/handlers/counterparties.ts:22`.
- Worker emergency-fund spending: `worker/src/routes/calculators.ts:432`.
- Local tax, profit/loss, and custom reports:
  `frontend/src/core/storage/handlers/reports.ts:55`.
- Account monthly totals/activity: `frontend/src/features/Accounts.tsx:310`.
- Account and transaction reconciliation summaries:
  `worker/src/routes/accounts.ts:220`,
  `worker/src/routes/transactions.ts:573`, and their local counterparts.
- Local custom reports also read a nonexistent `category_name` field from raw
  transaction objects, grouping records as Uncategorized.

**Impact**

Historical HRK transactions can be counted as if the numeric HRK value were EUR,
inflating affected totals by roughly the conversion factor. Reports disagree
with balances and can differ by runtime.

**Required fix and tests**

Introduce one finite normalized-amount helper for frontend calculations and one
SQL expression/helper for Worker queries. Add mixed EUR/HRK/USD fixtures to every
financial aggregate contract test.

### H-06: The account currency model mixes incompatible units

**Evidence**

- Accounts have a currency and a raw starting balance.
- Balance deltas and recomputation use base-currency transaction values:
  `frontend/src/core/storage/idb.ts:188` and
  `worker/src/recompute-balances.ts:1`.
- Account starting balances are not converted into the same unit first.
- `frontend/src/features/Accounts.tsx:291` sums all account balances and formats
  them using the global display currency.
- Worker dashboard/net-worth queries sum raw account balances across currencies:
  `worker/src/routes/dashboard.ts:124` and `:357`.

**Impact**

For example, a USD account starting at 1,000 can receive EUR-normalized deltas
and then be included as "EUR 1,000" in net worth. This is a fundamental unit
error, not only a display issue.

**Required design decision**

Choose and document one invariant:

1. Account balances are native currency; transactions update them in native
   currency and aggregations convert at a dated/current rate, or
2. Account balances are always base currency; account currency becomes display
   metadata and all starting balances are normalized on input.

Do not patch individual displays until this invariant is chosen. Test transfers
between two differently denominated accounts.

### H-07: Localized import values can truncate or poison balances

**Evidence**

- Imported account balances use bare `parseFloat`:
  `frontend/src/core/storage/handlers/importFlow.ts:729`.
- Imported `amount_local` and exchange rates also use bare `parseFloat`:
  `frontend/src/core/storage/handlers/importFlow.ts:922`.
- Worker imported account starting balances use the same unsafe parse:
  `worker/src/routes/imports.ts:442`.
- JavaScript parses `"3,177.94"` as `3`, `"1.234,56"` as `1.234`, and invalid
  input as `NaN`.
- The delta implementation accepts `NaN` as a number by type and can propagate it
  into an account balance.

**Impact**

A valid salary or starting balance can be reduced by orders of magnitude, or an
account can become `NaN`. The robust parser used for the primary amount column
does not protect these secondary fields.

**Required fix and tests**

Use one strict locale-aware finite-number parser for every imported numeric
field. Reject ambiguous or non-finite values with a row-level preview error.
Cover US thousands, decimal comma, European thousands, whitespace, negatives,
and invalid input in both runtimes.

### H-08: Migration and full-backup promises are not met

**Evidence**

- `frontend/src/core/storage/storageFactory.ts:120` exports, switches storage,
  and imports.
- Self-hosted import calls `POST /api/import`:
  `frontend/src/core/storage/storageFactory.ts:617`.
- The supported Worker explicitly does not implement that endpoint:
  `worker/src/routes/exports.ts:8`.
- Settings still exposes both migration directions:
  `frontend/src/features/Settings.tsx:967`.
- Worker full export omits bills, housing, recurring rules, tags/mappings,
  receipts, zero-based budget data, emergency configuration, import logs, and
  loan child tables: `worker/src/routes/exports.ts:111`.
- Multi-profile settings are flattened by key during export, allowing one
  profile's value to overwrite another.
- Export requests used by migration do not consistently include household scope.

**Impact**

Local-to-Worker migration fails. Worker-to-local migration can silently export
only one profile or an incomplete dataset. A user cannot rely on the advertised
full backup to reconstruct the application.

**Required fix and tests**

Version a canonical backup schema covering every owned domain and attachment.
Implement import for Worker or hide the unsupported direction. Add a two-profile
round-trip test that compares every table/domain and verifies receipt objects.

## Medium-Severity Findings

### M-01: Autopay is not persisted and mark-paid behavior diverges

- `frontend/src/features/Bills.tsx:223` omits `autopay` from the submit payload.
- Local bill update ignores `autopay`:
  `frontend/src/core/storage/handlers/bills.ts:148`.
- Worker create/update omit the field and the `bills` table has no corresponding
  column: `worker/src/routes/bills.ts:311` and
  `worker/migrations/0001_init.sql:240`.
- Worker mark-paid creates an expense and updates an account:
  `worker/src/routes/bills.ts:389`.
- Local mark-paid only changes `last_paid_date`:
  `frontend/src/core/storage/handlers/bills.ts:252`.
- The bill form does not select a payment account, so Worker-generated expenses
  are commonly unlinked.

**Disposition:** fix in the current Autopay polish PR and add persistence tests
for create/edit/reopen in local and Worker modes. The broader mark-paid contract
can be a follow-up if it cannot stay small.

### M-02: Generated transactions use the wrong currency and calendar date

- Worker recurring and bill-generated transactions omit currency and
  `amount_local`, allowing a schema default such as USD.
- Local recurring hard-codes EUR.
- Recurring cards format values as USD.
- Multiple transaction defaults use
  `new Date().toISOString().slice(0, 10)` despite
  `frontend/src/utils/period.ts:82` providing a local-calendar helper.

Around local midnight, a Zagreb transaction can land on the previous UTC date
and even the previous report month. Generated transactions should inherit the
account/base currency and use an explicit user timezone or local calendar date.

### M-03: Undo recent import can leave balances stale

`worker/src/routes/import-logs.ts:61` and
`frontend/src/core/storage/handlers/importLogs.ts:46` delete imported
transactions, recompute balances, and remove the log as separate steps. A crash
after deletion but before recomputation can make a retry see no transactions,
remove the log, and leave the stale balance permanently. The action also leaves
accounts/categories created by the import, which should be stated clearly.

### M-04: Stale async requests can overwrite current page state

`frontend/src/core/pageVisibility.ts:45` launches loaders without cancellation or
a generation token. Dashboard Sankey (`frontend/src/features/Dashboard.tsx:265`)
and imperative loaders in Budgets, Goals, Loans, Housing, Counterparties, and
Portfolio can apply an old profile/period response after a newer response.
Adopt abort signals or monotonically increasing request IDs.

### M-05: Accounts activity is derived from an arbitrary 500-row window

`frontend/src/features/Accounts.tsx:70` fetches the newest 500 global
transactions and then derives per-account activity/month totals from that slice.
With thousands of rows, older or less-used accounts appear inactive. Local mode
returns a different amount of history. Use account-scoped summary/activity
endpoints with explicit periods and pagination.

### M-06: Goal contributions are race-prone and can be overwritten

Worker and local contribution endpoints perform read-modify-write
(`worker/src/routes/savings-goals.ts:121` and
`frontend/src/core/storage/handlers/goals.ts:101`). Concurrent contributions can
lose an update, and zero/negative values are not consistently rejected. A goal
linked to a category is recomputed from transactions, so a manual contribution
can disappear on the next list. Use an atomic increment and make manual versus
transaction-derived progress mutually clear.

### M-07: Individual category deletion leaves dangling references

`worker/src/routes/categories.ts:510` and
`frontend/src/core/storage/handlers/categories.ts:52` remove category rows
without blocking, detaching, or remapping dependent transactions, budgets,
goals, bills, and mappings. Inner joins can then make budgets disappear while
transactions become uncategorized. Define one deletion policy and apply it
transactionally.

### M-08: A valid 0% loan becomes 5% in Worker mode

`worker/src/routes/loans.ts:30` and `:96` use
`interest_rate || 5.0`, so `0` is treated as missing. The local runtime preserves
zero. Use nullish/default validation and add zero-interest create/update tests.
Loan child writes/deletes should also share a transaction with the parent.

### M-09: The production Worker is not protected by PR CI

- `.github/workflows/ci.yml:20` runs frontend and deprecated backend checks, not
  Worker tests.
- `.github/workflows/deploy-worker.yml:61` installs Worker dependencies without a
  frozen lockfile and runs typecheck but not tests.
- The Worker sits outside the root workspace and has no dedicated checked-in
  lockfile despite workflow commentary implying one.

The supported production runtime can therefore deploy with dependency drift
after no Worker test run. Add Worker typecheck/tests to PR CI and pin the install.

### M-10: Reconciliation calculations and scope disagree

Worker account reconciliation uses all profile transactions and raw amounts:
`worker/src/routes/accounts.ts:220`. Local mode filters only source
`account_id`, missing the destination leg of transfers, and also uses raw amount:
`frontend/src/core/storage/handlers/accounts.ts:112`. Household reconciliation
summary and mutations additionally use different profile scopes. Define whether
reconciliation is account-ledger or transaction-status based and test both legs
of transfers.

### M-11: Third-party Google Sheet proxy use lacks explicit consent

`frontend/src/core/storage/handlers/importFlow.ts:449` can fall back to
`corsproxy.io` after direct methods fail. This can expose financial sheet
contents to a third party without an explicit user decision. Require an opt-in
with clear disclosure, or fall back to a user-downloaded file.

## Per-Page Quick Scan

| Page              | Result                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard         | Household scope is mixed (H-04); net worth mixes currencies (H-06); Sankey loader can race (M-04); some transfer presentation still inherits income coloring.                |
| Transactions      | Bulk transfer invariant is broken (H-02); profile-linked choices can cross-link (H-03); reconciliation scope differs (M-10); several defaults use UTC calendar dates (M-02). |
| Budgets           | API scope is inconsistent (H-04); deleted categories can hide budgets (M-07); imperative refreshes can race (M-04).                                                          |
| Loans             | 0% interest is corrupted in Worker mode (M-08); loan child cleanup/atomicity belongs under H-01.                                                                             |
| Goals             | Contribution updates can be lost or overwritten (M-06); category/profile ownership needs validation (H-03); loader can race (M-04).                                          |
| Bills             | Autopay does not persist and mark-paid differs by runtime (M-01); generated currency/date/account are incomplete (M-02).                                                     |
| Rent vs Buy       | No material page-specific defect confirmed in this quick scan; calculator validation and boundary tests remain the main residual risk.                                       |
| Compound Interest | No material page-specific defect confirmed; numeric boundary and accessibility coverage can be expanded.                                                                     |
| Emergency Fund    | Worker spending calculation uses raw, non-normalized amounts (H-05).                                                                                                         |
| Import            | Locale parsing can corrupt balances (H-07); undo has a stale-balance failure window (M-03); proxy fallback lacks consent (M-11).                                             |
| Accounts          | Mixed-currency balance model is invalid (H-06); activity is truncated to 500 rows (M-05); reconciliation differs by runtime (M-10).                                          |
| Categories        | Delete/reset leaves dangling references (H-01, M-07); household read/write ownership is ambiguous (H-03/H-04).                                                               |
| Settings          | Danger Zone does not match its promises (H-01); migration/backup is incomplete or unsupported (H-08).                                                                        |
| Retirement        | No material page-specific defect confirmed; storage/profile scoping of settings should be covered by household contract tests.                                               |
| Housing           | Profile-linked writes need ownership guarantees (H-03); imperative loader can apply stale data (M-04).                                                                       |
| Analytics         | Household scope and normalized-amount consistency need correction (H-04/H-05); transfer rows can still appear income-like.                                                   |
| Counterparties    | Totals use raw amounts (H-05); helper API applies current-only scope (H-04); loader can race (M-04).                                                                         |
| Portfolio         | Data is omitted from some destructive/backup paths (H-01/H-08); imperative loader can race (M-04).                                                                           |

## Shared Component Quick Scan

| Component/group                                                                                                                                   | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TransactionTable`, `BulkActionBar`, `TransactionSummaryBar`                                                                                      | Bulk type mutation permits invalid transfers (H-02). Transfer styling is improved in Accounts but is not yet a single shared semantic contract.                                                    |
| `RecurringSection`, `RenewalCycle`                                                                                                                | Missing transfer/amount invariants and currency/date assumptions (H-02, M-02).                                                                                                                     |
| `DangerZone`, `AccountDeletion`, confirmation controls                                                                                            | UI promises do not match cleanup manifests (H-01). Confirmation primitives should not compensate for incomplete backend semantics.                                                                 |
| `SubscriptionCatalogModal`, `SubscriptionCard`, `SubscriptionScan`                                                                                | Recent input/checkmark state work is covered by tests. Date default still uses UTC. No additional material defect confirmed in the quick scan.                                                     |
| `ReconciliationModal`, `AccountSelect`, `AccountConstellation`                                                                                    | Reconciliation contract differs by runtime (M-10); account choices require explicit profile-scope semantics (H-03/H-04).                                                                           |
| Dashboard cards/charts (`OverviewDeck`, `CategoryOrbits`, `SavingsRateCard`, `BudgetAlertsCard`, `SankeyChart`)                                   | Primary risk is inconsistent upstream scope/currency and stale requests, not chart rendering.                                                                                                      |
| Import components (`ImportDataEntry`, `ImportMappingStep`, `ImportPreviewStep`, `BankRulesEditor`)                                                | Duplicate/void-transfer preview behavior is now substantially clearer. Remaining issues are numeric parsing, undo atomicity, and proxy disclosure.                                                 |
| Profile/onboarding/auth (`ProfileModal`, `OnboardingWizard`, `LoginModal`, `LoginScreen`, `ResetPassword`, `Turnstile`)                           | No auth bypass confirmed. `Turnstile` has a low-risk late-script/unmount callback edge.                                                                                                            |
| Tags and category controls (`TagInput`, `TagFilter`, `TagChips`, `CategoryMultiSelect`, `CategoryIcon`)                                           | No material component-local defect confirmed; dependent-record cleanup is a storage-layer issue.                                                                                                   |
| Modal primitives (`Modal`, `ConfirmDialog`, feature-local modals)                                                                                 | Modal implementations are fragmented. Some lack a focus trap, Escape handling, focus restoration, or an accessible title. The generic `Modal` and `SettingsDialog` appear effectively unused/dead. |
| Design primitives (`Button`, `Badge`, `Pill`, `Toggle`, `ToggleField`, `OrbitalToggle`, dividers, rails)                                          | No material data defect. Consolidate toggle semantics to avoid cosmetic controls that are not wired to payloads.                                                                                   |
| Chart/error/loading utilities (`Chart`, `ChartWrapper`, `ChartErrorBoundary`, `ErrorBoundary`, `PageLoader`, `OrbitSpinner`, `ExportChartButton`) | No material defect confirmed. Bundle size is notable but code splitting is present; performance should be measured before refactoring.                                                             |
| Navigation/command helpers (`CommandBar`, `GuidedOrbit`, period controls)                                                                         | Several new-transaction defaults use UTC dates (M-02). No broader navigation defect confirmed.                                                                                                     |
| Duplicate `components/BulkActions/*` tree                                                                                                         | Appears superseded by the active top-level `BulkActionBar`; remove only after import/reference verification.                                                                                       |

## Runtime Parity Matrix

| Operation           | IndexedDB/local                                  | Worker/D1                                    | Risk                             |
| ------------------- | ------------------------------------------------ | -------------------------------------------- | -------------------------------- |
| Reset categories    | Deletes and reseeds in one handler path          | Deletes only                                 | Dangling IDs and mode divergence |
| Clear/reset profile | Partial store list; history cleanup is incorrect | Partial table list; child/R2 cleanup omitted | Residual private data            |
| Bill Autopay        | Create may store; update ignores                 | Create/update omit                           | Toggle does not persist          |
| Mark bill paid      | Date only                                        | Creates expense and updates account          | Different ledgers                |
| Malformed transfer  | Often no delta                                   | Source debit                                 | Different balances               |
| Recurring currency  | Hard-coded EUR                                   | Schema/default currency                      | Wrong currency                   |
| Emergency spending  | Uses normalized amount                           | Uses raw amount                              | Different recommendations        |
| Household reads     | Many handlers aggregate selected profiles        | Depends on which client/header path is used  | Mixed page totals                |
| Account activity    | Often all local rows                             | UI derives from latest 500                   | Missing history                  |
| Migration import    | Implemented locally                              | Endpoint absent                              | One direction fails              |

The Express backend was inspected only for historical context. It is deprecated
and is not treated as a supported runtime in the recommendations. Its remaining
parity debt should be documented rather than blocking current Worker work.

## Lower-Severity and Refactor Notes

1. Plain `pnpm -C frontend test` fails locally unless `NODE_ENV=test` is supplied,
   while CI injects it. Make the package script self-contained.
2. Modal accessibility is inconsistent: focus trapping, Escape, restoration,
   and accessible labels should move into one shared primitive.
3. Remove confirmed dead component trees (`SettingsDialog`, old BulkActions)
   after a reference/build check.
4. Transfer visual semantics should come from one helper across Accounts,
   Dashboard, Analytics, and TransactionTable.
5. Google import strategies are described as sequential but some request
   promises are created eagerly, starting redundant concurrent requests.
6. Guard late asynchronous Turnstile initialization after component cleanup.

## Recommended Work Split

### Current polish PR

Keep it narrow:

1. Persist Autopay on bill create/update in both supported runtimes.
2. Round-trip the value through the bill API/model and reopen the modal in tests.
3. Decide whether mark-paid transaction behavior is in scope; if not, document
   and move it to the transaction-invariants PR.

Do not place the broad deletion, profile-scope, currency-model, or backup changes
inside a visual polish PR.

### Follow-up PR 1: Destructive actions and referential integrity

Cover H-01 and M-07. Build explicit cleanup manifests, atomic operations,
attachment deletion, and cross-profile survival tests.

### Follow-up PR 2: Transaction invariants and profile scope

Cover H-02, H-03, H-04, M-02, and M-10. Centralize transaction validation,
balance deltas, request scope, and foreign-key ownership.

### Follow-up PR 3: Currency and import correctness

Cover H-05, H-06, and H-07. Decide the account-balance unit first, then replace
all raw amount and unsafe parser paths. Use the user's pre-2023 HRK history as a
regression fixture.

### Follow-up PR 4: Backup and migration

Cover H-08 and M-03. Define a versioned full schema and prove two-profile
round-trip fidelity before presenting migration as available.

### Follow-up PR 5: Reliability and delivery

Cover M-04, M-05, M-06, M-08, M-09, and M-11. This can be split further if the
review surface becomes too broad.

## Verification Performed

- Frontend typecheck: passed.
- Frontend lint: passed.
- Frontend production build: passed.
- Frontend tests in the same environment as CI: 67 files, 747 tests passed.
- Worker typecheck: passed.
- Worker tests: 29 files, 155 tests passed.
- Current PR checks: all reported passing.
- Read-only locale parsing reproduction confirmed the `parseFloat` truncation
  cases.

The existing passing suite does not invalidate the findings above; most are
cross-runtime contract, multi-profile, mixed-currency, crash-window, or complete-
deletion cases that the current tests do not exercise.

## Audit Limitations

- This was a fast static/data-flow audit, not a formal penetration test.
- No production database or private user data was read.
- No destructive action was executed against real data.
- No application fix was applied as part of this audit.
- Browser accessibility and visual behavior were inspected primarily through
  code and existing screenshots, not a complete assistive-technology pass.
