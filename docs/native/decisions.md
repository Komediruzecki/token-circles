# Native program decision register

An unchecked item is a proposal or missing input. A recommendation is not an approval. Record the answer, any scope limit, and supporting evidence beside the ID before implementing dependent behavior.

## Confirmed

- [x] C01: iOS and Android via Capacitor in the Token Circles monorepo, using the existing frontend/backend stack.
- [x] C02: Keep the visual identity; redesign every mobile flow. Confirmed in this planning conversation.
- [x] C03: EU/EEA and United States are the first launch markets. Confirmed in this planning conversation.
- [x] C04: Personal Apple developer account with existing apps and Google Play organization account with DUNS exist. No new-account/tester-count workstream.
- [x] C05: Reference applications are read-only research sources. Use their patterns selectively.
- [x] C06: No timelines or deadline calculations. Work progresses by accepted phases.
- [x] C07: Use the available built-in ChatGPT image generator; its exact model version is unverified. Confirmed in this planning conversation.
- [x] C08: Work on a dedicated Token Circles branch. Current branch: `feat/native-app-plan-and-design`.

## Before scaffold and first feature slice

| ID  | Decision to confirm                                      | Recommendation                                                                                                                                                            | Consequence / gate                                                                                      |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D01 | Native presentation boundary                             | Independent `packages/mobile` Solid app; Capacitor supplies native integrations; no desktop root-App or page CSS import                                                   | Approves architecture for Phase 2; does not imply SwiftUI/Compose rendering                             |
| D02 | Native package names and durable application identifiers | Package `@token-circles/mobile`; confirm iOS bundle ID, Android application ID and deep-link domains/schemes against existing account ownership                           | Platform projects and auth provider config cannot safely invent published identifiers                   |
| D03 | Minimum iOS and Android versions                         | Evaluate iOS 16 and Android 10/API 29 as first candidates, compared with Capacitor 8's lower supported floor; use dependency/device evidence to decide                    | Avoid inheriting Chaos Master's GPU-driven iOS 26 requirement; signing/build SDK is a separate question |
| D04 | First V1 feature contract                                | Full daily finance loop plus approved cloud/auth/entitlements; approve each remaining feature in the parity matrix                                                        | Determines actual V1 rather than promising complete desktop parity accidentally                         |
| D05 | Meaning of offline support                               | Complete local mode with explicit backup/import; cloud failures and last-known state are explicit, offline cloud writes require a separate sync project                   | Determines storage engine and truthful onboarding copy                                                  |
| D06 | Native local database                                    | Start with a measured Capacitor WebView IndexedDB feasibility/upgrade/backup spike; compare SQLite if durability/size/background requirements fail                        | No blanket claim that either browser IDB or a SQLite plugin is already production-qualified             |
| D07 | Native sign-in and transport                             | Capgo social-login adapter with Worker-verifiable identity; short-lived native sessions and a Keychain/Keystore token-store port                                          | Approves a dedicated auth implementation and tests; secure storage plugin selected after audit/spike    |
| D08 | Apple/Google identity linking and existing users         | Provider+subject identities; explicit linking after reauthentication; preserve existing email/password and web sessions                                                   | Prevents email-match account takeover and duplicate account creation; migration required                |
| D09 | Native self-hosted mode                                  | Retain as explicit advanced mode if supported and tested; HTTPS endpoint trust confirmation and separate account/session state per origin                                 | Must settle V1 scope, trust model, certificate/CORS requirements and store behavior                     |
| D10 | Local data migration                                     | Explicit backup/import or reviewed upload; user sees record counts/conflicts; never infer cloud ID ownership from local IDs                                               | Blocks seamless-switch claims and destructive migration shortcuts                                       |
| D11 | Native email, captcha, passkeys and recovery UI          | First secure slice uses system-browser continuation for existing web ceremonies, returning a single-use app-bound code; direct native forms can follow a dedicated design | An informed UX/security choice, not full native presentation of every auth step in the first slice      |
| D12 | Native session lifetime                                  | Evaluate 10-minute access, 30-day refresh inactivity and 90-day absolute session lifetime, with server revocation                                                         | Proposed policy in authentication.md; approve usability/security balance before implementing constants  |
| D13 | Lost refresh response / replay handling                  | Strict refresh-token rotation and reuse detection; a lost rotation response can require signing in again                                                                  | Approve this recovery behavior or design a bounded idempotent rotation policy with its own threat model |

## Before native purchase implementation

