# Token Circles native surfaces and parity plan

Status: proposed interaction specification, 2026-09-13. The product identity is retained; the mobile presentation is new. This document does not approve a V1 scope, claim native implementation exists, or remove any existing web capability. Source behavior is documented in the [product audit](research/product-audit.md), at revision `fef628e6918eb1d80938c48c9c6eba2463ae642a`. Architecture boundaries are in the [reference audit](research/reference-architecture.md); visual rules are in [DESIGN.md](DESIGN.md).

## Navigation recommendation

Use four labeled destinations: **Overview, Transactions, Plan, More**. Keep **Add** as a separate action. Each destination owns its navigation history, selected period, scroll position and active detail. Selecting an already active destination returns to its root only through a deliberate, documented interaction. Opening and closing Add returns to exactly the previous context.

| Destination  | Phone root                                                                                                    | Detail destinations                                                                                  | Expanded tablet behavior                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Overview     | One daily summary, account strip, upcoming obligation, recent activity; hierarchy depends on selected concept | Account detail, relevant transactions, insight detail, period review                                 | Summary region plus useful account/activity detail; avoid filling available space with every chart |
| Transactions | Grouped ledger, search, compact filters, selected period                                                      | Transaction detail/edit, reconciliation, selection actions, receipt, contextual account/category/tag | Persistent list and detail; keyboard selection; amount columns aligned without hiding labels       |
| Plan         | Budget status and category list; links to bills, goals and debt                                               | Allocation, budget category, bill/subscription, goal, loan, planning tools                           | Category or obligation list alongside its detail and history                                       |
| More         | Accounts, Analysis, Progress, Reports, Import, planning tools, organization, settings                         | Their focused routes; Settings includes storage, identity, app subscription and data controls        | Navigation rail/sidebar and focused content; optionally a second detail pane                       |
| Add action   | Expense/income amount entry, with explicit transfer/deduction path                                            | Account/category/date, optional details, final review as needed                                      | Anchored sheet or focused composer; opening it does not destroy current list selection             |

Accounts remains reachable from Overview and More. Analysis remains reachable from Overview insights and More. This gives frequent entry and review a small navigation model without losing advanced work. If account management proves to be the dominant daily job, replacing Plan with Accounts is an alternative requiring a recorded IA decision; concept C alone does not make that change.

Three composition studies are pending: **A: budget-led**, **B: ledger-led**, **C: account-led**. They test Overview hierarchy within the same proposed navigation and retained Observatory/Dawn identity. They are not three separate products. Detailed functional wireframes and interaction testing follow recorded approval of V01 (composition), D04 (V1 scope) and V05 (first detailed review slice), and cover only that approved slice.

```text
Overview
  Accounts -> account detail -> filtered transactions
  Upcoming -> bill detail
  Insight -> analysis detail
Transactions
  Search / filters / selection
  Transaction -> edit / receipt
Plan
  Budgets -> category -> allocation / rollover
  Bills and subscriptions -> detail / detected-charge review
  Goals -> detail
  Loans -> detail
More
  Accounts / Analysis / Progress / Reports / Import
  Planning tools -> Portfolio / Housing / Retirement / Calculators
  Organize -> Categories / Counterparties / Tags and rules
  Settings -> Appearance / Preferences / Profiles / Storage and backups
           -> Account and security / Token Circles subscription / About
Add [action, not a destination]
```

The space/profile switcher sits in the destination header, never inside an amount field. A combined household view states which profiles are included. Add always targets one explicitly named profile; aggregated views cannot silently choose a write destination. Deep links to a missing, deleted or unauthorized record show a recoverable route, not a blank shell. Tablet arrangements respond to available width, including split-screen; rotated phones do not inherit a desktop sidebar automatically.

## Feature parity inventory

This covers every current route and the principal account, data and security flows found in the source audit. Each row must later acquire an implementation issue and test evidence before being marked delivered. “Core candidate” is the recommended V1 inclusion, pending owner approval. “Parity decision” means explicitly include in V1 or name a subsequent parity phase; it does not imply the existing feature is unimportant. “Foundation” gates any dependent feature. “New decision” identifies capability absent from the audited implementation.

Reusable data means existing contracts, validations or calculations, not permission to import desktop components or global state. Browser-bound helpers must be separated from presentation and runtime access before reuse.

