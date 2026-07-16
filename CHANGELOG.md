# Changelog

New features and notable fixes in Token Circles, in plain language. The full
technical detail lives in [dev-changelog.md](dev-changelog.md).

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.6.1] — 2026-07-17

### Fixed

- The subscription scan works on hosted accounts again. Scanning your transactions (from Bills, the importer, or the setup wizard) always came back with "no subscriptions found" when signed in to tokencircles.com, even with plenty of recurring charges — it now detects them as intended.

## [5.6.0] — 2026-07-16

### Added

- Guided onboarding. New accounts are welcomed into a short, skippable setup wizard in the app's orbital style: name your space, create your first account, bring your history (bank statements, CSV, or Google Sheets), and adopt the subscriptions we spot for you — then land on your dashboard. Re-run it any time from Settings → About.
- Subscription detection. When you import transactions, Token Circles now recognizes recurring charges from Netflix, Spotify, Claude and 40+ other services — with the price and billing period worked out for you — and offers to track them as subscriptions. Also available from Bills → Subscriptions → "Scan transactions".
- In-place account creation during a bank import: assign each statement to a new account without leaving the importer, so a multi-bank import sets everything up in one pass.
- Branded emails. Your welcome, password-reset, and (on paid plans) budget-alert, spending-report, and upcoming-bills emails now arrive in a polished Token Circles design with a subtle animated orbit, in your own currency, with one-click unsubscribe. Signing up with Google now gets a welcome email too.
- An orbital loading animation replaces the plain "Loading…" screen.

### Changed

- The import preview is cleaner: your stats and the Import buttons sit together up top, with a compact "fill budgets from spending" option below.
- Re-importing a file you've already imported now says so plainly ("everything here was already imported") instead of a confusing "Imported 0" — duplicates are always detected and skipped, so you can safely re-import.
- The sign-in form now flags an invalid email address as you type and explains when the verification step is still loading.

### Fixed

- The Category Allocation and Portfolio orbit charts render correctly again for every number of categories (they could look like a broken ring before).
- Dragging in a larger bank statement no longer occasionally does nothing on the first try.
- Sharper app icon, and no more brief flash of the wrong theme while the app loads.

## [5.5.0] — 2026-07-15

### Added

- Shareable demo links: open a sample profile straight from a link (`?demo=high`, `?demo=mid`, or `?demo=low`) to explore the app with example data.

### Changed

- The app's fonts are now served by Token Circles itself instead of loading from Google — pages render a little faster, work offline, and make no third-party requests.

### Fixed

- No more blank screen after an update. When a new version ships, the app now updates itself cleanly instead of occasionally getting stuck on a white page: it recovers from an out-of-date cache, quietly reloads onto the new version, and — if something still can't load — shows a clear "Reload / Reset app cache" screen instead of nothing. You no longer need to hard-refresh or clear your browser data.

## [5.4.0] — 2026-07-15

### Changed

- Redesigned Settings: a single-column layout with a compact icon sidebar and clearer grouping — General, Exports, Billing, and a new About tab (version, changelog, shortcuts, support, and logs).
- Refreshed buttons across the app to match the Token Circles look, with softer delete buttons that are easier on the eyes.

## [5.3.7] — 2026-07

### Added

- Keyboard shortcuts: press `?` for a guide, or `Ctrl`/`Cmd`+`K` to open the command bar.
- Bank import: pick a worldwide (English) category mapping alongside the Croatian one.

### Changed

- Tidier dashboard — a compact "Views" button, a two-row header, and a one-row period selector (Today, Week, Month, Quarter, Year, and 7/30/90-day ranges).
- Upcoming Bills and the Bills calendar show each bill's real brand or category icon; the Analytics spending heatmap is larger and clearer.
- Premium features (receipts, email alerts) are clearly marked on the free plan instead of failing silently.

### Fixed

- Mobile polish across charts, the bank-import table, and dialogs — no more sideways scrolling on phones.
- Budgets: changing a category's amount works again, and stays editable afterwards.
- Re-running a bank import no longer creates duplicate transactions.
- Sign-in autofill works again on Android and in password managers.
- The Apple subscription icon is visible in dark mode again.

## [5.2.0] — 2026-07-01

### Changed

- Money shows in your selected currency across PDF reports and the dashboard, including currencies with no decimals such as JPY.

### Fixed

- Account balances update reliably and can no longer be left half-applied.

### Security

- Custom reports are now private to your account; sign-in, imports, and cross-origin requests were hardened.

## [5.1.0] — 2026-06-27

### Added

- Delete your account and all of its data from Settings.
- Optional bot protection (Turnstile) on the sign-in and password forms.

### Fixed

- The billing page shows your real plan instead of always reading "Free".
- Spending-report emails are sent once per period, never duplicated.

## [5.0.0] — 2026-06-27

### Added

- Accounts and cloud sync — sign in with Google or email to sync across devices, or keep using the app with no account.
- Plans and billing — Free, Basic, Advanced, and Ultimate tiers.
- Email reminders — budget alerts and a periodic spending report.
- Contact support from within the app.

## [4.0.0] — 2026-05-11

### Added

- Portfolio tracker with live prices and an allocation chart.
- Counterparties — see who owes whom from your transactions.
- Automatic account-balance updates, transfers between accounts, and bulk editing.

## [3.0.0] — 2026-04-01

### Added

- Works offline in your browser, with multiple profiles and demo data.
- Zero-based budgeting, a spending heatmap, an income/expense flow diagram, and PDF reports.
- Receipts, tags, recurring transactions, the Quick Add box, dark and light themes, and an installable app.

## [2.0.0] — 2026-03-15

### Added

- Planning tools — savings goals and loan, housing, retirement, compound-interest, emergency-fund, and rent-vs-buy calculators.
- Bank statement import (CSV and Excel) with column mapping.

## [1.0.0] — 2026-03-01

### Added

- First release — transactions, categories, accounts, a dashboard, budgeting, analytics, and data export.
