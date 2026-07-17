# Onboarding Specification (Frontend)

**Module:** Onboarding (UI)
**Version:** 1.0
**Status:** Active
**Priority:** Should

## 1. Overview

The Onboarding module greets brand-new users with a guided, orbital-themed setup wizard: name your profile space, create at least one account, bring existing data through the app's real import flow, and adopt auto-detected subscriptions. It only auto-opens for pristine profiles and every step can be skipped, so it can never trap a user.

## 2. Functional Requirements

### 2.1. Trigger

- **REQ-ONB-001:** WHEN the app finishes bootstrapping an authenticated (or serverless) session AND the current profile has zero accounts AND zero transactions AND zero bills AND no completion/skip is recorded (locally or in the settings KV), THEN the system SHALL open the onboarding wizard.
- **REQ-ONB-002:** WHEN the user finishes or skips the wizard, THEN the system SHALL stamp `finance_onboarding` (`completed` / `skipped`) in localStorage AND mirror it into the profile's settings KV (`PUT /api/settings`), so logging in again — including from another device in server mode — SHALL NOT re-offer onboarding.
- **REQ-ONB-003:** WHEN the workspace already contains data (e.g. the serverless demo seed, or any account/transaction/bill), THEN the system SHALL NOT open the wizard.
- **REQ-ONB-004:** WHEN the user picks "Run the Setup Wizard" in the tour-selection modal OR "Run setup wizard" in Settings → About, THEN the system SHALL open the wizard regardless of the flag.
- **REQ-ONB-005:** WHEN the settings KV records a completion/skip that this device has not seen, THEN the system SHALL cache it into localStorage during the trigger check.

### 2.2. Steps

- **REQ-ONB-010 (Welcome):** The wizard SHALL present the app's premise and the setup outline, with a "Begin setup" primary action. In server mode it SHALL additionally offer a "Use local-only" switch that (after a confirm honest about any existing local workspace) suppresses the demo seed, clears the onboarding flag and server profile selection, flips storage to serverless, and relaunches setup.
- **REQ-ONB-011 (Your space):** The wizard SHALL offer renaming the default profile (creating one when none exists) and picking the base display currency.
- **REQ-ONB-012 (First account):** The wizard SHALL collect name, type, currency, opening balance, and optional tracking start date, SHALL allow creating multiple accounts, and SHALL list the created accounts.
- **REQ-ONB-013 (Bring your data):** The wizard SHALL embed the app's import flow (Google Sheets, file upload, paste CSV, bank statements) with the bank tab preselected; bank statements SHALL support in-place account creation via the account picker. A disabled "Coming soon" tile SHALL reference budgeting-app migration.
- **REQ-ONB-013a (Footer carries the import CTA):** On the import step the wizard footer SHALL surface the flow's true forward action per sub-step — mapping → "Continue to preview", preview → a live "Import selected (N)" (disabled at 0) — with a "Don't import" ghost escape beside "Skip setup", and Back SHALL walk the import sub-steps in reverse before leaving the step. The embedded mapping/preview components SHALL hide their in-body action rows (`embedded` prop); the standalone Import page keeps them. After a successful import the footer reverts to "Continue", and "Import more files" accumulates batch totals into one session summary.
- **REQ-ONB-014 (Subscriptions):** WHEN the step opens, THEN the system SHALL scan the profile's recent transactions against the subscription catalogue/brand registry and SHALL propose matches with detected price and cadence, each editable (amount, period) and individually selectable before batch-adding as `type: 'subscription'` bills.
- **REQ-ONB-015 (Done):** The wizard SHALL summarize what was set up and land the user on the dashboard.

### 2.3. Skipping and safety

- **REQ-ONB-020:** Every step SHALL be skippable; skipping the account or import step (and leaving the wizard entirely, including via Escape) SHALL require an "are you sure" confirmation.
- **REQ-ONB-021:** IF any pristine-check request fails, THEN the system SHALL NOT open the wizard (a broken bootstrap must not trap the user).

### 2.4. Subscription detection

- **REQ-ONB-030:** Matching SHALL be token-based with a bounded typo budget; bare mega-retailer tokens (e.g. `amazon`, `google`, `apple`) SHALL only produce proposals when the charge repeats with a stable amount.
- **REQ-ONB-031:** Cadence SHALL be inferred from the median gap between charges (weekly / biweekly / monthly / yearly, defaulting to monthly), and the proposed price SHALL follow the most recent recurring amount.
- **REQ-ONB-032:** Identities already tracked as bills/subscriptions SHALL be marked "Already tracked" and excluded from batch-add.
- **REQ-ONB-033:** Detection SHALL also be reachable outside onboarding: Bills → Subscriptions → "Scan transactions", and the Import page's post-import prompt.

## 3. Visual requirements

- **REQ-ONB-040:** The wizard SHALL render in the orbital theme: night-sky ground, animated dotted orbit rings with drifting token satellites behind a glass panel, and a fill-as-you-go progress orbit ring.
- **REQ-ONB-041:** All continuous animation SHALL be disabled under `prefers-reduced-motion: reduce`.
- **REQ-ONB-042:** The overlay SHALL respect both themes (dark "Orbital Observatory" and light "Dawn").

## 4. E2E coverage

Implemented in `frontend/tests/onboarding.spec.ts` (zero-state boots via `gotoServerlessZeroState`, which suppresses the demo seed) and `frontend/tests/import.spec.ts` (refactored import flow + inline account creation). The core path is tagged `@smoke` and gates PRs.