| Current feature / source                                                                                | Proposed phone surface                                                                                               | Proposed tablet surface                                   | Reusable data and behavior                                                                       | Scope status                                                     |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Dashboard and period selection; `router.tsx:11`, Worker dashboard/analytics routes                      | Overview, period sheet, contextual drill-down                                                                        | Overview with selected detail                             | Summary queries, periods, currency formatting after removing global coupling                     | Core candidate                                                   |
| Transaction list/search/filter; `features/Transactions.tsx`                                             | Transactions root; search and filter sheet                                                                           | List/detail with persistent search                        | Transaction queries and filter semantics                                                         | Core candidate                                                   |
| Expense/income entry; `components/GuidedOrbit.tsx:27–45`                                                | Add composer, detail editor                                                                                          | Composer over list/detail                                 | `shared/transactionInvariant.ts`, decimal parsing, defaults                                      | Core candidate                                                   |
| Transfers and deductions; `types/models.ts:18–20`, `shared/transactionInvariant.ts:1–67`                | Explicit type picker; source/destination for transfer                                                                | Focused editor with affected balances                     | Existing four-type invariant and API contracts                                                   | Core candidate; do not silently omit types                       |
| Reconciliation and bulk category/type/tag/delete; `Transactions.tsx:308–390,514–515`                    | Detail action and deliberate multi-select mode                                                                       | Keyboard/touch multi-select with summary                  | Existing mutations, partial-failure reconciliation                                               | Core candidate for reconcile; bulk scope decision                |
| Notes, tags, counterparties and receipt association; transaction models/routes                          | Optional details below essential amount fields                                                                       | Detail inspector                                          | Same transaction fields and ownership rules                                                      | Core candidate                                                   |
| Accounts and balance history; `features/Accounts.tsx`, Worker accounts routes                           | Account list/detail, edit, adjustment                                                                                | Account list plus history/detail                          | Account types, balances, currency and route contracts                                            | Core candidate                                                   |
| Category budgets and zero-based allocation; `Budgets.tsx:31,126–159`                                    | Plan root; allocation editor                                                                                         | Category list plus allocation/history                     | Budget and zero-based summary endpoints                                                          | Core candidate                                                   |
| Rollover, copy prior month, derive from expenses, historical backfill; `Budgets.tsx:223–297`            | Budget actions with period/scope preview                                                                             | Batch review next to impacted categories                  | Existing budget mutations; explicit destructive scope                                            | Core candidate for rollover/copy; backfill parity decision       |
| Budget forecast/improvement suggestions; `Budgets.tsx:132–134,216`                                      | Budget insight detail                                                                                                | History/projection detail                                 | Existing responses; distinguish actual and forecast                                              | Parity decision                                                  |
| Bills and recurring merchant subscriptions; `features/Bills.tsx`, `BillCalendar.tsx`                    | Upcoming list, calendar alternative, bill detail                                                                     | Calendar/list with selected obligation                    | Bills routes, schedule/form validation                                                           | Core candidate                                                   |
| Detected merchant subscriptions; `subscriptionDetection.ts:7–18`                                        | Evidence review, accept/edit/dismiss                                                                                 | Candidate list and evidence detail                        | Detection logic after separating brand icon imports                                              | Parity decision; no provider cancellation claim                  |
| Savings goals; Worker savings-goals route                                                               | Plan -> Goals -> progress/detail                                                                                     | Goal list plus detail                                     | Existing goal CRUD and progress contracts                                                        | Core candidate                                                   |
| Loans; Worker loans route, `features/Loans.tsx`                                                         | Plan -> Loans -> terms/schedule/detail                                                                               | Loan list plus schedule                                   | Existing loan calculations and mutations                                                         | Parity decision                                                  |
| Analytics; `router.tsx:27`, `features/Analytics.tsx`                                                    | More -> Analysis; focused chart per question                                                                         | Selected analysis with comparison region                  | Aggregates and series, existing period semantics                                                 | Core candidate for basic spending; full parity decision          |
| Progress, milestones, reviews and advice; `router.tsx:17`, `core/achievements/`                         | More -> Progress and Overview review link                                                                            | Progress detail with history                              | Pure evaluation/advice calculations                                                              | Parity decision; deterministic, not AI advice                    |
| Portfolio; `router.tsx:29`, `features/Portfolio.tsx`                                                    | More -> Planning tools -> Portfolio                                                                                  | Holdings/list with selected detail                        | Current portfolio contracts/calculations                                                         | Parity decision; no brokerage integration inferred               |
| Housing; `router.tsx:26`, `features/Housing.tsx`                                                        | Planning tools -> Housing                                                                                            | Inputs plus result/detail                                 | Existing housing model and operations                                                            | Parity decision                                                  |
| Retirement; `router.tsx:25`, `shared/retirement.ts`                                                     | Planning tools -> Retirement, focused inputs/results                                                                 | Inputs and comparison results                             | Shared retirement calculation already extracted                                                  | Parity decision                                                  |
| Rent versus buy; `router.tsx:18`                                                                        | Calculator input steps and results                                                                                   | Inputs beside comparison                                  | Extract current pure math from view where necessary                                              | Parity decision                                                  |
| Compound growth; `router.tsx:19`                                                                        | Calculator input steps and result                                                                                    | Inputs beside projection                                  | Current calculator math, assumptions                                                             | Parity decision                                                  |
| Emergency fund; `router.tsx:20`                                                                         | Calculator input steps and result                                                                                    | Inputs beside runway/result                               | Current calculation and expense context                                                          | Parity decision                                                  |
| CSV/XLSX and bank-file imports; `imports.ts:157–160,221–237`, `shared/bankImport/registry.ts:8–29`      | More -> Import; file picker, mapping, preview, resolve, commit                                                       | Mapping/rows alongside validation detail                  | Shared bank registry, parsing, mapping and deduplication                                         | Core candidate; large-file limits tested                         |
| Google Sheet import and connected sources; `imports.ts:280–334`, `features/import/ConnectedSources.tsx` | Import -> Sources -> source detail                                                                                   | Source list plus mapping/run history                      | Existing sheet/import/scheduled source contracts                                                 | Parity decision; no bank-login access implied                    |
| Email imports and automation; Worker import-email/import-sync modules                                   | Import -> Sources; configuration/status                                                                              | Source list/detail                                        | Existing managed ingestion and tier checks                                                       | Parity decision                                                  |
| Receipts as file attachment; Worker receipts routes; local receipt handler                              | Transaction -> Receipt; preview and attach source                                                                    | Receipt beside transaction detail                         | MIME/size/count rules, R2 or local bytes                                                         | Core candidate; native capture adapter is new work               |
| Basic reports and advanced tax/P&L reports; Worker reports route                                        | More -> Reports -> options -> preview/share                                                                          | Report options and preview                                | Existing report data and PDF generation seams                                                    | Core candidate for basic export; advanced report parity decision |
| Selected-resource CSV/JSON export; `exports.ts:34–39`                                                   | Data export with scope summary, save/share                                                                           | Scope selection and preview                               | Existing export schema/selection rules                                                           | Core candidate                                                   |
| Full backup/restore; `exports.ts:115–160`, storage factory migration                                    | Settings -> Storage and backups                                                                                      | Restore review with profile/file summary                  | Existing backup schema and validation; full-account restore semantics                            | Core candidate; native file persistence is new                   |
| Categories; `router.tsx:23`                                                                             | Organize -> Categories; contextual create                                                                            | List and detail/rules                                     | Category model and CRUD                                                                          | Core candidate                                                   |
| Counterparties; `router.tsx:28`                                                                         | Organize -> Counterparties; contextual picker                                                                        | List and detail                                           | Existing matching/entity rules                                                                   | Core candidate for selection; full management parity decision    |
| Tags and rules; `router.tsx:30`, `shared/tagRules.ts`                                                   | Organize -> Tags and rules                                                                                           | List/rule editor                                          | Shared rules and server application                                                              | Core candidate for tags; rule editor parity decision             |
| Profiles and combined household views; `profile.ts:31–83`                                               | Header switcher; Settings -> Profiles                                                                                | Same switcher and persistent context                      | Ownership, profile limits, aggregation headers                                                   | Core candidate; no invitations or roles                          |
| Local-first storage; `storageFactory.ts:20–109`, IDB v12                                                | Start locally; storage status and backup                                                                             | Same data with expanded views                             | Existing local handlers/migrations behind native adapter decision                                | Foundation                                                       |
| Managed cloud and self-hosted Worker; storage factory/API                                               | Storage choice; endpoint connection for self-host                                                                    | Same setup and connection diagnostics                     | Worker/API contracts; reviewed native session/transport                                          | Foundation; self-host V1 availability decision                   |
| One-off mode migration; `storageFactory.ts:119–148`                                                     | Explicit migration preview and confirmation                                                                          | Full scope/verification summary                           | Export/import migration semantics                                                                | Core candidate if mode switching ships                           |
| Password, Google, email codes; Worker auth/email-code routes                                            | Native entry and approved provider buttons; system-browser continuation for password/email-code ceremonies under D11 | Compact entry with the same approved browser continuation | Validation, identity resolution, rate limits; native transport and browser-to-app completion new | Foundation; provider selection and D11 UX decision               |
| TOTP and recovery; Worker twofa routes                                                                  | Challenge/setup/recovery, secure code handling                                                                       | Same focused security flow                                | Existing second-factor requirements                                                              | Foundation whenever an enrolled account signs in                 |
| Passkeys; Worker passkeys route                                                                         | Sign-in entry with system-browser continuation under D11; direct native support requires a separate proven adapter   | Same approved continuation                                | Existing web credentials; native associations/ceremony new                                       | Decision; existing users need a supported access path            |
| Apple sign-in                                                                                           | Native Apple sign-in and account linking                                                                             | Same focused flow                                         | Reuse reviewed provider architecture, not existing TC route                                      | New decision/dependency if selected                              |
| Password reset, verification, sessions/revocation; auth/account UI                                      | Account and security; cold/warm app links                                                                            | Security list/detail                                      | Existing endpoint intent; new deep-link/session adapter                                          | Foundation                                                       |
| Token Circles subscription/upgrade; Worker billing routes                                               | Settings -> Token Circles subscription; contextual upgrade                                                           | Plan comparison and billing detail                        | Existing plans/Stripe state; store entitlement ledger new                                        | Commercial decision; existing paid-user recognition required     |
| API/MCP tokens; `features/ApiAccess.tsx`, Worker apitoken                                               | Settings -> API access, secure one-time reveal                                                                       | Token list and scopes                                     | Existing token routes and tier limits                                                            | Parity decision; not a native sign-in mechanism                  |
| Appearance/currency/preferences; `features/Settings.tsx`                                                | Settings subsections                                                                                                 | Settings list/detail                                      | Preference values with runtime persistence adapter                                               | Core candidate                                                   |
| Sign out, local reset and account deletion; account route                                               | Clearly separate settings actions                                                                                    | Same focused confirmations                                | Existing deletion/removal semantics; provider cleanup extended                                   | Foundation                                                       |
| Not-found; `router.tsx:31`                                                                              | Recoverable missing route/record screen                                                                              | Detail placeholder plus working navigation                | Error classification                                                                             | Foundation                                                       |
| Widgets, native push, biometric app lock, OCR, cloud offline edit queue                                 | No shipping UI until individually approved                                                                           | Same                                                      | No complete implementation found in audit                                                        | New decisions, not inherited parity                              |

