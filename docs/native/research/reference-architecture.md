# Native architecture precedents: MercuryPitch, Beside Cue, and Chaos Master

Research snapshot: 13 September 2026. Scope: read-only source inspection and current primary documentation. No checkout, fetch, build, install, file edit, credential change, or deployment was performed in a reference repository. The local reference applications were not run, so source presence is not proof of current device behavior.

## Recommendation

Keep SolidJS, TypeScript, Vite, pnpm workspaces, and Capacitor 8. Keep Token Circles' API in `worker/` with Cloudflare D1 and R2. Build an independent mobile application entry and mobile-owned screens under `packages/mobile`, while extracting tested domain and client capabilities as individual screens need them. Use Beside Cue's explicit application-services composition, MercuryPitch's native sign-in adapter and per-surface approval loop, and Chaos Master's separation of mobile release tags and signing inputs.

The references are at different stages. Beside Cue is the clearest existing domain/application/platform separation. MercuryPitch contains more relevant account work, but its current mobile entry still mounts the root web `App` and imports web styles; its migration to designed native surfaces is incremental. Chaos Master PR 94 still wraps its existing web bundle. Neither transitional arrangement satisfies Token Circles' explicit request for newly designed mobile screens by itself.

Here, “native experience” means a mobile-designed Solid UI running in Capacitor's system WebView, with native platform interactions. It does not mean SwiftUI or Jetpack Compose rendering every control. Record this distinction in the decision checklist before implementation.

## 1. Evidence and revisions

