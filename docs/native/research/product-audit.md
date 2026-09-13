# Token Circles native planning: product and code audit

Research date: 2026-09-13. Source revision: `fef628e6918eb1d80938c48c9c6eba2463ae642a`. Repository: `/home/maff/.codex/worktrees/0dac/token-circles`.

This is a read-only source audit for planning. It does not certify production configuration, current Stripe account prices, deployment health, or App Store policy compliance. No credentials, customer data, production databases, or private billing records were accessed. No runtime files were changed and no application tests were run for this research document. Line references below refer to the source revision above; relative paths resolve from the repository root unless explicitly absolute.

## Findings that should shape the plan

1. **Retain SolidJS, TypeScript, Vite, and the existing Cloudflare Worker.** There is already substantial reusable finance logic and a local-data implementation. A new mobile presentation application can use the same business contracts without embedding the desktop shell.
2. **Native authentication is a real integration phase.** Token Circles deliberately differs from MercuryPitch: its ordinary app API accepts an HttpOnly cookie, not a bearer access token. Web Google redirects, challenge cookies, passkeys, and seven-day sessions all need deliberate native treatment.
3. **Local-first does not currently mean offline cloud synchronization.** There are two storage modes with a one-off migration between them. Managed mode fetches the API directly; the PWA excludes API requests from its asset cache. No general offline mutation queue or cloud conflict protocol was found in the audited paths.
4. **Households are multiple profiles belonging to one account.** They are not a multi-user sharing/invitation feature. Native designs should show switching and combined views without implying partner invitations or shared account ownership.
5. **Current displayed prices are EUR 3 / 6 / 10 monthly and EUR 30 / 60 / 100 annually.** Historical field names say USD. Treat live billing configuration, tax inclusion, store-specific prices, and merchant fees as inputs to the economics model, not facts obtainable from the display catalogue.
6. **There is entitlement drift to resolve before the native paywall.** Free is marketed as local-only, but no `cloudSync` enforcement use was found, and local receipt handlers store files without a paid check. Preserve existing users' access until the intended behavior is decided and implemented explicitly.
7. **The brand already has a coherent foundation.** Deep indigo, azure, one warm dawn accent, orbital forms, editorial serif headings, and clear numerical instruments provide a strong starting point. Reuse this visual language, not desktop layout or CSS.
8. **Older planning records are valuable but often superseded.** Most historical product planning is under `/home/maff/.dotfiles/personal/finance`, while `personal/tokencircles` primarily contains operational scripts and PR archives. Several older claims contradict today's code.

## What the product actually is

The README describes an open-source personal-finance manager that runs without an account in IndexedDB, against a user's own Worker, or against managed cloud. Core jobs cover transactions, accounts, category and zero-based budgets, bills/subscriptions, savings goals, debt, investments, analytics, long-range planning, and exports. The cloud service still carries a beta description in the repository; this is a source/documentation fact, not a judgment about the user's statement that the product is finished.

Evidence: `README.md:9–21`, `README.md:34–50`, `AGENTS.md:5–30`.

The historical positioning proposal emphasizes seeing where money goes without surrendering bank login credentials or signing up. It explicitly distinguishes the mood line, “Your money, in clear orbit,” from a concrete product description. That proposal is useful design context, but the source labels it “Recommended,” so it should not be treated as a newly approved native marketing message.

Evidence: `/home/maff/.dotfiles/personal/finance/marketing/positioning-and-soundbites.md:80–115`.

### Current feature inventory and mobile interpretation