Paths abbreviated in this table resolve under `frontend/src/` or `worker/src/routes/` as named. Exact source evidence and caveats remain in the audit. No split-transaction, live bank connection, partner-sharing or investment-trading capability is inferred from similarly named interfaces.

## Surface flows and acceptance checklists

These checkboxes are specifications to satisfy during implementation. They remain unchecked until real native evidence is attached.

### S01 Welcome, storage choice and onboarding

Welcome gives a concise product promise and a clear path to begin locally, alongside sign-in for existing cloud users. Show storage explanations before commitment: **On this device**, **Token Circles cloud**, **My own server**. Implementation names such as `serverless` and `selfhost` are not user-facing labels. Starting locally requires no account. Ask only enough to make the first useful record: locale/currency, space/profile and account; optional import follows. Demo data must be clearly identified and removable; whether the native app starts empty or offers a separate demo is a decision, since the current web local mode can seed demo data.

Cloud onboarding starts from the native entry, uses the approved provider adapter or D11 system-browser continuation, resolves the existing account and profiles, and restores relevant preferences before proposing new ones. Password, email-code, captcha, passkey and recovery ceremonies use the browser in the proposed first secure slice; direct native forms require separate approval and equivalent security evidence. A browser's IndexedDB does not automatically become the app's local data. A local-to-cloud switch is an explicit migration/import with scope and collision handling, not a synchronization toggle. Self-hosting asks for the endpoint only in its dedicated path, checks supported API capabilities and secure connectivity, and explains who operates that server. Endpoint credentials and another server's session cannot be reused across hosts.