| ID  | Decision to confirm                                   | Recommendation                                                                                                                               | Consequence / gate                                                                                                |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| B01 | Initial payment channels                              | Existing Stripe on web; native IAP for new mobile purchases, recognizing all valid existing entitlements                                     | Least fragmented initial product; owner may choose a consumption-only launch or regional alternative after review |
| B02 | Subscription entitlement service                      | Compare RevenueCat against direct App Store/Google verification with actual monitored revenue; choose after workbook review                  | SDK, webhooks, operational ownership and recurring service cost                                                   |
| B03 | Mobile price parity                                   | Use current EUR prices as modeling inputs; select equal consumer price, margin-preserving prices or tier simplification deliberately         | Store price tiers/taxes/localized USD prices are not yet configured; no automatic app-store surcharge             |
| B04 | Apple Small Business enrollment / associated accounts | Verify actual eligibility and enrollment; show standard-fee sensitivity until proven                                                         | Determines whether 15% is applicable; existing personal account alone does not establish eligibility              |
| B05 | EU agreements and non-EU EEA distribution             | Prefer baseline native purchases first; inspect accepted addenda and effective date before enabling external offers                          | EU is not identical to EEA; Apple October 1 changes and Play regional programs need separate routing              |
| B06 | US alternative billing or external offers             | Evaluate after first reliable IAP funnel and full net-cost/reporting comparison                                                              | Do not assume permanent zero platform commission or exempt Play transactions                                      |
| B07 | Tax and actual prices                                 | Confirm live Stripe Price currency, tax_behavior, tax registrations, fees/contract, checkout total and native storefront tiers               | Catalogue amounts do not prove whether customer pays EUR 3 or EUR 3 plus tax                                      |
| B08 | Real business inputs                                  | Supply paid subscribers by tier/channel/country, monthly vs annual mix, refunds, support/operations cost, acquisition cost and tax treatment | Needed for actual profit; current model is scenario/contribution analysis                                         |
| B09 | Free and paid feature contract                        | Reconcile code/catalogue for cloud access, local receipts and billing-state fallback before adding enforcement                               | Avoid silently removing existing local capabilities or selling unenforced exclusivity                             |
| B10 | Multiple subscriptions and provider changes           | Show current provider/expiry; block misleading duplicate CTA; never cancel another provider silently                                         | Requires restore, user identity and customer-support policy                                                       |
| B11 | Purchase account requirement                          | Require sign-in for managed cloud purchases unless a fully designed anonymous-purchase recovery flow is approved                             | Defines app-account mapping, restore across devices and account-deletion behavior                                 |
| B12 | Receipt storage and compression budget                | Measure retained bytes per account and native photo sizes; set limits/compression consistent with published promises                         | Per-profile maximums can exceed plan revenue at saturation; approve policy before expanding camera capture        |

## Before detailed visual implementation

- [ ] V01: Select A / Daily orbit, B / Daily ledger, C / Account perspective, or an explicit combination. Recommendation: A overview with B transaction list and tablet detail structure. Awaiting answer to the concept review.
- [ ] V02: Approve four primary destinations — Overview, Transactions, Plan, More — and separate Add transaction action. Confirm whether Accounts merits a permanent tab instead of living under Overview/More.
- [ ] V03: Approve system UI font for operating screens with existing Fraunces on welcome/editorial moments; Inter remains a comparison option.
- [ ] V04: Approve device-following appearance with explicit theme override, giving Dawn and Observatory equal QA coverage.
- [ ] V05: Approve first gallery implementation slice and which advanced surfaces need detailed mockups before V1 scope is fixed.
- [ ] V06: Decide whether to integrate the final standalone gallery into `disjoint-colliders/packages/showcase-gallery` using a separate scoped branch. The initial review artifact stays with Token Circles and the reference repo remains untouched.
- [ ] V07: Approve original art treatment and production-asset needs after composition selection. All UI text/icons/values remain semantic code or source SVGs.

## Before store submission

- [ ] R01: Review AGPL/source-distribution and all third-party licenses against actual store distribution terms and contributor rights; record any needed permissions or licensing changes.
- [ ] R02: Confirm actual native account deletion, Apple revocation, purchase management and data-retention policies across billing providers.
- [ ] R03: Confirm privacy labels, Play Data safety, export compliance, EU trader information, age rating and permission rationale against the exact build.
- [ ] R04: Approve exact screenshots/listing text from the working native app, review credentials and privacy/support links.
- [ ] R05: Recheck Apple/Google effective policies and account addenda at submission; refresh workbook fee inputs when they changed.
- [ ] R06: Explicitly approve opening a PR when desired. This planning request authorizes the task branch and scoped push, not opening a PR.
- [ ] R07: Explicitly approve the concrete release binaries and publication after all checks. Do not infer production deployment permission from scaffold approval.

## How to answer

Reply with IDs and choices, for example: `D01 approved; D03 compare iOS16/Android10 in the spike; B01 native IAP baseline; V01 A+B`. Unanswered choices stay open; a recommendation never becomes approval merely because time passes.
