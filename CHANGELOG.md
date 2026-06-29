# Changelog

All notable changes to Finance Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Transactions page crash caused by `createMemo` TDZ reference in SolidJS
- Missing `swagger-ui-express` and `mime-types` backend dependencies

### Changed

- Improved public repo readiness: CODE_OF_CONDUCT, CONTRIBUTING, issue/PR templates
- Cleaned docs/ directory structure with organized specs, postmortems, and archive
- Replaced internal todo.md with public ROADMAP.md
- Added `.env.example` with documented environment variables

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