| Existing capability                                                                      | Source evidence                                                                                                                                          | Mobile design implication / recommendation                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard and period summaries                                                           | `frontend/src/router.tsx:11`; `worker/src/routes/dashboard.ts`; `worker/src/routes/analytics.ts`                                                         | One calm overview with immediately useful balances, upcoming obligations, and a route into details. Do not shrink a dashboard grid onto a phone.                                                                                                                                    |
| Transactions, income/expense/transfers/deductions, tags, notes, receipts, reconciliation | `frontend/src/types/models.ts:18–20,53–77`; `frontend/src/router.tsx:12`                                                                                 | Searchable grouped list, detail route, compact filter sheet, explicit transfer source/destination, reliable edit feedback. Preserve all four transaction types in the domain even if quick entry initially presents fewer.                                                          |
| Quick entry and touch-guided entry                                                       | `frontend/src/components/GuidedOrbit.tsx:1–7,27–45,76–85,117–135`                                                                                        | Reuse the intent and defaults: amount, category, account, date, confirmation. Rebuild keyboard handling, entry sheet and focus behavior. Current Guided Orbit only offers expense/income and hard-limits two decimals; do not infer complete currency/transaction coverage from it. |
| Accounts and balance history                                                             | `README.md:37`; `frontend/src/types/models.ts:20`; `worker/src/routes/accounts.ts`                                                                       | Account list/detail, obvious current currency and balance, adjustments separated from ordinary transactions. Existing types are giro, savings, investment (`ib`), and cash.                                                                                                         |
| Category budgets, rollover and zero-based budgets                                        | `README.md:38`; `worker/src/routes/budgets.ts`                                                                                                           | A budget overview with drill-down, understandable available/spent states, and a focused allocation flow.                                                                                                                                                                            |
| Bills and detected subscriptions                                                         | `frontend/src/router.tsx:16`; `frontend/src/features/subscriptionDetection.ts:1–18,40–65`                                                                | Upcoming list/calendar, mark-paid action and a “review detected charges” flow. Detection proposes subscriptions from transaction evidence; it does not cancel providers or connect to their billing accounts.                                                                       |
| Savings goals and debt                                                                   | `frontend/src/router.tsx:14–15`; `worker/src/routes/savings-goals.ts`; `worker/src/routes/loans.ts`                                                      | Goal progress/detail and debt schedule detail; keep financial assumptions visible where they change a projection.                                                                                                                                                                   |
| Progress, milestones, reviews and advice                                                 | `frontend/src/router.tsx:17`; `frontend/src/core/achievements/evaluate.ts:1–35`; `frontend/src/core/achievements/advice.ts:1–35`                         | A worthwhile separate progress destination or section. Existing advice is deterministic and computed from the user's data on-device; do not label it an AI adviser.                                                                                                                 |
| Portfolio, housing, retirement, rent-vs-buy, compound growth, emergency fund             | `frontend/src/router.tsx:18–20,25–29`; `shared/retirement.ts:1–25`                                                                                       | Secondary planning destinations, with phone inputs on focused routes and tablet split views. Include them in the parity inventory even if V1 delivery is phased.                                                                                                                    |
| Categories, counterparties, tags and rules                                               | `frontend/src/router.tsx:23,28,30`; `shared/tagRules.ts`; `worker/src/tag-rules.ts`                                                                      | Management routes behind contextual links/settings, not a tab for each desktop page.                                                                                                                                                                                                |
| Bank/file/Google Sheet imports                                                           | `README.md:36`; `worker/src/routes/imports.ts:221–237,280–334`; `shared/bankImport/registry.ts:8–29`                                                     | Native file picker plus a legible review/resolve/confirm sequence; retain deduplication and validation. Large mapping tables need phone-specific flows.                                                                                                                             |
| PDF/CSV/JSON and complete backups                                                        | `README.md:42`; `worker/src/routes/exports.ts:34–39,115–156`; `frontend/src/core/storage/clientPdfReports.ts`                                            | Native document preview and share/save actions. A resource export and a full restorable backup must be clearly different actions.                                                                                                                                                   |
| Security/settings/subscription/device management                                         | `frontend/src/router.tsx:24`; `worker/src/routes/auth.ts`; `worker/src/routes/passkeys.ts`; `worker/src/routes/twofa.ts`; `worker/src/routes/billing.ts` | First-class native security and account surfaces, with provider-aware subscription management and account deletion.                                                                                                                                                                 |

The current route registry contains 21 named destinations including not-found (`frontend/src/router.tsx:10–31`, `frontend/src/types/models.ts:22–43`). It is a feature inventory, not a suitable phone navigation hierarchy.

## Current commercial catalogue

Authoritative source catalogue: `worker/src/plans.ts:43–135`; public delivery: `worker/src/routes/plans.ts:5–14`.

| Catalogue field                         | Free | Basic | Advanced |                  Ultimate |
| --------------------------------------- | ---: | ----: | -------: | ------------------------: |
| Displayed monthly price, EUR            |    0 |     3 |        6 |                        10 |
| Displayed annual price, EUR             |    0 |    30 |       60 |                       100 |
| Annual monthly equivalent, EUR, rounded |    0 |  2.50 |     5.00 |                      8.33 |
| Profiles                                |    2 |     5 |       10 |       Unlimited, fair use |
| Managed receipt files per profile       |    0 |   500 |    5,000 |       Unlimited, fair use |
| Max individual managed receipt, MB      |    0 |     5 |       25 |                        50 |
| Managed reminder emails per month       |    0 |   500 |    2,000 |       Unlimited, fair use |
| Live API tokens                         |    0 |     2 |       10 |       Unlimited, fair use |
| Managed cloud sync                      |   No |   Yes |      Yes |                       Yes |
| Managed email reminders                 |   No |   Yes |      Yes |                       Yes |
| Managed receipt storage                 |   No |   Yes |      Yes |                       Yes |
| Advanced tax/P&L reports                |   No |   Yes |      Yes |                       Yes |
| API/MCP access                          |   No |   Yes |      Yes |                       Yes |
| Automated imports                       |   No |    No |      Yes |                       Yes |
| Priority support                        |   No |    No |       No | Reply in 1–3 working days |