- [ ] A new local user reaches an empty useful Overview and creates an account/transaction without sign-in or purchase.
- [ ] Existing cloud users reach their actual profiles without duplicate onboarding data or automatic account linking by email alone.
- [ ] First-run, reinstall, restored app backup and existing web-user states each have a defined path.
- [ ] Changing storage shows source, destination, affected profiles, backup advice and a verified success/failure result; no automatic destructive restore.
- [ ] Self-host V1 availability, endpoint policy and remote version compatibility are recorded before enabling the entry point.
- [ ] Onboarding can be skipped where safe and resumed without blocking ordinary use; account/currency defaults remain editable.

### S02 Authentication and account security

Use the MercuryPitch provider integration as a reference, while preserving Token Circles' session and second-factor guarantees. Provider success is an intermediate state until the Worker verifies identity and any required TOTP challenge. Email code requests remain bound to the initiating authentication ceremony. Passkey native origin/RP association is separate from drawing a passkey button. The app must handle cancellation, expired challenges, revoked sessions, rate limits and unavailable providers without losing a pending transaction draft.

Follow [D11 and the session decisions](decisions.md) and the [authentication plan](authentication.md) when designing these screens. The first secure slice proposes a native entry plus system-browser continuation for existing email/captcha/passkey/recovery flows, returning a single-use app-bound code. Mockups must show that transition and return path rather than imply those browser ceremonies already have native forms.