| Reference                   | Exact snapshot                                                                                                                                                        | Observed state                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MercuryPitch and Beside Cue | `/home/maff/foss/mercurypitch`, `f324f481f27c6b4006e15e7f9acec761936609f2`                                                                                            | Local `main`; tracked worktree clean. Existing unrelated untracked `.claude-worktrees/` and `.playwright-mcp/` left untouched.                                                 |
| Chaos Master local checkout | `/home/maff/foss/chaos-master-fp`, `0d264a2cd5df7ececa1fabd47f2468c19bb6deb2`                                                                                         | Local `main`, clean. This is not the requested mobile PR.                                                                                                                      |
| Chaos Master mobile PR      | [PR 94](https://github.com/Komediruzecki/chaos-master-fp/pull/94), branch `feat/mobile-capacitor-scaffolding-9224ec`, head `5257b4ee9dbaf749320e49fd83de11aadfd354ac` | Open at inspection. Head resolved by `gh pr view`; exact existing object read with `git show`, without switching branches.                                                     |
| Personal planning           | `/home/maff/.dotfiles`, HEAD `399cd476b48c0900107fff9d0f27b25829954248`                                                                                               | Read the named working-tree Markdown files. Their individual contents may be newer than this HEAD; treat as dated planning evidence, not an immutable implementation snapshot. |

Source shorthand below: **M** = MercuryPitch checkout at the SHA above, **C** = exact Chaos PR head, **P** = personal planning. Paths and starting line numbers identify the inspected evidence. Local links may move if the reference checkout advances; use the recorded SHA with `git show` to reproduce source evidence.

## 2. What is implemented, and what remains a plan

| Concern                                | MercuryPitch / Beside Cue implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Implication for Token Circles                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                              | Root MercuryPitch web app; `apps/mercurypitch`, `apps/beside-cue`; `packages/audio-io`, `pitch-engine`, `beside-cue-core`, `mobile-runtime`, `purchase-kit`. M: `pnpm-workspace.yaml:1`, each app's `package.json`.                                                                                                                                                                                                                                                                         | Preserve existing `frontend/` and `worker/`; using `packages/mobile` fits this repository's existing package convention. Directory naming need not match MercuryPitch exactly.                  |
| Separate product application           | Beside Cue owns its `App`, assets, content, persistence composition, native projects, IDs, and lifecycle. M: [Beside Cue README](/home/maff/foss/mercurypitch/apps/beside-cue/README.md:5), [entry](/home/maff/foss/mercurypitch/apps/beside-cue/src/main.tsx:14).                                                                                                                                                                                                                          | Strongest structural precedent for a truly independent Token Circles mobile entry.                                                                                                              |
| MercuryPitch native surface transition | Native entry owns boot/platform wiring and native shell, but imports `@/App` and root CSS. Vite aliases `@` to root `src`. M: [entry](/home/maff/foss/mercurypitch/apps/mercurypitch/src/main.tsx:66), [alias](/home/maff/foss/mercurypitch/apps/mercurypitch/vite.config.ts:118).                                                                                                                                                                                                          | Borrow the destination boundary and lessons. Do not start by importing Token Circles' desktop shell and then hiding it with CSS.                                                                |
| Product-neutral capabilities           | `mobile-runtime` provides typed ports, unavailable implementations, web adapters, test fakes, and opt-in Capacitor subpaths. M: [contracts](/home/maff/foss/mercurypitch/packages/mobile-runtime/src/contracts.ts:1), [composition](/home/maff/foss/mercurypitch/packages/mobile-runtime/src/capacitor.ts:1).                                                                                                                                                                               | Keep plugin types out of feature/domain code. Compose only capabilities the binary actually installs.                                                                                           |
| Purchases                              | Beside Cue installs RevenueCat Purchases and UI 13.x and uses store-neutral purchase/paywall ports. MercuryPitch's current native runtime deliberately composes unavailable purchase and paywall ports; its app package does not install RevenueCat. M: [Beside Cue dependencies](/home/maff/foss/mercurypitch/apps/beside-cue/package.json:37), [MercuryPitch inert runtime](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/mobile-runtime.ts:39).                      | RevenueCat is a proven sibling pattern, not a finished MercuryPitch entitlement backend to copy.                                                                                                |
| Auth                                   | Capgo social-login 8.5.7 pinned in MercuryPitch app. Native Google and Apple bridge flow exists, with Apple Worker verifier, route, notifications and revocation support. M: [adapter](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/social-login.ts:54), [Apple routes](/home/maff/foss/mercurypitch/workers/db-worker/src/apple-routes.ts:1).                                                                                                                         | Prefer this plugin family and adapter shape, but independently design and test the Token Circles server trust boundary.                                                                         |
| Local data                             | Beside Cue has a raw IndexedDB repository behind an async atomic snapshot contract. MercuryPitch uses its existing Dexie data layer and stores identity keys through Preferences. M: [repository contract](/home/maff/foss/mercurypitch/packages/beside-cue-core/src/repository.ts:7), [services](/home/maff/foss/mercurypitch/apps/beside-cue/src/app-services.ts:77), [Preferences adapter](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/preferences-storage.ts:24). | Sibling SQLite and secure-storage discussions are not evidence that either is already implemented. Reassess native durability against Token Circles' financial records and local-first promise. |
| Chaos native transport                 | `packages/mobile` uses `webDir: '../app/dist-native'`; platform runtime has real file save/share ports and tests. Other lifecycle/auth/purchase features remain checklist work. C: [config](https://github.com/Komediruzecki/chaos-master-fp/blob/5257b4ee9dbaf749320e49fd83de11aadfd354ac/packages/mobile/capacitor.config.ts#L17), [files port](https://github.com/Komediruzecki/chaos-master-fp/blob/5257b4ee9dbaf749320e49fd83de11aadfd354ac/packages/mobile-runtime/src/files.ts#L21). | Reuse reasoning about device files, build artifacts, and CI, not its editor wrapper or WebGPU requirements.                                                                                     |

Older personal plans describe Apple and iOS Google as deferred, suggest other plugins, or say RevenueCat dependencies should remain installed while inert. The inspected main source has moved beyond those directions. The 11 September program plan records Capgo and Apple server work as foundation decisions, and subsequent source is authoritative for implementation. See P: [program plan](/home/maff/.dotfiles/personal/mercurypitch/plans/native-app-program-plan-2026-09-11.md:34) versus [earlier architecture paper](/home/maff/.dotfiles/personal/mercurypitch/plans/native-app-architecture-approach-2026-09-11.md:203).

## 3. Proposed package boundary

This is a recommendation, not a requirement to create every package during scaffolding.

```text
frontend/                     existing desktop/web application and its UI
worker/                       existing Hono API, D1, R2, auth, billing
shared/                       existing runtime-neutral TypeScript
packages/
  mobile/                     independent Solid + Vite application
    src/
      app/                    boot and application-services composition
      navigation/             tabs, per-tab stacks, sheets, deep-link routes
      features/               mobile-owned screens and controllers
      ui/                     mobile primitives and design tokens
      infrastructure/         native adapter composition
    capacitor.config.ts
    ios/                      app-owned Xcode/SPM project after ID approval
    android/                  app-owned Gradle project after ID approval
  mobile-runtime/             narrow capability ports and native adapters
  client/                     extract API/session/repository composition by need
  domain/                     only if shared/ needs an explicit package boundary
  pwa-kit/                    existing browser-only package
```

Do not duplicate `shared/` into an empty “core” package for symmetry. Start by making its present public boundary explicit. Add `client` when both web and mobile consume the first extracted use case. Native UI can remain app-local until a second real consumer exists.

Dependency direction:

```text
desktop UI -----+--> shared domain/types <-- Worker
                |
mobile UI ------+--> application services --> repository/API contracts
                                             ^
mobile entry --> device adapters -------------+
web entry -----> browser adapters ------------+
```

Neither shared domain nor reusable client services should import a web shell, routing singleton, JSX view, `window` at module scope, Capacitor SDK, or app-specific environment variables. Inject configuration at boot. Allow the native package to depend on shared public exports, never `../../frontend/src/App` or desktop CSS.

Beside Cue's `BesideCueAppServices` is a useful small model: repository, runtime, product purchase configuration, clock, ID factory, and media ports are composed once. Tests inject the same contracts. M: [application services](/home/maff/foss/mercurypitch/apps/beside-cue/src/app-services.ts:23). Its all-state snapshot repository is specific to that smaller product; Token Circles should preserve its own transaction/query semantics rather than adopting a whole-ledger JSON blob.

## 4. Sign-in architecture to adapt

### 4.1 Client bridge

Use `@capgo/capacitor-social-login` from the mobile package behind a small `SocialAuthPort`. The current maintainer documentation maps plugin major 8 to Capacitor 8. Google uses platform SDKs, including Android Credential Manager; Apple uses system authentication on iOS and needs a redirect backend for Android. Include only intended providers and keep the plugin out of shared browser code. [Capgo plugin documentation](https://github.com/Cap-go/capacitor-social-login).

MercuryPitch's exact adapter is worth studying:

- `google.webClientId` is the web OAuth client used by Android Credential Manager. The Android client records package name and signing certificate in Google Cloud; it is not the value passed here.
- iOS has `iOSClientId` and the web client as `iOSServerClientId` for server authorization.
- The Apple initialization block is emitted only on iOS. At its pinned version, giving Android the iOS empty-redirect Apple block aborts initialization before Google is ready.
- App code parses the plugin's nested `{ provider, result }` response, distinguishes cancellation from network/configuration failure, and resets a rejected lazy initialization promise so retry can work.
- The shared auth outcome preserves a second-factor challenge instead of flattening it into a generic failure.

These are local implementation observations: M: [adapter](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/social-login.ts:19), [response/error handling](/home/maff/foss/mercurypitch/src/features/account/native-sign-in.ts:105), [Google challenge integration](/home/maff/foss/mercurypitch/src/features/account/native-sign-in.ts:271). Revalidate against the exact version installed for Token Circles.

### 4.2 Server trust boundary

Proposed flow:

1. Mobile asks the Worker for a short-lived, single-use auth challenge bound to the intended provider and any explicit account-link operation.
2. Native broker performs authentication with the agreed nonce representation.
3. Mobile sends identity token and challenge reference over HTTPS to the existing Worker, along with the authorization code where the provider's server flow needs it.
4. Worker verifies signature, issuer, accepted audience, expiry, subject and challenge binding; consumes the challenge atomically; finds the `(provider, subject)` identity; applies existing account/2FA/disabled-user checks; issues a Token Circles session.
5. Native TokenStore persists the appropriate session secret in device credential storage; startup hydrates it before authenticated queries or account routing run.

This extends Token Circles' existing auth rather than adding Firebase or another identity database. Keep identity, app session, and subscription customer ID distinct. A store account is not proof of ownership of a Token Circles account.

MercuryPitch already demonstrates Apple signature/JWKS verification, first-authorization profile capture, private relay awareness, authorization-code exchange, encrypted stored Apple grant, revocation, and signed server notifications. M: [Apple verifier](/home/maff/foss/mercurypitch/workers/db-worker/src/apple-auth.ts:219), [signed-email handling](/home/maff/foss/mercurypitch/workers/db-worker/src/apple-routes.ts:129), [code exchange](/home/maff/foss/mercurypitch/workers/db-worker/src/apple-routes.ts:160), [encrypted grant shape](/home/maff/foss/mercurypitch/workers/db-worker/src/apple-auth.ts:525). Use these as acceptance topics, not as unreviewed code to copy.

### 4.3 Specific improvements over the references

| Observation in inspected source                                                                                                                                                                                                                                                                                                         | Token Circles design consequence                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google verification calls Google's `tokeninfo` endpoint for every login. M: `workers/db-worker/src/auth.ts:530`.                                                                                                                                                                                                                        | Use a Worker-compatible JWT/JWKS verifier with caching and bounded key refresh. Google explicitly reserves `tokeninfo` for debugging and warns it can be throttled or intermittently fail in production. [Google backend authentication](https://developers.google.com/identity/sign-in/android/backend-auth).                         |
| Google client creates a nonce but then calls `loginWithGoogle(idToken)` without sending a server challenge; its server handler has no nonce check. Apple compares token nonce with the nonce supplied in that same request. M: `src/features/account/native-sign-in.ts:287`; `workers/db-worker/src/auth.ts:2036`; `apple-auth.ts:298`. | Do not describe client nonce equality as a complete replay guard. Add server-issued, expiring, single-use challenges; cover repeated and parallel exchange attempts. This is a proposed hardening requirement, not a full security audit of the sibling app.                                                                           |
| Federated lookup scopes provider and subject, but email auto-link writes one `users.providerId`, while other paths handle adopted identities specially. M: `workers/db-worker/src/auth.ts:1906`, `apple-routes.ts:227`.                                                                                                                 | Prefer a dedicated provider-identity relation with a unique `(provider, subject)` key and multiple identities per app account. Existing-account linking must verify ownership and handle conflicts explicitly.                                                                                                                         |
| Google auto-link uses `email_verified` without an authority distinction. M: `workers/db-worker/src/auth.ts:2021`.                                                                                                                                                                                                                       | Require explicit account confirmation for linking; do not assume arbitrary third-party Google email is currently controlled by the signer. Google's guidance distinguishes Gmail/Workspace authority from other email addresses. [Google backend authentication](https://developers.google.com/identity/sign-in/android/backend-auth). |
| MercuryPitch's native token/identity port stores through Preferences.                                                                                                                                                                                                                                                                   | Preserve the async hydration seam, but use Keychain/Keystore-backed credential storage for Token Circles session secrets. Preferences uses UserDefaults/SharedPreferences and is for lightweight settings, not a secure token vault or database. [Capacitor Preferences](https://capacitorjs.com/docs/apis/preferences).               |
| Foreground refresh still uses document visibility while a newer platform lifecycle port exists. M: `src/features/account/session-refresh.ts:17`, `apps/mercurypitch/src/infrastructure/native-shell.ts:74`.                                                                                                                             | Compose one app-lifecycle service; refresh on cold start and true resume with deduplication and an explicit expiry/offline policy. Avoid two competing lifecycle authorities.                                                                                                                                                          |

The credential-store plugin remains a spike decision. Evaluate exact license, maintenance, Capacitor 8 compatibility, iOS Keychain accessibility, Android encryption/backup behavior, account removal, reinstall behavior, and locked-device access. Do not equate the plugin's persistence marketing with a complete security model.

### 4.4 Account checklist

- [ ] Decide Apple/Google availability on each platform; recommended first scope is Apple + Google on iOS, Google on Android, and the existing email recovery path on both. Apple-on-Android is a separate explicit decision.
- [ ] Confirm permanent bundle/package ID, API/public origins and development identity strategy before native project generation or OAuth console setup.
- [ ] Register distinct Google Android signing fingerprints for debug, local release where used, and Play App Signing; verify iOS URL scheme/client setup. Never reuse another product's OAuth client as Token Circles' identity.
- [ ] Define create-account versus link-account versus recover-account flows, including existing Stripe subscribers and local-only data migration.
- [ ] Specify guest/local-first behavior before account creation and what survives sign-out.
- [ ] Probe passkeys on real iOS/Android with associated domains; do not silently assume existing browser WebAuthn works in WebViews.
- [ ] Expose account deletion in mobile Settings; include Apple grant revocation, active sessions, local data cleanup, and clearly explained subscription management.
- [ ] Keep Turnstile exceptions narrow. A caller-controlled native header or Origin is not an authentication factor and must not remove abuse defenses from public email/password endpoints.
- [ ] Test expired/wrong-audience/wrong-provider token, nonce replay, unavailable broker, cancellation, interrupted flow, Apple first/returning/private-relay login, 2FA challenge, account collision, deletion and reinstall.

## 5. Platform capabilities and native UX behavior

Start with `App` lifecycle/back/deep links, Haptics, Keyboard, Network where useful, Share, and a credential-store adapter. Add Camera/Filesystem for the real receipt flow and notification adapters only after corresponding product UX and permission rationale are approved. Token Circles does not need the sibling audio engines, microphone configuration, WebGPU minimums, keep-awake defaults, or model-asset bundles.

The reference runtime's aggregate Capacitor entry statically imports all its adapters even when options omit them. MercuryPitch corrected this by composing a haptics subpath with unavailable notification/purchase ports. This prevents a TypeScript build from succeeding through a shared package's dependencies only to return `Unimplemented` on device. M: [aggregate warning](/home/maff/foss/mercurypitch/packages/mobile-runtime/src/capacitor.ts:5), [narrow composition](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/mobile-runtime.ts:18).

Own the navigation model: persistent top-level tabs, a stack per tab, and a topmost-overlay registry. Android back, visible Back, and sheet dismissal should agree. Preserve unsaved expense drafts and scroll position; let a root back action follow the chosen Android behavior. MercuryPitch's registered back handler prioritizes shell overlays before navigation and then minimizes the app. M: [back registry](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/native-shell.ts:32).

Use app links/universal links for shared resources and account return paths, with strict host/path parsing. Support both cold launch and already-open app events, defer routing until session hydration, and re-check resource authorization after navigation. The underlying association mechanism requires app/site ownership configuration. [Capacitor deep links](https://capacitorjs.com/docs/guides/deep-links).

For receipts/export, learn from Chaos Master's `FilePorts`: test byte transfer failures, partial-file cleanup, filename safety, OS share cancellation, and Android/iOS destination differences. Mocks of a browser download link do not prove that a WebView can save or share the file. C: [file contract and chunked write](https://github.com/Komediruzecki/chaos-master-fp/blob/5257b4ee9dbaf749320e49fd83de11aadfd354ac/packages/mobile-runtime/src/files.ts#L21).

## 6. Build, release and verification

### Toolchain and floors

The current Capacitor 8 migration guide requires Node 22+, Xcode 26+, and Android Studio Otter 2025.2.1+. It lists iOS 15 and Android API 24 minimum platform baselines, compile/target SDK 36, AGP 8.13 and Gradle 8.14.3, and defaults new iOS projects to Swift Package Manager. These are framework baselines; selected plugins can raise the minimum. Recheck the exact install version and submission requirements before release. [Capacitor 8 guide](https://capacitorjs.com/docs/updating/8-0).

MercuryPitch currently chooses iOS 16 and Android API 29; Beside Cue chooses Android API 26; Chaos chooses iOS 26/API 31 for its GPU product. Those are product choices, not a shared platform mandate. Token Circles' device floor should follow its audience and tested capabilities. The MercuryPitch workflow uses Node 22 and Java 21. M: `apps/mercurypitch/ios/App/App.xcodeproj/project.pbxproj:243`, `apps/mercurypitch/android/variables.gradle:1`, `.github/workflows/capacitor-app.yml:320` and `:356`.

### Build invariants

- Mobile must have its own `dist`, HTML entry, app icons, splash background and fonts. No committed production `server.url`, browser service worker registration, PWA install prompt, or unapproved live code-update channel.
- Use an explicit asset manifest for offline first-run art and critical receipt placeholders. Validate both Vite output and copied native assets. MercuryPitch had green builds where art was absent or engines still fetched from a CDN despite local files being present. M: [bundle gate](/home/maff/foss/mercurypitch/apps/mercurypitch/scripts/assert-bundle.mjs:6).
- Trigger asset staging from build configuration, not only a package `prebuild` hook: direct `pnpm exec vite build` bypasses package lifecycle hooks. M: [asset staging](/home/maff/foss/mercurypitch/apps/mercurypitch/vite.config.ts:90).
- Validate the actual browser/mobile dependency graph. A runtime `if` is not a reliable proof that plugin/payment chunks were excluded. Separate entries and exports reduce reliance on constant folding; if defines remain, test both builds' define parity.
- Deduplicate `solid-js` across workspace consumption. M: [Vite dedupe](/home/maff/foss/mercurypitch/apps/mercurypitch/vite.config.ts:122).
- Never return a raw Capacitor plugin proxy from an async loader: its arbitrary-property proxy can look like a `then` method and stall promise resolution. Return a plain object exposing selected methods. MercuryPitch records this as a real black-screen regression with a neighboring regression test. M: [Preferences adapter](/home/maff/foss/mercurypitch/apps/mercurypitch/src/infrastructure/preferences-storage.ts:38).

### Release structure

Adapt the reusable workflow plus thin per-app caller pattern. The caller owns paths, tag prefix, app ID and explicit secret mapping. Reuse team-level Apple infrastructure where appropriate while keeping Token Circles profiles, keystore and billing keys product-specific. Do not use `secrets: inherit`. C: [caller inputs and secrets](https://github.com/Komediruzecki/chaos-master-fp/blob/5257b4ee9dbaf749320e49fd83de11aadfd354ac/.github/workflows/lumen-mobile.yml#L82).

Choose a mobile tag prefix that cannot match Token Circles' existing `v*` production deployment trigger; `mobile-v*` is a candidate requiring final convention confirmation. A mobile tag should never accidentally deploy web/Worker production. Keep PR cancellation separate from signed archive/upload jobs; release jobs queue. Do not put a path filter on a combined push/tag release trigger. C: [release trigger separation](https://github.com/Komediruzecki/chaos-master-fp/blob/5257b4ee9dbaf749320e49fd83de11aadfd354ac/.github/workflows/lumen-mobile.yml#L43).

The sibling CI skips missing signing secrets during scaffolding. For Token Circles, distinguish “unsigned scaffold checks passed” from “release-ready”: a release gate should fail clearly if the requested signed artifact or upload cannot occur. Pin or deliberately select the supported Xcode runner; a floating `macos-latest` image is not a stable toolchain specification. Include lockfile/plugin changes in native compilation triggers, since a lockfile-only change can change native transitive dependencies.

Build numbers must remain monotonic across workflow renames and migrations; do not blindly reset to a new workflow's `github.run_number`. Unsigned PR Android/iOS builds, manual signed archives, internal distribution and store submission are separate gates. No store upload is authorized by the current planning task.

### Purchase engineering patterns

Keep `PurchasesPort`, `PaywallPort`, and server-owned entitlement resolution separate. Expose store-formatted price text; represent purchased/cancelled/pending as distinct outcomes. Distinguish renewal cancellation from entitlement expiry and grace period from revocation. M: [purchase contracts](/home/maff/foss/mercurypitch/packages/mobile-runtime/src/contracts.ts:124).

If RevenueCat is selected, `@revenuecat/purchases-capacitor` is the purchase bridge and `@revenuecat/purchases-capacitor-ui` is an optional paywall/customer-center layer; a bespoke Token Circles paywall can consume the purchase port. Android purchase Activity should be `standard` or `singleTop` to survive external payment verification. [RevenueCat Capacitor installation](https://www.revenuecat.com/docs/getting-started/installation/capacitor).

Adopt an explicit build-time distribution policy: reject mock purchases and Test Store keys from store releases; require the expected platform key when billing is enabled. A native debug APK still contains a production Vite bundle, so `import.meta.env.DEV` alone cannot identify store versus internal distribution. M: [build policy](/home/maff/foss/mercurypitch/packages/purchase-kit/src/build-policy.ts:37), [Beside Cue explanation](/home/maff/foss/mercurypitch/apps/beside-cue/README.md:64).

Do not copy Beside Cue's local review-unlock entitlement into a server-backed finance product. Token Circles already has accounts; use an appropriately prepared review account and documented access, without granting real backend entitlements from a client flag.

## 7. Execution loop to carry into the master plan

MercuryPitch's program plan has the right review cadence: surface brief, phone/tablet mocks covering every state, owner design sign-off, bounded implementation with matching screenshots, then an actual-device acceptance round. Its sign-off log records decisions and revisions rather than hiding them in chat. P: [per-surface loop](/home/maff/.dotfiles/personal/mercurypitch/plans/native-app-program-plan-2026-09-11.md:14).

Adapt it to Token Circles without carrying over its time estimates, music-specific phases, model assignments, or historic account-setup blockers:

1. Record product scope and unresolved decisions; produce the master architecture, billing economics, UX principles and screen/state map.
2. Produce a visual direction and interactive gallery with phone and tablet frames; review navigation and the highest-value flow first.
3. Scaffold a non-shipping independent native entry and testable platform contracts on the task branch; hold permanent identifiers and console configuration for an explicit decision.
4. Extract the first shared application service against existing desktop behavior; add a test that proves the real contract and fails when behavior changes.
5. Implement one approved mobile flow end to end, including error, offline, permission, keyboard and account states; verify desktop behavior still passes.
6. Repeat per surface; add store billing only after its product/region/entitlement decision is approved and server reconciliation is specified.
7. Run actual devices, signed build gates, privacy/store metadata and submission readiness. Existing Apple and Google business accounts are given; no new-account or 12-tester assumption belongs in this plan.

The reference principle is dependency direction plus evidence. Matching folder names or borrowing a large CI file without its current constraints would recreate the earlier failures.
