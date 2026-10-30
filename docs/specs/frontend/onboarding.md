# Onboarding Specification (Frontend)

**Module:** Onboarding (UI)
**Version:** 1.1
**Status:** Active
**Priority:** Should

## 1. Overview

The Onboarding module greets brand-new users with a guided, orbital-themed setup wizard in three counted steps: name the profile's space, add a main account, and bring in one bank statement, read with the app's own import flow, with the subscriptions that statement shows offered after the import. It only auto-opens for pristine profiles and every step can be skipped, so it can never trap a user.

## 2. Functional Requirements

### 2.1. Trigger

- **REQ-ONB-001:** WHEN the app finishes bootstrapping an authenticated (or serverless) session AND the current profile has zero accounts AND zero transactions AND zero bills AND no completion/skip is recorded (locally or in the settings KV), THEN the system SHALL open the onboarding wizard.
- **REQ-ONB-002:** WHEN the user finishes or skips the wizard, THEN the system SHALL stamp the decision (`completed` / `skipped`) in localStorage under its owner, `finance_onboarding:account-<id>` for a signed-in account or `finance_onboarding:local` in local-first (`core/onboardingFlag.ts`), AND mirror it into the profile's settings KV (`PUT /api/settings`), so logging in again — including from another device in server mode — SHALL NOT re-offer onboarding to that account, and another account on the same browser SHALL be offered its own. The older browser-wide `finance_onboarding` key SHALL move to the local account only; in server mode the settings KV and the pristine check decide. Specs mark the wizard decided with `onboardingDecided` (`frontend/tests/onboarding-decided.ts`).
- **REQ-ONB-003:** WHEN the workspace already contains data (e.g. the serverless demo seed, or any account/transaction/bill), THEN the system SHALL NOT open the wizard.
- **REQ-ONB-004:** WHEN the user picks "Run setup again" in the tour-selection modal OR "Run setup wizard" in Settings → About, THEN the system SHALL open the wizard regardless of the flag.
- **REQ-ONB-005:** WHEN the settings KV records a completion/skip that this device has not seen, THEN the system SHALL cache it into localStorage during the trigger check.

### 2.2. Steps

Three counted steps, Space, Account and Statement, then Done. The header carries Back (the logo on the first screen), "Step N of 3" in an orbit ring, and Close. The footer is one row: Skip on the optional steps, and the primary action filling the rest.

- **REQ-ONB-010 (Your space):** The wizard SHALL open on the space's name and base currency, under "Welcome to Token Circles", renaming the default profile or creating one when none exists. In server mode it SHALL also offer keeping the data in this browser only, which (after a confirm honest about any existing local workspace) suppresses the demo seed, clears the onboarding flag and server profile selection, flips storage to serverless, and relaunches setup.
- **REQ-ONB-011 (About this space):** WHILE the benchmarks gate shows (`benchmarksShown()`), the space step SHALL have a second screen that asks who the space covers and where it is (`SpaceQuestions`, compact).
- **REQ-ONB-012 (Your main account):** The wizard SHALL collect name, type, currency and opening balance; Enter in a field SHALL add the account, as the footer's Add account does, and adding one SHALL move on to the statement. Back on the step, it SHALL list the profile's accounts ("Your accounts") and allow adding another.
- **REQ-ONB-013 (Bring in a statement):** The wizard SHALL take one bank statement file and read it with the app's import flow (`importFlow.ts`), using the bank's own columns. It SHALL show the file, the bank, the account it goes to (the account the bank names, else the one just created, else a new one named for the bank), how many transactions are new and the categories it adds, with one "Import N" action. A statement whose transactions are all stored SHALL say so. A file it cannot import SHALL offer "Open in Import", which finishes setup and opens the Import page with that file (`importHandoff.ts`), or going on without it.
- **REQ-ONB-014 (Subscriptions):** WHEN an import on the statement step brought transactions in, THEN the wizard SHALL scan the profile's transactions against the subscription catalogue/brand registry and SHALL propose matches with detected price and cadence, each editable (amount, period) and individually selectable before batch-adding as `type: 'subscription'` bills. With no import, the wizard SHALL go from the statement to Done.
- **REQ-ONB-015 (Done):** The wizard SHALL summarize what was set up in one line (accounts, new transactions, tracked subscriptions), list Getting started's next steps, and land the user on the dashboard.
- **REQ-ONB-016 (Badges):** Badges unlocked while the wizard is open SHALL be announced when it closes, not over it.

### 2.3. Skipping and safety

- **REQ-ONB-020:** Every step SHALL be skippable. Close and Escape SHALL ask once before leaving the wizard, naming what is left ("Leave setup" / "Stay"). A step's Skip SHALL ask only when it would drop what was typed or chosen: an account with a name or balance typed in, a statement ready to import.
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

Implemented in `frontend/tests/onboarding.spec.ts` (zero-state boots via `gotoServerlessZeroState`, which suppresses the demo seed; the core path, a statement imported in one tap, and a file the defaults cannot read are tagged `@smoke` and gate PRs; on a touch screen, every step at 390x844, 375x667 and 320x568 in both themes), `frontend/tests/onboarding-server.spec.ts` (the record on the account), `frontend/tests/onboarding-form-errors.spec.ts` and `frontend/tests/onboarding-page-behind.spec.ts`.