Annual prices equal ten monthly charges. For a 12-month period at unchanged prices this is a 16.67% discount relative to paying monthly. That arithmetic says nothing about renewal rate or profitability.

Important semantics:

- `monthlyPriceUsd` and `annualPriceUsd` are retained API field names; code comments explicitly state they represent EUR. Do not change the public response shape during mobile scaffolding. Evidence: `worker/src/plans.ts:34–38`.
- The source explicitly says displayed prices are display-only; Stripe Price configuration determines actual charges. Evidence: `worker/src/plans.ts:6–8`.
- OCR and end-to-end encryption are explicitly not built and excluded from plan marketing. Evidence: `worker/src/plans.ts:144–149`.
- `premium` resolves to Advanced for compatibility. Evidence: `worker/src/plans.ts:152–159`.
- Beta/fair-use/support wording is centralized. Evidence: `worker/src/plans.ts:137–142`.
- No subscriber counts, conversion, churn, payment-method mix, actual taxes, support costs, or production usage were inspected. All cost/profit tables must label those as user-entered inputs or scenarios, not observed business results.

### Catalogue versus enforcement

The catalogue's intent is not the same as a verified runtime gate. This distinction matters when translating paid features into App Store products:

| Area                             | Observed behavior                                                                                                                                                                                          | Planning consequence                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt upload to managed Worker | Paid feature enforced before R2 upload; MIME, size and profile count checked. `worker/src/routes/receipts.ts:50–82`; `worker/src/plan.ts:27–42,60–63`                                                      | Native camera/file attach should consume the same entitlement policy and server errors.                                                                                                  |
| Local receipt bytes              | Local handler writes `file_data` to IndexedDB with no plan check. `frontend/src/core/storage/handlers/receipts.ts:7–58`                                                                                    | Do not equate “receipt storage is paid” with local attachments being unavailable. Decide and document local versus managed value.                                                        |
| Client receipt/email controls    | Unknown/local/demo state fails open; locked only when plan is positively Free. `frontend/src/core/billingStore.ts:4–26`                                                                                    | Native cache should model unknown/loading/offline and authoritative denial separately.                                                                                                   |
| Profiles                         | Worker creation uses a conditional insert enforcing the count. `worker/src/routes/profiles.ts:44–76`                                                                                                       | The new creation flow must expose the active tier's cap and handle concurrent changes.                                                                                                   |
| Advanced reports/API             | Dedicated middleware exists. `worker/src/plan.ts:50–57,71–77`                                                                                                                                              | Reuse server entitlement checks rather than adding mobile-only trust.                                                                                                                    |
| Managed cloud sync               | The catalogue defines `cloudSync`; a source search found no consumption of that flag outside the catalogue. Ordinary `requireAuth` validates authentication, not a paid tier. `worker/src/auth.ts:343–359` | Before a local-only Free native claim or changed cloud behavior, confirm intended free-account behavior and audit all managed data entry points. No access change is made by this audit. |

The missing `cloudSync` call is an audit finding, not proof of a particular production customer's access. It should become an explicit product/implementation decision, with a regression test for the approved behavior.

### Existing Stripe lifecycle

The Worker integrates directly with Stripe REST using `fetch`, a pinned API version, and signature verification, rather than a Stripe SDK. Plan changes are webhook-authoritative. Evidence: `worker/src/routes/billing.ts:11–16,22–35,429–437`.

Checkout maps three tiers across monthly/annual Stripe Price IDs; legacy `STRIPE_PRICE_ID` maps to Advanced monthly (`worker/src/routes/billing.ts:82–118`). A first subscription returns a hosted Checkout URL. A tier/interval change can instead update the existing subscription and return `{ url: null, changed }`; a mobile billing abstraction must not assume every change is a redirect (`worker/src/routes/billing.ts:216–220,248–307`).

An existing subscription's item is replaced, rather than adding another item or subscription. This is an already-addressed double-billing concern which native billing must not reintroduce. Existing web plan state contains Stripe subscription identifiers and event ordering; it is not yet a provider-independent entitlement ledger (`worker/src/routes/billing.ts:248–259,475–504`).

`active`, `trialing`, and `past_due` entitle the account, while cancellation at period end remains separately visible. The API status returns plan, subscription status, renewal timestamp, interval, cancellation flag, Stripe configuration/available tiers, and email-verification requirement (`worker/src/routes/billing.ts:125–132,394–426`). Stripe webhooks include idempotency and ordering protection (`worker/src/routes/billing.ts:457–504`).

The current checkout sends `automatic_tax[enabled]=true`, required billing-address collection, and tax-ID collection. This supersedes older private notes saying automated tax was deferred. Source alone does not establish whether configured Prices are tax-inclusive or exclusive, or whether live Tax registrations are correct (`worker/src/routes/billing.ts:310–351`).