- [ ] Approved provider buttons invoke the correct native ceremony; server-issued identity is authoritative.
- [ ] Existing Google/password/email-code accounts resolve consistently; Apple private-relay and account linking have explicit tested rules.
- [ ] Enrolled TOTP users cannot bypass the factor through another sign-in method; recovery-code single-use behavior survives retries.
- [ ] Native session storage, expiration/renewal and revocation have an approved security design; web-cookie CORS/CSRF protection is preserved.
- [ ] Reset/verification links work on cold and warm starts, reject expired/replayed or wrong-account requests, and return to a safe route.
- [ ] Security settings expose current and other sessions, factor management and sign-out; sensitive values never enter analytics or logs.

### S03 Overview, period and context

Answer “What needs my attention?” with the selected A/B/C hierarchy, visible period, meaningful totals and one next action. Do not display an invented health score. Totals keep their currency and aggregation semantics; a combined profile view names its scope. A summary card opens the underlying records with matching filters. Charts include a textual summary and an accessible alternative.

- [ ] Every displayed total can be traced to its source period/profile/currency; estimates are distinguished from recorded amounts.
- [ ] Genuine empty state, no results for a chosen period and network failure have different messages/actions.
- [ ] Navigation into an account/budget/transaction preserves the originating context and back position.
- [ ] Overview remains useful with only one account and one transaction, at maximum supported text size, and in both themes.

### S04 Transactions and Add

Add opens at the amount with expense as a proposed default, a visible type control and current profile/account. The next essential choices are category and account; date and payee remain immediately reachable. Notes, tags and receipt attach belong in optional detail. Editing uses the same domain validation but preserves original fields and identity. A transfer has source, destination and its currency treatment explicitly shown. Deductions retain their existing semantics instead of being silently converted to expense.

The ledger groups by date, aligns numbers, exposes reconciliation state and offers search/filter without an always-expanded toolbar. Swipes may accelerate actions but every action also has a visible accessible alternative. Multi-select is deliberate; bulk destructive changes show count and scope. A timed-out save does not promise failure when the server may have committed it: reconcile the response or refresh before inviting a blind retry.

- [ ] Income, expense, transfer and deduction survive create/edit/export round trips with correct sign and balance effects.
- [ ] Comma/dot decimals, locale formatting, currency precision, large values and date boundaries are validated; the web Guided Orbit's two-decimal limit is not copied blindly.
- [ ] Keyboard does not obscure amount validation or Save; focus advances predictably and returns on sheet dismissal.
- [ ] Failed validation/save preserves input; double-tap, app backgrounding and ambiguous network completion do not silently duplicate a record.
- [ ] Filtered results, account drill-down and household context show the right profile; Add names its single write target.
- [ ] Reconciliation/bulk edits refresh affected totals; partial failure accurately reconciles the selection and changed rows.
- [ ] Edit/delete has a clear outcome and a safe confirmation/undo policy appropriate to the actual backend behavior; do not promise undo without support.

### S05 Accounts and transfers

Account details combine current balance, account currency and history with a filtered ledger. Preserve current account types: giro, savings, investment (`ib`) and cash; mobile labels may be friendlier without changing stored identifiers. Separate editing account metadata, making a balance adjustment and recording a transfer. Selection pickers display enough context to prevent choosing the wrong similarly named account.

- [ ] Account creation/edit and supported delete behavior match the API and explain dependent records before changes.
- [ ] Transfers cannot choose the same source and destination; resulting balances reconcile with the current contract.
- [ ] Base-currency summaries never relabel original account currency, and estimated conversion rates are marked.
- [ ] Empty history and loading history remain distinct; tablet selection does not jump after refresh.

### S06 Budgets and zero-based planning

Plan opens with the month, allocated/spent/available amounts and category list. Category detail explains what contributes to the amount and links to the corresponding ledger. Allocation uses focused numeric entry and an explicit amount remaining to assign. Overspending and unassigned money need clear words, not only red/green rings. Rollover and copying a prior month are scoped actions. Historical backfill gets a stronger preview because current behavior can overwrite budgets across a range.

