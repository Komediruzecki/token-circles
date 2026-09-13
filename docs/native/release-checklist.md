# Token Circles native release checklist

Planning snapshot: 2026-09-13. Every unchecked item is future evidence or a decision, not a claim that a binary is ready. This checklist has acceptance gates, not schedule estimates. Apply it to the exact shipping commit, dependency lockfiles, native configuration and intended storefronts. Related documents: [product](PRODUCT.md), [surface plan](surface-plan.md), [source audit](research/product-audit.md), [reference architecture](research/reference-architecture.md), and [commercial research](research/subscriptions-and-economics.md).

## Settled account facts

- [x] The owner already has a personal Apple developer account with existing app setup.
- [x] The owner already has a Google Play business/organization account with DUNS.
- [x] Do not add developer enrollment, DUNS acquisition or a personal-account twelve-tester program to this project.
- [x] Native planning uses the existing Cloudflare Worker, D1 and R2; self-hosting means a user's own Worker deployment, not the retired Node backend.

Existing accounts do not decide the new app's identifiers, commercial terms, region availability, signing setup or product configuration. Those app-specific choices remain below.

## RC01 Product and distribution decisions

- [ ] Record accepted Overview concept, navigation, phone/tablet behavior and V1 parity rows; no placeholder route or dead control ships.
- [ ] Record initial EU/EEA and US storefront selection, supported languages and any exclusions; evaluate other storefronts separately.
- [ ] Resolve billing by platform/storefront, including existing Stripe subscribers, authorized purchase links, native purchase products, restoration and management. Recheck policies against the final purchase flow before submission.
- [ ] Resolve catalogue/enforcement drift: managed Free behavior, local versus managed receipts, API access and automation limits. Preserve existing-user access unless a separately approved migration changes it.
- [ ] Approve native local persistence and backup semantics, self-host availability, any managed read cache and the explicit absence or presence of offline cloud editing.
- [ ] Approve provider selection, native session transport, account linking, TOTP/passkey compatibility and account-deletion lifecycle.
- [ ] Select app name, bundle ID, Android application ID, URI scheme, associated domains, support URL and privacy URL. Verify ownership and avoid collisions with sibling apps.
- [ ] Review store category and financial-feature declarations against the actual functionality. Descriptions must accurately distinguish personal finance recording/calculators from bank connectivity, regulated services, trading or personalized advice; do not infer a category exemption from branding.

## RC02 Source license, dependencies and asset rights