Native subscriptions therefore need an additive provider model: store transaction verification and notification handling, entitlement source and precedence, restoration, cross-device refresh, refund/revocation, grace/account hold, provider-aware management, duplicate-purchase prevention, and deletion semantics. These are recommendations for a later implementation phase, not existing features.

## Authentication and account architecture

### What exists

| Capability                        | Current implementation evidence                                                                                                     | Native implication                                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password                    | `frontend/src/core/api.ts:173–199`; `worker/src/routes/auth.ts:281–344`                                                             | Preserve validation, rate limits, neutral registration/reset behavior and captcha requirements; native form layout alone does not replace transport work.                                                |
| Google sign-in                    | Full-page navigation to `/api/auth/google/start`: `frontend/src/core/api.ts:163–170`; callback: `worker/src/routes/auth.ts:105–191` | Native provider plugin/server exchange needs its own reviewed flow. Reusing the URL inside a WebView does not establish cookie/session continuity.                                                       |
| Email sign-in code                | `worker/src/routes/email-code.ts:1–11,39–64`                                                                                        | Challenge is bound to the requesting browser with a signed cookie. Preserve equivalent ceremony binding in a native transport.                                                                           |
| TOTP/recovery                     | `worker/src/routes/twofa.ts:1–6,59–86`                                                                                              | Password/Google/email-code success cannot bypass an enrolled second factor. Setup invalidates older sessions; raw recovery codes appear once.                                                            |
| Passkeys                          | `worker/src/routes/passkeys.ts:1–11,46–50`; `frontend/src/core/webauthn.ts:127–157`                                                 | Existing credentials are scoped to the web RP origin/hostname. Native use needs correct platform associations and verified native origins; retain existing web passkeys.                                 |
| Password reset/email verification | `frontend/src/core/api.ts:202–230`; `worker/src/routes/auth.ts:458–467`                                                             | Universal/app links must route cold and warm starts to the right secure state, with expiration/error fallback.                                                                                           |
| Session/device revocation         | `worker/src/auth.ts:189–214,263–317`; `frontend/src/components/SignedInDevices.tsx`                                                 | Preserve per-device session identities and sign-out-everywhere behavior. Native device names should be human-readable.                                                                                   |
| Permanent account deletion        | `worker/src/routes/account.ts:59–83,92–147`                                                                                         | Existing production-capable flow removes account data and receipt objects and attempts Stripe cleanup. Store-billed accounts require additional provider-aware behavior and clear cancellation guidance. |
| Apple sign-in                     | No Apple auth route/provider implementation found in the audited source                                                             | Treat as new backend identity/provider work, not a configured frontend button.                                                                                                                           |

### Cookie/session boundary

`worker/src/auth.ts:1–14` explicitly records the choice to diverge from MercuryPitch's localStorage/bearer pattern for a finance app. `fm_session` is HttpOnly, Secure outside development, `SameSite=Lax`, optionally domain-scoped (`worker/src/auth.ts:134–146`). Its token is seven days long and not refreshed (`worker/src/auth.ts:22–27`). Verification checks the user, revocation version, and optional `auth_sessions` row (`worker/src/auth.ts:263–317`).

The common frontend HTTP client passes `credentials: 'include'` and a build-time API origin (`frontend/src/core/api.ts:15–18,50–75`; `frontend/src/core/apiFetch.ts:25,42–56`). The Worker allows one configured CORS origin with credentials (`worker/src/index.ts:88–91`). `APP_ORIGINS` expands permitted web return targets, but it is not currently used as a CORS allowlist (`worker/src/auth.ts:425–441`; `worker/src/index.ts:91`).

The only explicit CSRF references found under `worker/src` concern signed Google OAuth state (`worker/src/auth.ts:394–441`). A source scan did not find general mutation CSRF middleware or an explicit Origin-header validation helper. This is not a confirmed exploit finding. It means the native transport design must review browser-cookie and native-token requests separately and must not widen cookie CORS/CSRF behavior casually to make the app work.

Personal access tokens are intentionally restricted to `/mcp` and `/api/v1/*`, and deliberately independent of session `token_version` (`worker/src/apitoken.ts:4–9,74–79`). They are not an appropriate shortcut for first-party native sign-in: they carry a separate paid-access model, route allowlist, scopes and revocation semantics.

### Recommended extraction boundary

Keep identity verification and account resolution in the Worker. Add a native adapter only after deciding how a native session is issued, protected, renewed and revoked. Reuse provider-verification principles from MercuryPitch, but preserve the stronger guarantees of Token Circles and account linking consistency. Establish before implementation:

- Which providers ship in V1; what existing Google/password/passkey users see.
- Whether native sessions use a dedicated short-lived access token plus secure refresh credential, or a deliberately tested native cookie transport.
- How TOTP/email-code/passkey ceremonies are bound to native requests.
- How Apple private-relay email and Google email identities avoid accidental duplicate accounts or unsafe linking.
- How account deletion, native token revocation, existing web sessions and app reinstall behave.
- How the captcha requirement is satisfied in the approved native auth path rather than silently disabled.