- [ ] Category totals and zero-based remainder reconcile with the same backend/local rules used by web.
- [ ] Rollover clearly identifies prior-period contribution and handles disabled/missing prior budgets.
- [ ] Copy/derive/backfill actions state exact month/range and replacement behavior before mutation.
- [ ] Forecasts are labeled projections with available assumptions; missing forecast data does not erase valid actual balances.
- [ ] Overspent, fully allocated, partly allocated, no-income and no-budget states have purpose-built content.

### S07 Bills and merchant subscriptions

Bills means obligations recorded by the user. Merchant subscriptions means recurring charges such as a streaming service detected from transaction evidence or entered manually. **Token Circles subscription** always refers to app access and lives in Settings. Use those full labels where ambiguity is possible. Merchant detection is a review suggestion; show evidence, amount/frequency and a way to correct it. Never imply that removing a tracked bill cancels a merchant contract.

- [ ] Upcoming, overdue, paid and edited schedules reflect existing model semantics, dates and recurrence rules.
- [ ] Bill actions disclose whether a payment transaction is created, linked or only marked in the bill model, based on the actual endpoint used.
- [ ] Detected subscriptions require review and handle false positives/changed amounts without fabricating provider connectivity.
- [ ] Calendar and list expose the same obligations; reminders accurately say email unless native notification work is approved and delivered.

### S08 Analysis and Progress

Analysis starts with a small set of questions, such as spending by category and change over time. Each question gets a focused screen with period/comparison controls, a chart, useful written values and record drill-down. Progress, reviews and milestones remain a separate route reachable from More and relevant Overview links. Reuse deterministic advice only with enough data; do not promise investment advice or an AI assistant.

- [ ] Chart totals match source transactions and retain profile/period/filter scope when drilling down.
- [ ] No-data, sparse-data, zero-income and negative-value scenarios remain intelligible.
- [ ] VoiceOver/TalkBack users can understand key values without exploring unlabeled geometry; color is supplementary.
- [ ] Projections and historical results are visually and verbally distinct, including static fallback exchange-rate estimates.
- [ ] Progress rules produce the same result in shared tests and mobile; avoid rewarding financial behavior through invented gamification.

### S09 Imports and connected sources

Use a sequential flow: choose source/file, recognize format, choose destination account/profile, map unresolved columns, preview, resolve warnings/duplicates, confirm, show result. A phone shows the row with a problem and its reason; a tablet can show rows and detail together. Preserve original row numbers where available. A user can return to mapping without losing the picked file. Bank adapters parse statements; they are not bank-account connections. Current managed file limit is 10 MB for CSV/XLSX, separate from full restore's 128 MB maximum; native memory constraints may require a lower reviewed limit, never a silent truncation.

- [ ] Representative files for the approved bank formats and generic CSV/XLSX preserve decimal/date/sign/currency interpretation.
- [ ] Duplicates, unknown accounts, malformed rows, formula-like content and unsupported formats have explicit outcomes before commit.
- [ ] Cancellation or process interruption before commit imports nothing; after ambiguous completion the app checks results before replay.
- [ ] Import results give accepted/skipped/failed counts and a path to affected transactions with the correct scope.
- [ ] Files are read through a narrow native capability; temporary copies and permissions are cleaned up according to policy.
- [ ] If connected/email/scheduled sources ship, their credentials, health, authorization and tier states have independent surfaces; file-import success does not imply automation success.

### S10 Receipts and camera

From a transaction choose Take photo, Choose photo or Choose file according to available platform capabilities. Request permission at that action. Preview/crop/rotate/compress only if implemented and accepted; do not invent those controls in a final production screen. Current Worker accepts JPEG, PNG, GIF, WEBP and PDF, not HEIC; camera output needs deliberate normalization. One current managed receipt per transaction is replaced on another upload. Managed limits are plan-dependent; local attachment storage behaves differently and must not be mislabeled as the same paid feature. No OCR exists in the audited source.

- [ ] Camera/library/file denial and limited access offer a working alternative without repeated permission prompts.
- [ ] Normalized uploads satisfy MIME, size and count limits; oversized files show an actionable explanation before upload where possible.
- [ ] Replacing an attachment clearly names the existing receipt; failed replacement does not falsely show the new image as saved.
- [ ] Local receipt and cloud receipt persistence are separately tested across restart, export and restore.
- [ ] Share/preview uses temporary files safely; failed upload/retry does not leak orphan files or cross profile ownership.

### S11 Goals, loans, portfolio and calculators