The repository declares `AGPL-3.0-only` in `package.json:7` and contains GNU AGPLv3 in [LICENSE](../../LICENSE). Its object-code/source terms, downstream restrictions and modified-network-service source offer must be evaluated for the actual distributed work: local `LICENSE:233–274`, `434–457`, `540–559`. The [SPDX reproduction of AGPL-3.0-only](https://spdx.org/licenses/AGPL-3.0-only.html) provides the same license terms. This is a release decision for a qualified license reviewer where needed, not a conclusion that either store is compatible or incompatible.

Apple applies its standard EULA unless a custom one is supplied. Providing a custom EULA is a configuration option; it does not itself settle AGPL compatibility, dependency rights or the store's other contractual conditions. [Apple custom EULA guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-a-custom-license-agreement).

- [ ] Inventory copyright holders/contributions and confirm the precise license grant for original Token Circles code. Repository ownership alone does not prove rights to relicense all contributions.
- [ ] Inventory shipped JavaScript, Swift/Kotlin/Java/native binaries, vendored modules and transitive SDKs from resolved locks and the built artifact; record license/version/source/notices and redistribution obligations.
- [ ] Obtain a recorded conclusion covering each intended store's current distribution terms, source rights, downstream restrictions and any necessary permissions/exceptions. If relying on an alternate commercial grant, document who can grant it and what it covers.
- [ ] Do not change LICENSE or add a blanket exception until the owner approves a concrete rights-supported proposal; permission for own code does not replace dependency permissions.
- [ ] Decide the exact App Store EULA and Play-facing license presentation; confirm they do not contradict the approved licensing basis.
- [ ] Produce a corresponding-source publication method tied to every distributed version where required, including build scripts and relevant modifications; verify source links and availability from the app/store/source repository.
- [ ] Preserve applicable notices and modified Worker network source offers; inspect requirements for the exact source combination rather than treating all package directories as legally separate works.
- [ ] Record rights and attribution for fonts, icons, brand assets and generated artwork. System font usage is distinct from bundling font files; borrowed reference screenshots belong in research, not shipped assets.
- [ ] Scan generated visuals for third-party marks, recognizable copied interfaces and misleading financial content. Preserve generation provenance/prompts and original asset files.

## RC03 Build, platform floors and app identity

At this research snapshot, new Google Play phone/tablet apps and updates must target Android 16/API 36 or higher. This is a target-SDK requirement, not the minimum Android version users must run. [Google target API requirements](https://developer.android.com/google/play/requirements/target-sdk). Apple's currently effective upload requirement is Xcode 26 or later with the iOS/iPadOS 26 SDK or later; this similarly does not decide the app's deployment target. [Apple SDK minimum requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a). Recheck both at submission instead of freezing policy to this planning snapshot.

| Configuration                        | Value/status to record                                                   | Evidence required                                                        |
| ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Capacitor and native plugins         | Exact approved pinned versions                                           | Actual package locks, platform build and supported OS/SDK documentation  |
| iOS/iPadOS minimum supported version | Pending; choose after framework and plugin minimums are verified         | Build deployment target plus oldest supported physical-device QA         |
| Android minimum SDK/WebView support  | Pending; choose after all native dependencies are verified               | Merged manifest, dependency floor and oldest supported device/WebView QA |
| Android compile/target SDK           | Current submission requirement checked above; exact build recorded later | Gradle configuration and Play validation                                 |
| Xcode, Apple SDK, macOS build host   | Exact compatible toolchain selected later                                | Archive/build logs and App Store validation                              |
| Phone/tablet/orientation support     | Pending accepted designs                                                 | Manifest/target settings and resize QA                                   |
| Signing and associated domains       | App-specific IDs, certificates and stores                                | Verified signed archive/bundle, AASA and assetlinks association results  |

- [ ] Commit reproducible native project/configuration according to the chosen monorepo policy; document clean install/build/sync/archive commands.
- [ ] Production bundles contain bundled mobile UI assets, correct environment origin and no developer server URL, test bypass, debug menu, development credentials or remote web-shell dependency.
- [ ] App version and monotonically valid build numbers are independently tracked for both stores; source revision and backend compatibility information are recorded.
- [ ] Signing/upload keys and provider secrets live in approved secret storage with recovery/rotation instructions; public client identifiers are distinguished from secrets.
- [ ] Production URL schemes and associated domains match release signing, package and team IDs; test debug and release signatures separately on Android.
- [ ] Audit merged manifests/entitlements and native binary contents, including permissions transitively introduced by plugins.
- [ ] Validate currently applicable Android native-library/ABI requirements for every included binary, not just TypeScript compilation; run store preflight on the signed output.
- [ ] Keep build-time SDK upgrades separate from any deliberate removal of older-device support.

## RC04 Privacy disclosures and permissions

Apple requires privacy answers to include integrated third-party practices and to remain accurate; locally useful functionality does not exempt optional cloud or SDK collection. [Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/). Google similarly requires an accurate Data safety form covering the app and third-party SDKs. [Google Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469). The table below is an investigation worksheet, not completed store-label answers.

| Data flow                                        | Questions to answer from shipping implementation                                                          | Required evidence                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Local accounts, transactions, notes and receipts | Stored where; included in OS backup; encrypted how; removed when; any telemetry/network exposure?         | Native storage configuration, restart/backup/delete tests and network observation |
| Managed finance data                             | Which fields reach Worker/D1/R2; user association, retention, access, region and subprocessors?           | Endpoint/data map, approved privacy wording and deletion results                  |
| Self-hosted data                                 | Which operator receives it; any Token Circles or SDK services still contacted?                            | Endpoint routing and independent network observation                              |
| Identity/security                                | Email, provider subject, session/device data, IP logs, captcha, verification mail and provider revocation | Auth architecture, log review and provider configuration                          |
| Subscription/purchase                            | Store/Stripe identifiers, transaction state, any RevenueCat or alternative SDK processing                 | Final provider decision, SDK documentation, purchase/backend network map          |
| Camera/photos/files                              | Selected items versus broader access; temporary paths; upload; exported copy ownership                    | Permission prompts, scoped picker behavior and file cleanup tests                 |
| Diagnostics/support                              | Crash data, device/usage identifiers, attachment contents, retention and opt-in choices                   | Exact enabled SDK settings and captured safe sample events                        |

- [ ] Publish a privacy policy matching the named developer/app and all enabled storage, identity, payment and diagnostic modes; keep its URL accessible without login.
- [ ] Fill Apple labels and Google Data safety using actual collection/sharing/linkage/purpose definitions and evidence. Do not choose “no data collected” merely because one mode is local-first.
- [ ] Identify all SDK privacy manifests, signatures and required-reason API declarations that apply to the resolved SDK list and app code; validate the archive's aggregated result. Apple's current list explicitly includes Capacitor and GoogleSignIn; binary signature rules depend on how the SDK is included. [Apple third-party SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/).
- [ ] Request camera/photo/file capabilities only at the relevant action, with specific purpose wording and a working denied/limited-access path. Avoid broad storage access when scoped pickers satisfy the approved feature.
- [ ] Add notification permission and disclosure only if a delivered native notification feature needs it; existing email reminders do not establish a push feature.
- [ ] Audit logs/crash breadcrumbs/network error handling for financial payloads, emails, receipt paths and authentication values. Existing raw-response logging in the web client must not be inherited unreviewed.
- [ ] Document financial-data retention, deletion completion, necessary retained records and user-facing explanations; reconcile store forms and privacy policy after final implementation changes.
- [ ] Record whether app-switcher redaction, screen-capture restrictions or a biometric app lock are approved product choices; do not market them before implementation and testing.

## RC05 Encryption and security verification

Using or incorporating encryption, including operating-system cryptography, requires an export-compliance determination in App Store Connect. An exemption or documentation answer must reflect the actual app and countries; do not set an exemption flag just to silence a build warning. [Apple export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance).

- [ ] Inventory TLS, credential storage, passkeys, any encrypted local database, backup encryption and all SDK crypto; determine applicable export classification/documentation with qualified review when needed.
- [ ] Set `ITSAppUsesNonExemptEncryption` and associated store answers only after that determination; retain supporting classification/documentation if required.
- [ ] Write precise security copy distinguishing transport encryption, OS device protection, encrypted local storage and end-to-end encryption. The audited catalogue explicitly excludes E2EE; unmerged work does not change the shipping claim.
- [ ] Verify secure session storage and native refresh/revocation behavior; no first-party auth through paid API/MCP tokens or web localStorage bearer shortcuts.
- [ ] Test OAuth nonce/state/PKCE where selected, audience/issuer/signature checks, account linking, challenge expiration and replay resistance; preserve required TOTP behavior.
- [ ] Verify cookie web routes retain approved CORS/CSRF guarantees alongside the new native transport. Self-host endpoint changes cannot forward another host's tokens.
- [ ] Test profile/receipt ownership boundaries, record enumeration denial, paid feature enforcement and mutation validation through the Worker.
- [ ] Test database migrations and backup recovery against representative existing data; local storage upgrade failure must preserve recoverability.
- [ ] Review dependency vulnerabilities and retained debug functionality against the exact shipping lockfiles; document accepted findings with evidence and owner, not only a green scan count.

## RC06 Deletion, sign-out and identity revocation

Apple requires apps offering account creation to let people initiate account deletion in-app; Sign in with Apple users require provider token revocation. Its guidance distinguishes account deletion from continuing App Store billing and permits immediate deletion even when later deletion is also offered. [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/). Google requires an in-app deletion path and an accessible web resource for account-deletion requests for covered apps. [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

- [ ] Settings offers clear separate actions for sign out, erase local data and permanently delete cloud account; full deletion names profiles and receipts in scope.
- [ ] Before deletion offer data export and provider-specific subscription-management guidance without making cancellation or an export a condition of account deletion.
- [ ] Verify existing D1/R2 cleanup and Stripe best-effort cleanup behavior under partial failure; expose an accurate completion/retry state and operational reconciliation.
- [ ] Extend deletion to new native refresh sessions, device records, Apple grant revocation and any new purchase-service user mapping according to the chosen architecture.
- [ ] Build and test the public deletion-request web route, including correct app/developer naming, authentication/identity verification where appropriate and a usable completion path without reinstalling the app.
- [ ] Define retained purchase/fraud/legal records and user-facing retention explanation; a late webhook must not reconstruct deleted personal finance data or silently recreate an account.
- [ ] Test local-only erase without network, remote deletion from another device, sign-out on a shared device, reinstall and signing in as a different user.
- [ ] Apple/Google/store billing guidance states what continues or ends accurately; store subscription cancellation is not inferred from deleting a Token Circles account.

## RC07 Purchase and entitlement lifecycle

Only execute store-specific rows for the approved billing channels; record an explicit not-applicable reason for omitted channels. The expected result must be defined in the entitlement design before implementation. Current Stripe status, idempotency and event ordering are useful existing behaviors; a cross-provider ledger is new work.

| Scenario                                               | Required result to demonstrate in sandbox/test environment                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| New monthly/annual purchase, each tier                 | Correct localized price/terms, verified transaction, correct account entitlement, one charge intent |
| User cancels purchase or declines authentication       | No entitlement fabricated, no error alarm, return to prior context                                  |
| Pending/approval-required purchase                     | Pending state remains distinct; later completion handled once                                       |
| Purchase succeeds while app/network dies               | Recover through store/backend state on resume without buying again                                  |
| Existing Stripe subscriber signs in on either platform | Existing entitlement recognized and duplicate purchase guarded; correct management destination      |
| Existing Apple subscriber opens Android, or reverse    | Same approved account entitlement policy, source shown, no unsupported provider management          |
| Restore on reinstall/new device                        | Verified restoration bound to correct account; no new charge                                        |
| Store account differs from Token Circles account       | Explicit ownership/linking/recovery policy; no silent entitlement transfer                          |
| Upgrade/downgrade/interval change                      | Correct proration/deferred behavior for provider and explicit effective date/state                  |
| Cancel at renewal, expiration and resubscribe          | Appropriate access until effective end; UI and backend agree after refresh                          |
| Billing retry/grace/account hold                       | Provider-specific semantics and recovery messaging; cached data not silently deleted                |
| Refund/revocation/chargeback                           | Signed authoritative update adjusts entitlement according to policy                                 |
| Duplicate/out-of-order/replayed notification           | Idempotent consistent state; no privilege resurrection from stale event                             |
| Temporary purchase-provider/backend outage             | Unknown status handled separately from Free; approved cached-entitlement policy exercised           |
| Account deletion with active store subscription        | Immediate account deletion available, billing guidance clear, no later data resurrection            |
| Product unavailable/wrong region/configuration         | No broken paywall, fabricated price or unauthorized external link fallback                          |

- [ ] Isolate test and production purchase verification, entitlement records and configuration; use distinct credentials/endpoints where the provider supports them. Product identifiers may be shared across environments: Apple sandbox uses the app's real App Store Connect product data. Verify the provider-reported environment and test-purchase markers rather than inferring them from product ID. Label environments safely in build/review evidence. [Apple sandbox testing](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox)
- [ ] Verify server-side purchase authenticity, account association, event reconciliation and handling of provider outages with suitable tests.
- [ ] Record renewal/offer terms, tax/currency treatment, refund/support routing and commercial inputs from actual store configuration before final pricing copy.
- [ ] Capture purchase-management and restore screens on real devices; generated mockups are not lifecycle verification.

## RC08 Native device and accessibility evidence

The support floor remains pending [decision D03](decisions.md). Simulator/browser tests are useful but do not verify native provider, camera, file, keyboard or store behavior on their own.

| Device class                                       | Required coverage                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Oldest supported compact iPhone                    | Full first-run/Add flow, keyboard, memory pressure, permission and supported auth methods |
| Current larger iPhone                              | Safe areas, system appearance, latest OS navigation, camera and purchase lifecycle        |
| Supported iPad, narrow and expanded window         | Split view/list-detail, rotation/resize, external keyboard, document preview and share    |
| Oldest supported Android phone/WebView             | Local persistence, performance, input, permission denial and plugin compatibility         |
| Representative midrange Android phone              | Process death/resume, battery restrictions, file providers, camera and release signing    |
| Current Android phone with gesture navigation      | Target-SDK behavior, edge-to-edge insets, predictive/system back, sign-in and purchases   |
| Supported Android tablet or resizable large screen | Two-pane transitions, window resize, readable forms and hardware keyboard                 |

- [ ] Run all approved [surface acceptance checklists and state matrix](surface-plan.md), with both Observatory and Dawn and system theme switching.
- [ ] Test VoiceOver/TalkBack, text enlargement, visible focus, reduced motion and non-color status understanding; verify real touch targets and amounts remain readable.
- [ ] Test locale decimal/date formats, supported currencies, local-midnight/timezone and daylight-saving boundaries, Unicode labels and long merchant names.
- [ ] Test fresh install, upgrade from every supported local schema, OS backup/restore, reinstall and app data erase according to the documented storage model.
- [ ] Test offline local work, cloud disconnection, slow/resuming requests, captive portal-like errors and interrupted imports/uploads/restores without silent duplicates or data loss.
- [ ] Measure cold start, ledger scrolling and maximum supported import/receipt handling on a representative slower physical device; record acceptable thresholds with evidence before marking performance passed.
- [ ] Confirm the shipping app has native navigation/composers, polished tablet layouts and meaningful functionality; no desktop shell scaled into the WebView.

## RC09 Store review package

Apple's review guidance calls for a complete, stable app with accessible review functionality, working backend services and accurate metadata/screenshots. [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). Google provides a review-information workflow for app access, privacy and other declarations. [Google prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).

- [ ] Provide reviewer instructions for local use, cloud login, profile selection, paid features, restoration, deletion and any self-host entry. Give synthetic demo data and a dedicated review account where needed through the store's protected review fields, not the repository.
- [ ] Ensure captcha/2FA and provider requirements have a legitimate review-access path; do not disable production security globally for reviewers.
- [ ] Backend and review account remain usable during review; test instructions from a fresh install with the submitted binary.
- [ ] Store screenshots come from actual implemented phone/tablet screens with synthetic data and correct device sizes. Concept artwork may support marketing but cannot substitute for truthful in-use screenshots.
- [ ] Descriptions, screenshots, privacy labels and paywall claims agree with delivered V1; no OCR, automatic bank connection, cloud offline sync, shared households or E2EE unless actually delivered and verified.
- [ ] Complete age/content ratings, privacy/support/deletion links, financial-feature and other applicable declarations, regional commercial disclosures and store product metadata using the actual current console questions.
- [ ] Validate localized app name/subtitle/description, permission wording, accessibility and purchase copy with the same terminology used in the app.
- [ ] Attach store sandbox/purchase instructions and review notes explaining any lawful region-dependent checkout behavior; do not expect reviewers to infer it from source docs.

## RC10 Release and backend separation

Current repository policy: pushing `main` deploys Cloudflare dev; annotated `v*` tags deploy prod with migrations applied first (`AGENTS.md:69–70`). Native store release must not accidentally become a Cloudflare production deployment.

- [ ] Decide and test mobile-specific release tags/jobs and version ownership; inspect existing workflow trigger patterns before adding tags. Do not reuse `v*` without deliberately accepting the existing backend production effect.
- [ ] Native signing/upload jobs are separate from Worker migration/deploy jobs; credentials and environment approval mechanisms follow each target's needs.
- [ ] Keep Worker/D1 migrations append-only and additive while older mobile binaries remain installed; compatibility checks cover the last supported mobile versions.
- [ ] Document minimum backend/API capability for each released binary and graceful behavior against an older self-hosted Worker. Feature availability is negotiated without silently corrupting data.
- [ ] Test local schema upgrade and backend change order; avoid relying on an immediate store update to repair a breaking API deployment.
- [ ] Run the actual repository quality gates for changed packages. Note that root/frontend and Worker checks are separate; a root green check alone is not Worker coverage.
- [ ] Produce signed build artifacts, checksums, source revision, dependency inventory, source/notices package and retained QA evidence for the release candidate.
- [ ] Define rollback/stop-distribution and backend compatibility response; database rollback is not an assumed solution to a merged append-only migration.
- [ ] Record support ownership and a user-report route, with privacy-safe diagnostics and app/backend version identification.

## Completion evidence

- [ ] All decisions blocking the submitted scope have recorded answers and remaining later-parity features are explicitly listed.
- [ ] All applicable checks above have links to concrete evidence for the shipping commit; unused capability checks say why they are not applicable.
- [ ] License/distribution rights, privacy/export answers, current storefront billing behavior and account-deletion requirements are resolved for the chosen distribution configuration.
- [ ] Signed binaries pass store validation and physical-device QA; current backend supports both this release and still-supported installed versions.
- [ ] The owner reviews the concrete store package and publication action at the appropriate release gate. Completing planning or scaffolding does not count as publication authorization.