## Storage, synchronization and profile semantics

### Existing seam

`frontend/src/core/apiFetch.ts:42–68` routes API-shaped requests to a lazy IndexedDB local router in `serverless` mode, or to real HTTP in `self-hosted` mode. The internal term `self-hosted` also covers managed cloud; it describes the adapter, not who operates the service. Native product copy should say “On this device,” “Token Circles cloud,” or the selected own-server address rather than surfacing internal names.

`frontend/src/core/storage/storageFactory.ts:20–109` stores the mode in localStorage, supports legacy `VITE_DEFAULT_STORAGE` values `dexie`/`sqlite`, and instantiates `IndexedDBAdapter` or `SelfHostedAdapter`. It contains a one-off export/switch/import migration with rollback of the selected mode on failure (`storageFactory.ts:119–148`). This is not ongoing bidirectional sync.

The underlying local database is named `finance-manager`, version 12 at the audited revision (`frontend/src/core/storage/idb.ts:32–33`). Schema upgrades preserve years of application-specific migrations. Native storage decisions must preserve the backup format and data invariants; renaming this database or rebuilding schemas in the scaffolding phase is unnecessary risk.

There is another transport path in `SelfHostedAdapter` with direct relative `/api/...` fetches (`storageFactory.ts:156–208`). Extracting only `ApiClient` is insufficient: inventory all HTTP/file/auth/report helpers and route them through a common injected transport before assuming native remote APIs work.

### Offline is a decision, not an inherited capability

The PWA caches a complete application asset build. Its default bypass includes `/api/`, and it never caches dynamic API requests (`packages/pwa-kit/src/sw-runtime.ts:254–290,502–517`; `frontend/src/sw.ts:1–11,51–67`). The managed `apiFetch` path directly fetches the network.

No general outbox, queued offline writes, replay identity, or conflict resolution system was found in the audited client/storage/transaction paths. Isolated idempotency for imports, recurring generation, or billing does not provide general offline transaction synchronization.

Recommended decision: separate three possible promises explicitly:

1. A local-only native workspace, independent from managed cloud.
2. An online cloud app with a clearly marked stale read cache and preserved unsaved drafts.
3. Fully offline cloud editing with an outbox, idempotent commands, conflict UI and replay semantics.

The third is significant domain work and should not arrive accidentally as “add SQLite.” Until approved, mocks can show a truthful connection state and local drafts; they should not claim completed synchronization or imply that a pending cloud write is saved remotely.

### Profiles and households

All profile data belongs to an authenticated user. Writes naming an invalid/unowned profile are rejected; reads can fall back to an owned default (`worker/src/profile.ts:31–55`). Household reads carry `X-Profile-Ids`, but the Worker selects only profiles owned by that same user (`worker/src/profile.ts:58–83`). The frontend distinguishes no profile scope, active write scope and household read scope (`frontend/src/core/apiProfileScope.ts:1–42`).

There is no audited membership/invitation/role table or route supporting multiple users collaborating on a household. “Share a household with your partner” would be a new feature promise. For V1, a profile picker can show Personal / Business / Household and an explicit combined view, but the write target must remain clear and stable across sheets and background responses.

The desktop shell uses global profile-version counters and keeps every visited page mounted (`frontend/src/App.tsx:162–174,207–219`; `frontend/src/core/appStore.ts:167–175`). Native navigation should use scoped resources and deliberate lifecycle/retention behavior. Reusing permanent hidden page trees on phones can retain stale requests and unnecessary chart memory.

## Imports, receipts, exports and data portability

Supported bank adapters include Revolut, Erste, PBZ, N26, Wise, ING, Sparkasse, DKB and YNAB (`shared/bankImport/registry.ts:8–29`). These are statement parsing adapters, not automatic bank-account connections. The Worker parses uploaded CSV/XLSX with a 10 MB cap and fetches Google Sheet CSV exports (`worker/src/routes/imports.ts:157–160,221–237,280–334`). Saved scheduled imports and email ingestion have separate server-side machinery (`worker/src/import-sync.ts`, `worker/src/import-email.ts`).

Native import should preserve bank detection, row validation, category/account resolution, transfer logic, deduplication and review before execution. The reusable engine exists under `shared/bankImport/` and the adjacent `shared/import*` files; file acquisition and review rendering should be mobile-specific. Do not put generic arbitrary PDF statement import in the V1 promise merely because receipt PDFs are accepted.

Managed receipt upload accepts JPEG, PNG, GIF, WebP and PDF, with per-plan limits (`worker/src/plan.ts:11–18`; `worker/src/routes/receipts.ts:54–82`). HEIC/HEIF is not in that allowlist. A native camera/gallery path must normalize supported output or clearly handle unsupported files before uploading. Receipt ownership and one-per-transaction replacement semantics are already enforced (`worker/src/routes/receipts.ts:85–114`). Receipt OCR is explicitly future work in the catalogue.