Goals and loans are reachable from Plan. Portfolio, housing, retirement, rent-versus-buy, compound growth and emergency fund live under Planning tools in More, with contextual links where useful. Each tool separates inputs from results on a phone, while a tablet can present both. Preserve each tool's actual inputs, persisted model and calculations; don't unify unrelated models merely because they share a chart. Test extracted math before rebuilding presentation.

- [ ] Each approved tool has a field/units/defaults/validation inventory from its current source and parity fixtures for typical and boundary inputs.
- [ ] Assumptions such as return, inflation, growth, interest or duration are visible wherever present; results cannot be mistaken for guaranteed outcomes.
- [ ] Goal/loan/portfolio mutations refresh the relevant accounts or summaries according to existing relationships.
- [ ] Long schedules are readable and performant; chart/table alternatives remain available on compact screens.
- [ ] Tools not approved for V1 are absent from shipping navigation and marketing, with an explicit later-parity decision retained here.

### S12 Reports, exports and backups

Reports show report type, profile(s), period and format before generation; output gets a native preview and Save/Share. A selected-resource export is distinct from a full restorable account backup. Current complete backups cover the whole account even when ordinary exports can select profile scope. Restore replaces data across profiles and requires a full impact summary and validated file before final confirmation. Missing receipt files are disclosed; a JSON success response alone does not prove a restorable complete backup.

- [ ] CSV/JSON/PDF output preserves supported Unicode, locale-independent machine values, dates and profile selection; generated PDFs are visually inspected.
- [ ] Advanced reports honor authoritative entitlements and distinguish unavailable, denied and generation failure.
- [ ] Backup scope and receipt completeness are displayed; backup/restore is tested with multiple profiles and local/cloud variants.
- [ ] Invalid/oversized/partial backup fails before destructive replacement, and restoration progress/outcome survives interrupted UI where the backend supports it.
- [ ] Save/Share cancellation is not reported as data loss or an application error; temporary documents are cleared safely.

### S13 Profiles and organization

Use “profile” consistently in settings and “space” only if the approved copy system defines the relationship. Profiles belong to one account. Combined household views aggregate selected owned profiles. There is no current invite/member/role system. Category, counterparty and tag management uses focused lists and forms reachable both from More and relevant pickers.

- [ ] Profile switch refreshes data without briefly showing another profile's financial information.
- [ ] Combined views name their membership, and mutations resolve one explicit profile or are unavailable.
- [ ] Profile creation handles authoritative caps and concurrent changes; deleting/renaming explains relevant impact.
- [ ] Organization edits invalidate affected pickers, transactions, rules and totals consistently.
- [ ] No partner invitation or sharing permission appears until a separate ownership/collaboration model is approved and implemented.

### S14 Settings, app subscription and deletion

Settings groups Appearance, Preferences, Storage and backups, Profiles, Account and security, Token Circles subscription, API access if approved, and About/legal. Show storage mode and server identity in a place users can find later. App billing recognizes an existing Stripe entitlement before offering a new store purchase. Management opens the appropriate provider; a restore operation does not create a new charge. Region/provider-dependent purchase UI is specified by the commercial decision, not inferred from the user's device language.

Sign out, erase this device's local data and permanently delete the cloud account are different actions. Before cloud deletion offer export, explain affected profiles and receipts, and show subscription cancellation information for the current provider. Deletion must remain available even if the person declines to retain a subscription or buy again. A forgotten account cannot be resurrected through a late purchase event without an explicit approved policy.

- [ ] Appearance respects system mode/override and both palettes; settings survive expected restart/storage transitions.
- [ ] Subscription screen shows authoritative source/tier/status/renewal, including unknown/loading/offline, and prevents accidental duplicate subscriptions.
- [ ] Restore, cancellation, expired entitlement, grace/hold, refund and purchase-account mismatch have reviewed UX and tests when stores are enabled.
- [ ] Sign out clears the correct native secrets/caches; the local-data retention choice is explicit and cannot expose a previous user's data to another sign-in.
- [ ] Local erase and full account deletion have accurate scope, confirmation, failure/retry and final states; provider revocation and store billing guidance are included.
- [ ] About exposes support, privacy, license/notices and version/environment information without revealing internal credentials.

## Required state matrix

Every implemented surface records which states apply; marking a state not applicable requires a reason. Happy-path screenshots alone are insufficient acceptance evidence.

