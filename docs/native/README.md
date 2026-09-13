# Token Circles native app master plan

Build a dedicated SolidJS application for iOS and Android, packaged by Capacitor, inside the existing Token Circles monorepo. Reuse the Cloudflare API and extract tested product logic incrementally. Give mobile its own navigation, presentation, lifecycle handling and device integrations. The target is an excellent native experience delivered through Capacitor; this is not a proposal for SwiftUI or Jetpack Compose rendering.

The recommended commercial baseline is to keep Stripe for web subscribers, recognize those entitlements in mobile, and add Apple/Google native subscriptions for new mobile purchases. Evaluate regional external-payment programs separately after their actual fees, reporting obligations and conversion effects are understood. This recommendation awaits approval. An App Store fee is not the same as the complete cost of collecting revenue.

## Read and review

| Artifact                                                               | Purpose                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Decisions](decisions.md)                                              | Confirmed instructions, recommendations, unanswered choices and what each choice blocks       |
| [Product research](research/product-audit.md)                          | Current features, prices, implementation gaps, source paths and reusable boundaries           |
| [Reference architecture](research/reference-architecture.md)           | MercuryPitch, BesideCue and Chaos Master findings at exact revisions                          |
| [Architecture](architecture.md)                                        | Package layout, storage and runtime ports, extraction phases and build separation             |
| [Authentication](authentication.md)                                    | Apple/Google/email sign-in, native sessions, identity linking and security tests              |
| [Subscriptions and economics](research/subscriptions-and-economics.md) | Storefront policy, all current price points, alternative routes and contribution calculations |
| [Economics workbook](outputs/native-subscription-economics.xlsx)       | Editable assumptions and formula-driven comparisons; model inputs are not actual revenue      |
| [Product brief](PRODUCT.md) and [design system](DESIGN.md)             | The fixed product truth and visual identity                                                   |
| [Visual research](visual-research.md)                                  | Mobbin observations, platform guidance, concept review and gallery production contract        |
| [Gallery](gallery/index.html)                                          | Phone/tablet concepts and screen review material                                              |
| [Surface plan](surface-plan.md)                                        | Page-by-page native behavior, parity decisions, empty/error/offline states                    |
| [Release checklist](release-checklist.md)                              | Device evidence, privacy, billing, review, signing and publication gates                      |
| [Verification](verification.md)                                        | What was checked in this planning deliverable and what remains unverified                     |

## Findings that change the implementation

**The reusable seam already exists, but it is not yet a package boundary.** The frontend has storage adapters, local handlers, finance utilities and API clients. Extract those in small moves, preserving current web behavior with regression coverage. Keep the Worker as the only backend; new storage or identity requirements belong there and use new numbered migrations. [Product audit](research/product-audit.md)

**Take the destination architecture from the sibling apps, not their transitional shortcuts.** BesideCue has an independent application composition. MercuryPitch has valuable native runtime and social-login adapters, but parts of its native entry still mount the root web App. Chaos Master PR 94 is useful for build/release scaffolding, while its wrapper is not the mobile UI to reproduce. Native Token Circles must not depend on a desktop root-App alias. [Reference audit](research/reference-architecture.md)

**Native authentication needs a real server design.** Existing Token Circles sessions are HttpOnly cookies and its Google/passkey flows assume the web origin. Capgo provider sign-in can be reused as a pattern, but its identity tokens must be verified by the Worker and exchanged for app sessions. Preferences is not a secure token vault. Do not copy a browser cookie workaround or token-in-URL flow. [Authentication plan](authentication.md)

**Local-first is not offline cloud sync.** The current local and cloud adapters do not form a synchronization engine. Native storage also does not inherit the website's browser database. Choose explicit local backup/import and cloud network-failure behavior before promising offline edits or seamless migration. [Product audit](research/product-audit.md)