Full JSON backups cover the whole account even if the UI has selected only some profiles. Per-resource CSV/JSON exports can be selection-scoped. Restore replaces all existing profiles only after validated staging and the final D1 cutover (`worker/src/routes/exports.ts:115–150`). The restore route sets a 128 MB request-size guard (`exports.ts:151–160`). Missing receipt bytes can be reported with `X-Backup-Skipped-Receipts` (`exports.ts:138–145`). Native backup UI needs enough context for the user to understand completeness and replacement; a generic “Import” button is insufficient.

Recommendations for platform adapters: native file picker, camera capture, temporary-file lifecycle, document preview, share/save, supported MIME conversion, memory-aware large-file handling, and cancellation/retry states. Keep backup validation and restore semantics unchanged while adapting file transport.

## Reusable logic and boundaries

The existing `shared/` directory is already the correct home for framework-independent code used by Worker and browser. It is directly imported today rather than published as a workspace package. The native plan can introduce package entry points incrementally without copying or immediately moving all shared source.

| Candidate boundary                      | Evidence                                                                                                                                    | Extraction advice                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finance invariants and domain contracts | `shared/transactionInvariant.ts:1–67`; `frontend/src/types/models.ts:6–77`; `frontend/src/schemas/models.ts`                                | Expose pure domain/DTO entry points first. Preserve positive magnitudes plus separate transaction type, valid account IDs, and distinct transfer accounts. Do not introduce signed-amount drift.           |
| Bank-import domain                      | `shared/bankImport/registry.ts`; `shared/bankImport/process.ts`; `shared/importCsv.ts`; `shared/importMapping.ts`                           | Reuse directly; keep native files, browser File objects and UI mapping views in adapters.                                                                                                                  |
| Retirement/projections                  | `shared/retirement.ts:1–25`; `shared/retirementSettings.ts`; `frontend/src/core/loanCalculator.ts`                                          | Pure calculations should be single-source and tested identically across clients. The retirement module explicitly exists because older copies disagreed.                                                   |
| Decimal/money/currency                  | `frontend/src/core/decimalInput.ts:1–24`; `frontend/src/core/currency.ts:1–12,20–25,62–84`                                                  | Extract pure parsing/formatting around explicit base currency and locale inputs. Current currency helper imports the global API preference, so it is not fully detached. Preserve estimated-FX indication. |
| Achievements/advice                     | `frontend/src/core/achievements/evaluate.ts:1–35`; `frontend/src/core/achievements/advice.ts:1–35`                                          | Strong candidates: deterministic with explicit data/today inputs. Keep display composition and share-card rendering out of core logic.                                                                     |
| Subscription detection                  | `frontend/src/features/subscriptionDetection.ts:7–18`                                                                                       | Algorithm is described as pure but imports `subscriptionBrands.tsx`. Split brand-matching metadata from SVG components before exposing it as a headless engine.                                            |
| API transport/contracts                 | `frontend/src/core/api.ts:15–18,36–75,78–114`; `frontend/src/core/apiFetch.ts:42–68`; `frontend/src/core/storage/storageFactory.ts:156–208` | Inject origin, auth transport, profile scope and events. Current code depends on `import.meta.env`, `window`, localStorage, browser events and direct fetches. Do not merely re-export the module.         |
| Local storage engine                    | `frontend/src/core/storage/idb.ts`; `frontend/src/core/storage/localApiRouter.ts`; `frontend/src/core/storage/handlers/`                    | Reuse adapter contracts and tested financial handlers after decoupling singleton/global assumptions. Validate native persistence before selecting IndexedDB versus SQLite.                                 |
| Brand tokens                            | `frontend/src/core/brandPalette.ts:1–23`; `frontend/src/styles/themes/README.md:20–31`                                                      | Extract palette and semantic meaning. Author new native spacing, hierarchy, typography scales, surfaces and components.                                                                                    |
| Application state/navigation            | `frontend/src/core/appStore.ts:9–23`; `frontend/src/App.tsx:162–174`; `frontend/src/core/hashRoute.ts:22–44`                                | Desktop concerns such as sidebar, hash routing and global modal flags stay in web. Native uses its own tab/stack/sheet model and route adapters.                                                           |
| PDF/report rendering                    | `frontend/src/core/storage/clientPdfReports.ts`; `frontend/src/workers/chartWorker.ts`; `frontend/src/core/brandPalette.ts:28–33`           | Preserve report calculations/data models while isolating DOM/canvas/Worker/document-window dependencies and native sharing.                                                                                |