| State                                | Required treatment                                                                           | Critical surfaces / verification                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| First load                           | Stable layout and accessible progress; no fake zero balances                                 | Overview, ledger, budget, entitlement; slow launch/network                                     |
| Refresh with existing data           | Preserve readable values and position; show refresh/staleness without claiming up-to-date    | All data roots; pull-to-refresh/resume                                                         |
| Empty dataset                        | Explain first useful action and correct scope                                                | New local profile, accounts, budgets, imports, goals                                           |
| Filtered empty                       | Show active filters and a clear/reset action; do not onboard again                           | Transactions, reports, analysis, periods                                                       |
| Local mode offline                   | Committed local edits remain usable; accurate backup status                                  | Restart after entry/import with network disabled                                               |
| Cloud/self-host offline              | Show connectivity and last verified state if caching is approved; retain unsaved form safely | No claim of automatic offline sync; approved read cache or honest unavailable state            |
| Saving/uploading                     | Disable duplicate submission, preserve context, announce progress                            | Add, allocations, receipt, import, restore                                                     |
| Ambiguous write completion           | Reconcile result before retry; keep draft and explain uncertainty                            | Network drops after request reaches Worker; no assumed idempotency                             |
| Validation error                     | Explain next action beside field, summary focus when needed                                  | Decimal/date/transfer/account/import/auth forms                                                |
| Read/server error                    | Retain safe existing content; retry in context with diagnostic reference if available        | 5xx/timeout/malformed response; no raw financial payload in logs                               |
| Partial success                      | Show affected/failed records and refresh authoritative state                                 | Bulk edits, exports with missing receipts, multi-step cleanup                                  |
| Authorization/entitlement            | Separate signed out, forbidden profile, paid feature denial and unknown entitlement          | 401/403/tier-specific response; no upgrade prompt for ordinary outage                          |
| Session expired/revoked              | Protect private views, preserve approved draft policy, return after successful auth          | App resume, remote sign-out, token expiry                                                      |
| Data changed/deleted elsewhere       | Explain missing record or conflict; do not silently overwrite stale form                     | Edit while another device changes data; use current API capability, add versioning if approved |
| Permission not requested             | Ask only when needed, with relevant purpose text                                             | Camera/photo/files; no launch permission wall                                                  |
| Permission denied/restricted/limited | Explain available alternatives and settings route when appropriate                           | Camera denied, limited photo selection, cancelled file provider                                |
| Keyboard and locale                  | Focused field and primary action stay reachable; locale-aware input; meaningful Next/Done    | Compact phones, comma decimals, hardware keyboard, safe-area inset                             |
| Large text and assistive tech        | Reflow; labels and order meaningful; no clipped amounts; chart summaries                     | VoiceOver/TalkBack, supported maximum text scale, switch/keyboard access                       |
| Reduced motion / appearance          | Suppress unnecessary motion; maintain contrast in both modes                                 | Onboarding art, charts, sheets, loading                                                        |
| App interruption/process loss        | Defined draft and operation recovery; don't imply ephemeral UI equals persisted data         | Camera return, auth callback, purchase callback, import, restore                               |
| Back/dismiss                         | Pop appropriate history or dismiss modal; unsaved-change handling explicit                   | iOS back gesture, Android system/predictive back, tablet modal                                 |
| Deep link mismatch                   | Validate host/path/state/account; safe fallback and useful expired-link copy                 | Verification/reset/auth/purchase returns, missing records                                      |
| Tablet resize/rotation               | Retain selected record and form state; shift between panes/routes naturally                  | Split-screen and external keyboard; no duplicated active editors                               |
| Storage pressure/migration failure   | Avoid partial loss; stop unsafe mutation, explain recovery and backup                        | Large receipt/import, IDB/native store migrations, file provider failure                       |

## Decision and handoff gate

- [ ] Record the selected A/B/C composition and whether the four-destination recommendation is accepted.
- [ ] Confirm each parity row's V1 or later status; do not equate scaffold completion with feature completion.
- [ ] Approve onboarding defaults, self-host availability, native local persistence and cloud-offline behavior.
- [ ] Approve authentication/session/provider/account-linking design before real credentials flow through the shell.
- [ ] Resolve entitlement drift and subscription-provider/region behavior before pricing UI is final.
- [ ] After V01, D04 and V05 approval, produce functional phone and tablet wireframes for the selected surfaces within S01–S14, including their applicable matrix states and focused prototypes where needed. Keep unapproved surfaces as parity proposals rather than expanding the detailed slice automatically.
- [ ] For each implementation slice, attach domain/API checks plus real native interaction evidence to its surface checklist; keep desktop regressions covered.
- [ ] Use the [release checklist](release-checklist.md) for binary, privacy, device, purchase and store readiness. No calendar estimates are required.