**The catalogue and enforcement need reconciliation.** Current EUR prices are Basic 3/30, Advanced 6/60 and Ultimate 10/100 for monthly/yearly billing. The published Free-cloud boundary and some runtime behavior differ; local receipts are implemented even though the marketing groups receipts with paid cloud features. Decide the intended contract before building a native paywall. Household currently aggregates a single owner's profiles; it does not prove shared accounts between people. [Product audit](research/product-audit.md)

**Payment choices are regional and change over time.** The source review identified Apple EU and Google US changes effective October 1, 2026. EU and EEA must not be treated as interchangeable. Existing Stripe subscribers can be recognized, but where new purchases are offered, the permitted UI and applicable fees require storefront-specific rules. The billing document records effective dates, agreement conditions and uncertainties rather than treating every link-out route as fee-free. [Subscription research](research/subscriptions-and-economics.md)

## Execution phases

Advance by accepted evidence, not elapsed time. An unchecked exit gate keeps the dependent phase open. Scaffolding approval does not approve a billing policy, irreversible data migration, release, or production deployment.

### Phase 0 — Research and decision baseline

- [ ] Review the product/reference audits and correct any mismatch with intended product behavior.
- [ ] Accept the native package boundary and identify the first reusable slice.
- [ ] Select V1 capabilities and explicitly mark later parity work.
- [ ] Choose a billing baseline and supply financial inputs needed beyond scenarios.
- [ ] Resolve the storage promise, account identity policy and self-hosted scope.

Exit: decisions D01–D13 have either an answer or an explicit narrower approved scope. Authentication choices can remain open while an approved local-only slice proceeds; they block dependent authentication work. This phase produces the master plan, source-backed research and economics model. It does not require creating new store accounts.

### Phase 1 — Design and screen contracts

- [ ] Review three compositional concept boards within the existing brand.
- [ ] Approve the daily information hierarchy and primary navigation.
- [ ] Produce a native gallery with iPhone, Android phone and tablet representations in both themes.
- [ ] Show complete local onboarding, authentication, transaction entry, editing, budget detail and upgrade/manage/restore states.
- [ ] Review permission refusal, loading, error, empty, long text, large text and keyboard states beside success states.
- [ ] Approve a first implementation slice by screen IDs; keep other surfaces labeled proposed.

Exit: approved design contract and content-correct mockups for the first slice. More art is generated when it improves a named surface, with prompt provenance and no image-embedded functional UI. Ten or twenty assets are an available scope, not a quality metric.

### Phase 2 — Isolated native scaffold

- [ ] Create `packages/mobile` with its own Solid/Vite entry, TypeScript config, local styles and Capacitor config; no production API calls by default.
- [ ] Add iOS and Android platform projects after bundle IDs and supported OS floors are confirmed. Keep generated bridge files and build outputs treated according to Capacitor conventions.
- [ ] Add a minimal native runtime boundary and deterministic test adapter. Implement only capabilities the first slice consumes.
- [ ] Validate safe area, keyboard, back stack, app resume, deep-link routing and offline launch on actual native platforms.
- [ ] Add focused workspace commands and unsigned CI builds. Lockfile and shared-package changes trigger relevant native checks.
- [ ] Keep native build numbers, signing and distribution distinct from current web `v*` release tags and deployments.

Exit: independent app boots on iOS and Android, no desktop-shell dependency, reproducible unsigned build evidence, secrets absent from source, existing web and Worker gates retained. A browser preview alone cannot satisfy this gate.

### Phase 3 — Reusable product foundations

- [ ] Extract a small pure finance slice with tests and both web/mobile consumers before broad moves.
- [ ] Extract domain types and client/storage contracts without importing platform globals.
- [ ] Inject profile, auth, endpoint and persistence state; remove web-only coupling from each adopted slice.
- [ ] Prove local database upgrade/backup/restore behavior and web-to-native import; never silently overwrite native data.
- [ ] Implement secure native identity/session transport and endpoint policy, with Worker regression tests.
- [ ] Preserve current web behavior while adopting extracted code one feature at a time.

Exit: both applications exercise the same domain logic; auth, profile isolation, money formatting and storage tests pass. Avoid creating empty packages for hypothetical future reuse.