Avoid one enormous `app-core` package that exports everything under `frontend/src/core`. Several modules there are UI state, browser integration or side-effectful singletons. Dependency direction should be shared domain/contracts toward platform-neutral use cases, then separate web/native adapters and screens; never core importing native or desktop UI.

## Visual foundation

| Role               | Current value/intent                                                                    | Evidence                                                              |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Dark foundation    | `#0a0e1c` background, `#0e1430` secondary, `#131c39` surface                            | `frontend/src/styles/themes/orbit-dark.css:18–28`                     |
| Action             | Azure `#6e9bff`, hover `#93b4ff`, strong `#3b6fe0`                                      | `orbit-dark.css:52–56`                                                |
| Warm emphasis      | Dawn `#f0a860`, intended as one warm touch per view                                     | `orbit-dark.css:97–99`; `themes/README.md:27–28`                      |
| Ink                | `#eaf0ff` primary, `#9fb0d6` secondary on dark                                          | `orbit-dark.css:37–45`                                                |
| Money meaning      | Income `#7dffb0`, expense `#ff9d9d`, transfer `#93b4ff`; reserved for numbers           | `orbit-dark.css:65–68`                                                |
| Light theme        | “Dawn,” paper-blue daylight; PDF mirror uses `#f7f9ff` background and `#ffffff` surface | `themes/README.md:11–18`; `frontend/src/core/brandPalette.ts:117–131` |
| Category palette   | Azure, dawn, mint, rose, amber, cyan, violet, mist                                      | `frontend/src/core/brandPalette.ts:1–23`                              |
| Type               | Self-hosted Inter 400/500/600, Fraunces 600, JetBrains Mono 400/500, Latin/Latin-ext    | `frontend/src/styles/index.css:10–26`                                 |
| Type hierarchy     | Page h1/h2 in Fraunces; smaller headings/forms/tables stay in Inter                     | `frontend/src/styles/index.css:86–92`                                 |
| Analytical variant | Graphite instrument-deck scope for analytics/portfolio, not another global theme        | `frontend/src/styles/themes/README.md:16–18`                          |

Recommended native interpretation: restrained atmospheric image-led welcome/onboarding, crisp operational screens, an original mobile balance/progress composition, generous thumb targets, native-feeling sheets/stack transitions and tablet split views. Do not apply generated backgrounds under every financial table or use decorative gradients to encode gains/losses. Charts need value labels/accessible summaries beyond color.

Existing onboarding provides welcome, space, account, import, subscriptions and done steps. Its completion/skipping is stored locally and mirrored to profile settings so a new device does not repeat setup (`frontend/src/core/onboardingStore.ts:1–24,47–57,127–159`). Native onboarding must recognize existing users and pre-existing data rather than force a new-account sequence after every native installation.

## High-value native risk register

| Risk                                                | Why it matters here                                                                         | Required evidence before shipping                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Web-cookie assumptions fail in native               | HttpOnly Lax cookie, one CORS origin, web redirects/challenge cookies                       | Real iOS and Android sign-in, cold start, app restart, expiration, revocation and 2FA tests for the approved transport.               |
| Duplicate or missing entitlement across stores      | Existing model is Stripe-specific and has historical duplicate-subscription defenses        | Server verified purchases; Stripe + Apple + Play precedence, restore, refund, grace and duplicate-purchase cases.                     |
| User believes offline write synced                  | Current local-first modes are separate; no general cloud outbox                             | Approved offline promise plus explicit pending/stale/failed states and tested retries.                                                |
| Incorrect profile write after navigation            | Global active/household scope; historical ownership protections                             | Captured profile IDs per command, cross-profile rejection, late-response/profile-switch tests.                                        |
| Money meaning drifts in mobile                      | Amount magnitude/type, base-currency normalization, estimated FX, date-only/month semantics | Shared invariants and representative finance fixtures used by both clients.                                                           |
| Native photo is rejected or oversized               | HEIC absent; per-plan caps 5/25/50 MB                                                       | Camera/gallery permission flows, supported encoding, downsampling quality, size/error states.                                         |
| Large imports/backups exhaust WebView memory        | XLSX parsing and receipt-bearing JSON payloads can be large                                 | Representative low-memory device test, cancellation, file-size bounds and incomplete-backup handling.                                 |
| Native app hides existing capabilities              | Desktop has more than twenty destinations                                                   | Page parity inventory and explicit V1 omissions approved by the owner.                                                                |
| Native account deletion leaves store billing active | Existing delete only attempts Stripe customer cleanup                                       | Provider-aware deletion flow, external cancellation guidance where needed, server cleanup and user-visible outcome.                   |
| PWA update machinery is copied into native          | Existing assets/service-worker behavior is browser-deploy-specific                          | Packaged app starts without remote desktop shell or service-worker deployment assumptions.                                            |
| Sensitive finance data reaches logs                 | Current API validation path can log raw response data (`frontend/src/core/api.ts:123–128`)  | Native diagnostics redact transactions, receipts, credentials and identifiers before any remote telemetry.                            |
| Accessibility lost in visual polish                 | Dense finance information, diagrams, custom numeric input                                   | Screen-reader order, text scaling, reduce motion, contrast, touch targets, keyboard/tablet navigation and meaningful chart summaries. |