### Phase 4 — First complete native finance loop

Implement welcome and local setup, one account, transaction create/read/edit/delete, transfers, overview, category budgets, and backup/export as a coherent slice. Reuse product computations; build each page's native interaction from its approved gallery contract. Cloud sign-in and data access can be a separate tested slice if identity work needs its own review.

- [ ] Each page has a short surface contract, example data and meaningful failing regression test for new behavior.
- [ ] Financial values reconcile across transaction list, account total, budget and overview.
- [ ] Save failure never reports success; cancelled editing never mutates the account.
- [ ] Back navigation and app background/restore preserve or explicitly discard drafts according to the approved policy.
- [ ] Phone and tablet acceptance evidence includes keyboard, screen reader, large text and reduced motion.

Exit: the first complete finance loop is accepted on real iOS and Android devices. Feature screenshots do not substitute for data-integrity evidence.

### Phase 5 — Cloud, entitlements and remaining V1 surfaces

Implement approved account login/recovery, local-to-cloud transition, subscription identity and management, receipt attachment, analytics and reports. Add further V1 surfaces from the parity matrix only when their states and shared data behavior are ready.

- [ ] Existing Stripe subscribers receive their correct capabilities after sign-in.
- [ ] Server is authoritative for purchases; renewal/refund/revoke/restore and replay events are tested.
- [ ] Upgrades across providers prevent unintended duplicate purchases and explain the existing provider.
- [ ] Store pricing comes from localized product metadata, not hardcoded EUR design fixtures.
- [ ] Local/free use and self-hosted use remain consistent with approved product policy.
- [ ] Tablet receives usable list/detail and chart interaction rather than scaled phone pages.

Exit: V1 acceptance matrix passes, purchase lifecycle evidence is complete, and every deferred feature has a deliberate entry-point treatment. A missing feature must not be represented by a broken web embed.

### Phase 6 — Store readiness and publication

Use the [release checklist](release-checklist.md), including signed builds, physical device testing, privacy disclosures, account deletion, reviewer access, current payment agreement recheck and source/license review. Existing Apple and Google accounts are reused. Prepare listing text and screenshots from actual app builds; do not publish concept renders as functional screenshots.

Exit: owner approves exact binaries/listings and publication as a separate concrete action. Production deployment and store submissions are not performed by this planning pass.

### Phase 7 — Deliberate expansion

Review remaining advanced calculators, investments, imports, automation/API/MCP management, deeper analytics, widget/shortcut possibilities and a possible cloud offline-write engine. Each requires an explicit use case and its own acceptance gate. Do not turn this list into an implied launch requirement or timeline.

## Working method for every page

1. Read the feature's actual data/API contract and approved mobile screen contract.
2. Extract only the logic needed by that page, proving the existing web behavior still holds.
3. Implement phone layout, expanded layout and failure states in the mobile package.
4. Run the focused behavior tests and native device checks appropriate to the changed capability.
5. Present concrete screenshots/build evidence, record acceptance, then move to the next page.

Keep changes reviewable. The repository workflow allows scoped commits and task-branch pushes after verification; opening a PR and publishing remain separate explicit approvals. No co-author trailers or production-tag shortcuts.

## Planning ownership and source hygiene

This directory is the versioned source of truth. A companion index under `~/.dotfiles/personal/tokencircles/native/` points here so personal planning remains discoverable without two independently edited copies. Sibling app repositories and the original `disjoint-colliders` gallery remain read-only research sources; a gallery integration can be delivered later through a dedicated branch if requested.

Evidence was collected against the current Token Circles base `fef628e6918eb1d80938c48c9c6eba2463ae642a`. Exact reference revisions are in the reference audit. Web sources are accessed September 13, 2026; payment-policy conclusions must be revalidated at implementation and submission. Account-specific contracts, tax registrations, live Stripe Price objects, subscriber counts, support costs and developer-program eligibility are unverified inputs unless explicitly confirmed in the decisions register.