Push notifications, native local reminders, biometric privacy lock, home-screen widgets, share extensions, receipt OCR and native background sync were not found as existing Token Circles runtime features in this audit. Treat them as proposed scope decisions. Existing managed reminders are email-based (`worker/src/reminders.ts:18,212,294–298`; `worker/src/index.ts:214–219`).

## Repository and verification constraints

- `pnpm-workspace.yaml` includes `packages/*` and `frontend`. The Worker is installed separately with its own lockfile. `package.json` root `typecheck` checks PWA-kit and frontend; Worker typecheck is a separate CI job. Keep that distinction visible in the native scaffolding plan (`.github/workflows/ci.yml:33–40,61–81`).
- Audited manifests use SolidJS 1.9, Vite 8, TypeScript 5.7-compatible ranges, Hono 4, native IndexedDB `idb`, Zod 4, Chart.js/D3, self-hosted font packages and vendored SheetJS. These are current source declarations, not a recommendation to upgrade while scaffolding (`frontend/package.json`, `worker/package.json`).
- The only current package under `packages/` is PWA-kit; native packages can be added without relocating the existing frontend.
- New backend behavior belongs under `worker/`; merged D1 migrations are append-only. Check all existing table names before adding native session/purchase tables (`AGENTS.md:58–65`).
- No emojis in components, logs, commits or docs. Reuse SVG icon patterns (`AGENTS.md:75–76`).
- Existing CI tests the frontend and real Worker isolate/D1 migrations, with Playwright against the built frontend and local Worker. Native-specific checks should add to those gates, not weaken them (`.github/workflows/ci.yml:9–11,77–81`; `README.md:50`).

## Historical planning that must not override current source

| Historical record                                                        | Why it is useful                                         | Known superseded claims                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/maff/.dotfiles/personal/finance/pricing-plans.md`                 | Pricing intent, FOSS positioning, dated competitor study | USD presentation, Free email allowance, old reminder quotas, unwired per-tier prices and advanced-report gates. Current `worker/src/plans.ts` and billing code win.                                               |
| `/home/maff/.dotfiles/personal/finance/go-public-readiness-decisions.md` | Legal/launch decision history                            | Account deletion off in production and automatic tax off are contradicted by current `routes/account.ts:59–83` and `routes/billing.ts:329–337`; external compliance items require their own current verification. |
| `/home/maff/.dotfiles/personal/finance/rebrand-plan.md`                  | Why `finance-manager` names remain in resources/storage  | Its June “prod does not exist” statements are historical, not migration permission. Never recreate production resources based on them.                                                                            |
| `worker/src/routes/receipts.ts:16–20` and `worker/src/index.ts:151–154`  | Provenance of ported routes                              | Comments still describe missing R2/PDF/XLSX plumbing; current handlers implement R2 and parsing. Inspect implementation, not stale TODO prose.                                                                    |
| `worker/package.json` description                                        | Package identity                                         | “Preparation; not yet live” is stale metadata relative to the repository's stated architecture.                                                                                                                   |
| `docs/plans/billing-tiers.md`                                            | More recent tier rationale                               | Explicitly a shipped decision record; not a fresh task list. Re-verify any proposed change against current catalogue.                                                                                             |

## Owner decisions to add to the master checklist

- [ ] Approve the mobile V1 feature coverage and the phone/tablet navigation map; identify any feature that must be present at launch despite phased development.
- [ ] Decide whether V1 supports local-only, managed cloud, arbitrary self-hosted Worker endpoints, and/or true offline cloud editing. Each has separate onboarding, persistence and support implications.
- [ ] Resolve catalogue/runtime differences for Free cloud access and local receipt storage before defining native paid entitlements; preserve existing data access during any transition.
- [ ] Confirm native auth providers, account-linking behavior, passkey continuity and session/biometric-lock policy.
- [ ] Confirm store billing model after policy research, tax inclusion and geographic launch scope; keep store prices separate from the existing EUR web display catalogue.
- [ ] Approve whether “household” remains single-account profile aggregation for V1. Multi-user collaboration requires a separate feature plan.
- [ ] Approve retention of Orbital Observatory/Dawn, serif display moments and azure/dawn palette, with a newly designed native component system and dark/light verification.
- [ ] Decide native extras such as camera capture, local notifications, push, widgets, share extension and app lock individually; do not turn them all into assumed launch requirements.
- [ ] Confirm safe migration/export expectations for existing browser-only users installing the native app, since browser IndexedDB does not automatically become the app's local database.

These decisions are proposed planning questions. This audit implements none of them.
