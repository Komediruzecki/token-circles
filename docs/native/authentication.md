# Native authentication and account-security proposal

Status: recommended design for review, not implemented. Endpoint names, token formats, lifetimes and table names below are proposed contracts. They must receive a recorded decision and security acceptance before development. Source baseline: Token Circles `fef628e6918eb1d80938c48c9c6eba2463ae642a`, inspected 2026-09-13. See the [product audit](research/product-audit.md#authentication-and-account-architecture), [reference audit](research/reference-architecture.md) and [architecture plan](architecture.md).

## Preserve the existing security boundary

Token Circles web authentication deliberately uses HttpOnly `fm_session` cookies, Secure outside development, `SameSite=Lax`, with a seven-day signed token and server-side `auth_sessions` revocation. `worker/src/auth.ts` verifies the user, token version and session record. Native planning must not replace this with MercuryPitch's browser token storage pattern. Leave existing web sign-in and cookie semantics intact while extracting credential verification and account-resolution services behind them.

The existing application API does not accept a normal native bearer session. PATs in `worker/src/apitoken.ts` are paid integration credentials restricted to `/mcp` and `/api/v1/*`, with deliberately different revocation behavior. They are not a first-party mobile session mechanism. The current web session listing filters to the seven-day window (`worker/src/routes/auth.ts`), so simply placing longer-lived native sessions in that table would create incorrect listing/cleanup behavior.

Native recommendation: dedicated short-lived opaque access credentials plus rotating refresh credentials, backed by separate D1 session records. Store the refresh secret only through an audited iOS Keychain/Android Keystore-backed credential-store adapter. Keep access credentials in memory and refresh/access token hashes on the server. Do not persist plaintext credentials in Preferences, localStorage, IndexedDB, SQLite, logs, analytics, crash attachments, screenshots, URLs or backup exports. A Keychain/Keystore-backed adapter necessarily retrieves a secret into app memory for transmission; it does not make a compromised running device harmless.

The secure-storage plugin remains undecided. The spike must inspect implementation, maintenance, encryption/key invalidation, backup/restore behavior, accessibility while locked, uninstall/reinstall semantics and failure reporting. Biometric app lock is a separate optional privacy feature. Avoid claiming that it encrypts finance data or reauthenticates the user to the Worker.

## Proposed session contract

| Item                            | Recommended starting value, subject to approval                            | Required behavior                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token                    | Opaque random 256-bit secret, proposed `tc_na_` prefix; 10-minute lifetime | Hash lookup resolves a live native session, existing user and current token version. Token is never an unsigned identity claim.                                            |
| Refresh token                   | Independent random 256-bit secret, proposed `tc_nr_` prefix                | Rotate on every successful renewal; store only its hash in D1 and its secret in the platform credential store.                                                             |
| Session lifetime                | 30-day idle expiry, 90-day absolute expiry                                 | Renewal extends idle expiry up to the absolute cap. Owner may select shorter values; devices show expiry and last use.                                                     |
| Native provider challenge       | 5 minutes, single-use, purpose/provider/app bound                          | Server generates nonce and binds a client PKCE challenge; proof from another ceremony/environment is rejected.                                                             |
| Login/second-factor transaction | 5 minutes, attempts bounded                                                | Provider proof is consumed before a separate second factor; pending state is not an authorized session.                                                                    |
| Browser completion code         | 60 seconds, one use, PKCE-bound                                            | Carries no session authority without the verifier; callback URL contains no access or refresh credential.                                                                  |
| Refresh replay                  | Revoke the session family and require sign-in                              | Application deduplicates renewal. Strict replay handling can force sign-in after a lost successful renewal response; this is an explicit V1 reliability/security tradeoff. |

Server responses containing credentials or proofs use `Cache-Control: no-store`; request logging and tracing redact authorization, cookies, token bodies, provider proofs and code/verifier values. Configure request/body limits. Token hash indexes must not expose raw tokens in error messages. Keep revoked/consumed refresh hashes until their replay-detection window expires; deleting them immediately loses family replay detection.

Successful native authentication returns a versioned shape:

```ts
type NativeSession = {
  state: 'authenticated';
  session: { id: string; idleExpiresAt: string; absoluteExpiresAt: string };
  user: { id: number; email: string; emailVerified: boolean };
  access: { token: string; expiresAt: string };
  refresh: { token: string };
};

type NativeAuthResult =
  | NativeSession
  | {
      state: 'second_factor_required';
      transaction: string;
      expiresAt: string;
      methods: Array<'totp' | 'recovery_code'>;
    }
  | {
      state: 'browser_required';
      continuationId: string;
      authorizationUrl: string;
      expiresAt: string;
    };
```

ISO timestamps above are illustrative contract choices; final schemas must align with existing API conventions. An opaque transaction secret conveys only authority to finish that named ceremony, not access to finance routes. Do not return internal provider subjects, token hashes, email lookup matches or identity-conflict account details.

## Proposed endpoint inventory

All new routes are on the selected Worker origin. `/api/native/v1` is an additive namespace; it does not reuse the existing PAT `/api/v1` namespace. Shared provider/credential services preserve existing web routes and their response behavior.

| Method and proposed path                               | Request / prerequisites                                                                                                                                                          | Response and security semantics                                                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/native/v1/capabilities`                      | No credential; fixed app build/platform parameters only if needed                                                                                                                | Versioned supported auth methods and server identity label. Never proof that a self-hosted server is trustworthy. No user, secret, subscription or account-existence information.                                                                 |
| `POST /api/native/v1/auth/challenges`                  | `{ provider: 'google' \| 'apple', purpose: 'sign_in' \| 'link', platform, appId, codeChallenge, codeChallengeMethod: 'S256' }`; link additionally requires recent authentication | `{ challengeId, nonce, expiresAt, providerConfiguration }`. Configuration contains only allowed public client IDs. Server chooses from a fixed environment/app registry; an arbitrary supplied client ID never becomes an allowed audience.       |
| `POST /api/native/v1/auth/provider`                    | `{ challengeId, idToken, authorizationCode?, codeVerifier, displayName? }`                                                                                                       | `NativeAuthResult`. Verify signature/claims/nonce, consume challenge atomically, resolve identity safely, preserve enrolled second factor. Display name is optional untrusted first-login metadata. Apple grant exchange is server-side.          |
| `POST /api/native/v1/auth/browser/start`               | `{ intent: 'sign_in' \| 'register' \| 'link' \| 'step_up', method?, codeChallenge, codeChallengeMethod: 'S256', platform, appId }`; link/step-up requires current session        | `{ continuationId, authorizationUrl, expiresAt }`. The callback target is server-selected from registered verified app links, not an arbitrary body URL.                                                                                          |
| `POST /api/native/v1/auth/browser/complete`            | Existing authenticated browser ceremony plus continuation binding and explicit account confirmation                                                                              | Issues one-time completion code and redirects through the registered app-link callback with code/state only. A generic web cookie alone must not complete a stolen or unrelated continuation. Browser-side CSRF/ceremony validation is mandatory. |
| `POST /api/native/v1/auth/browser/exchange`            | `{ continuationId, code, state, codeVerifier }`                                                                                                                                  | `NativeAuthResult` only after browser requirements are satisfied. Atomically consumes code. Method intent/account/server must match the original continuation.                                                                                    |
| `POST /api/native/v1/auth/second-factor`               | `{ transaction, method: 'totp' \| 'recovery_code', code }`                                                                                                                       | Authenticated session after existing policy/secret checks; recovery code consumed once. Attempt limits and expiration enforced.                                                                                                                   |
| `POST /api/native/v1/auth/refresh`                     | `{ refreshToken }`                                                                                                                                                               | Rotated `NativeSession`, or a typed rejection. Do not accept a web cookie or PAT as a refresh token.                                                                                                                                              |
| `POST /api/native/v1/auth/logout`                      | Native access token; allow a refresh-token revocation form if access expired                                                                                                     | Idempotently revokes this native session/family; app clears secure storage and account-scoped memory. No cookie mutation.                                                                                                                         |
| `GET /api/native/v1/account/sessions`                  | Native access token                                                                                                                                                              | Lists this user's web and native sessions using a common response projection, with `kind`, display label, last use, current flag and applicable expiry. Sensitive raw IP/user-agent details need a deliberate display policy.                     |
| `DELETE /api/native/v1/account/sessions/:id`           | Native access token; owned session only                                                                                                                                          | Revokes target web or native session; current-session revocation immediately signs out this client. IDs are resolved by typed/qualified identity to avoid cross-table ambiguity.                                                                  |
| `POST /api/native/v1/account/logout-all`               | Native access token; recent-auth decision recorded                                                                                                                               | Revokes web/native sessions and increments existing user token version, preserving documented PAT behavior.                                                                                                                                       |
| `DELETE /api/native/v1/account/identities/:identityId` | Owned identity and fresh step-up                                                                                                                                                 | Optional later endpoint, only after linking policy approved. Cannot remove the last usable sign-in method or detach a provider needed for unresolved account recovery.                                                                            |

For ordinary finance data, keep existing paths such as `/api/transactions` and `/api/profiles`. Add a narrowly reviewed native branch to shared authentication middleware, not a second set of finance route implementations. An explicit native Authorization credential is validated as native; an invalid/expired one never falls back to an ambient cookie. An unexpected token family fails rather than becoming a PAT bypass. Set the same Hono user/profile authorization context after success; represent session kind explicitly where downstream code currently assumes `auth_sessions`.

Current `/api/auth/logout-all`, password reset, security-setting changes and account deletion must also revoke appropriate native sessions. Their web behavior remains the same for web clients. The existing devices UI may later adopt the combined listing through an additive response or separate endpoint; do not silently change its old response shape.

Keep `DELETE /api/account` as the shared account-deletion operation, preserving its current confirmation contract. For native sessions, require a fresh reviewed step-up before destructive deletion; the exact proof/recency contract is an implementation-gate decision. This extra native requirement is proposed, not a description of today's route. A first-party native account must retain an accessible deletion path even when a store purchase cannot be cancelled directly through that operation.

Use a stable error envelope such as `{ error: { code, message, requestId, retryAfterSeconds? } }`: `invalid_request` (400), `authentication_required` / `reauthentication_required` (401), `step_up_required` / `forbidden` (403), `ceremony_expired` (410), `rate_limited` (429), and `temporarily_unavailable` (503). Keep account-resolution responses neutral and avoid revealing which email/provider combination exists. A valid second-factor-required result is an explicit pending state, never an authenticated 200 response that a generic client can mistake for success. Final error naming must align with the shared client schemas.

Apply server-side rate limits independently to challenge issuance, provider verification, browser starts/exchanges, second-factor attempts, refresh and revocation. Combine IP limits with challenge/session and privacy-preserving account-key limits where applicable; shared network addresses alone cannot identify an attacker. Proposed starting second-factor limit: five failures per transaction, then invalidate it. Other thresholds are configuration values to approve against existing auth limits and expected traffic. Invalid client-side retry behavior must not bypass a server limit. Return a bounded retry hint, enforce it on the server, expire abandoned records and test limits at their boundary. Never add a production captcha bypass because the native WebView cannot render the web challenge.

## Native Google and Apple flow

Use `@capgo/capacitor-social-login` behind a typed provider port as the initial plugin candidate. The audited MercuryPitch 8.5.7 integration expects `{ provider, result }`, configures Android Google with a web client ID, uses the iOS client and server client IDs appropriately, and initializes Apple only on iOS. Incorrect empty Apple configuration blocked Google initialization on Android in that integration. Treat cancellation as a normal outcome and failed lazy initialization as retryable. Verify current upstream API and selected plugin version before implementation. [Capgo social-login source](https://github.com/Cap-go/capacitor-social-login)

The Worker first issues a fresh challenge with a nonce, expected issuer/audience/provider/app/environment, S256 challenge and expiry. The app supplies that nonce using the selected plugin's verified platform semantics, invokes native sign-in, then sends proof and verifier to the Worker. Server validation checks signature via the provider's published keys, algorithm allowlist, issuer, expected audience/authorized-party constraints, expiry and required claim semantics. Google `sub` and Apple `sub` are provider-scoped identity keys. Normalize nonce encoding only according to the verified plugin/platform contract; a test must catch hashing twice or comparing the wrong representation. If a selected Google platform flow cannot bind the server nonce, use the reviewed browser authorization-code/PKCE path until a secure native variant is proven.

Consume a challenge conditionally and atomically so two requests cannot both redeem it. Invalid proof must not create an account or session. Do not trust a caller-supplied nonce and compare it only with the same caller's token; the challenge must exist on the server and be bound to this ceremony. Check replay even after provider verification has succeeded. Rate-limit challenge issuance and proof attempts.

Google's existing Token Circles and MercuryPitch implementations use `tokeninfo`; the native implementation should use proper local JWT/JWKS verification, with bounded key caching and rotation behavior, because Google's backend guide describes `tokeninfo` as a debugging mechanism. Google also distinguishes Gmail/Workspace authority from other email domains. [Google backend authentication guide](https://developers.google.com/identity/sign-in/android/backend-auth)

Apple implementation is new for Token Circles. Implement Apple token verification, server-held client-secret signing material, authorization-code exchange where required, grant retention/revocation and server notifications as separate reviewed services. A retained provider refresh grant is encrypted with server-managed key material and key-version metadata, unlike the hashed first-party refresh tokens; grant decryption is necessary for later provider revocation. Client secrets/private keys never enter mobile environment variables or source. MercuryPitch's newer Worker work is a reference, not code to transplant blindly. Confirm Apple audience/client identifiers and platform support per app; do not show a configured Apple button on Android until the chosen supported browser/provider path passes there.

## Identity linking and existing accounts

Introduce a provider identities relation keyed uniquely by `(provider, subject)` and owned by an existing user ID. Do not overwrite `users.auth_provider/provider_id` on each new sign-in. Backfill existing Google identity rows without changing user IDs, profiles, Stripe customers or passkeys; enumerate and resolve conflicts before applying a uniqueness constraint or changing lookup behavior.

Resolve a provider proof by provider+subject first. If it has no identity and an email resembles an existing account, return a neutral account-resolution flow that requires the user to authenticate that account and explicitly link the new provider. Do not silently auto-link by email, including Apple private-relay email. Provider email and account contact email can differ; store provenance and verification semantics. Apple name/email may be supplied only initially, so returning sign-in must not require them.

The default proposal is one primary account with multiple verified methods and no automatic account merge. Linking requires a fresh account ceremony and a provider challenge with `purpose: 'link'` bound to that same user/session. A provider identity already attached elsewhere cannot be reassigned. Unlinking requires another working method and fresh authentication. Recovery and explicit account merge need separate product/security decisions, not an ad hoc support bypass.

Existing web Google resolution includes email linking in `worker/src/auth.ts`; modifying that policy globally is a migration/security phase, not mobile scaffolding. Record the transitional behavior explicitly and add regression coverage before converging web and native resolution. Merely extracting the existing helper would inherit its unsafe-to-assume linking policy.

## Email, captcha, second factor and passkeys

Recommended first secure slice: native provider buttons plus a system-browser continuation for the existing email/password, registration, email-code, captcha, passkey and account-recovery ceremonies. This reduces the chance that a second implementation loses policy, while retaining custom native welcome/account UI. It is a visible UX tradeoff needing owner approval. Direct native email forms can follow only after equivalent challenge/captcha/2FA contracts are specified and tested; this plan does not invent a bypass or claim complete native email interaction is already solved.

The continuation opens the trusted web frontend associated with the selected Worker, using a one-time server record and client-generated high-entropy PKCE verifier. It performs the current browser flow, confirms the account being connected, and returns only a short-lived completion code/state through a registered verified app link. The app checks the expected continuation/state/server and redeems the code with its verifier. Web cookies never move into app storage. Unknown, expired, duplicate, warm-start and cold-start callbacks have explicit outcomes. Do not silently connect whichever unrelated account happens to have a browser cookie.

Current email-code sign-in is tied to a signed browser challenge cookie (`worker/src/routes/email-code.ts`); an app posting an email and code without equivalent binding is not the same ceremony. TOTP and recovery codes also depend on pending authentication state. Registration and password reset use captcha and neutral responses. Reset consumes a one-use token and intentionally does not issue a session. Email verification also does not sign in. Preserve these behaviors; return to native sign-in after verification/reset rather than minting a session from an email link alone.

Use the existing browser routes for reset/verify initially and provide a deliberate “return to app” continuation. Keep reset tokens/fragments away from analytics, app logs and navigation history exports. A reset originating on another device still needs a useful browser completion path. Self-hosted deployments must advertise a configured trusted web origin; do not guess it from user-controlled redirect parameters.

Passkeys are currently web RP/origin credentials. `window.PublicKeyCredential` detection in `frontend/src/core/webauthn.ts` is not evidence they work within WKWebView or Android WebView. Validate platform association, credential IDs and server accepted origins with real pre-existing credentials before a native passkey adapter ships. Until then, system-browser continuation is the proposed supported path for passkey-only users. Never strand such users behind an email-password form they cannot use. Web passkey functionality remains intact.

## Transport and self-host trust spike

Compare explicit Capacitor native HTTP with WebView `fetch` on real iOS/Android; neither is selected by this document. Test TLS rejection, cancellation, timeout, streamed/binary files, multipart receipts, response parsing, redirects, IPv6, poor connection and emulator/device differences. Avoid global fetch patching. Whichever adapter wins owns origin pinning, authorization injection and error normalization behind `api-client`.

For WebView fetch, native resource traffic uses `credentials: 'omit'` and a native-origin CORS allowlist independent of existing credentialed web origins. Requests identified as coming from those native origins must require the native credential and must not authenticate from an ambient web cookie; preflight, simple requests and error responses all need coverage. For native HTTP, CORS is not the security barrier; server token checks and host validation still are. Do not widen `CORS_ORIGIN` to arbitrary origins or send cookies to custom hosts to make an initial test pass. The source audit found no general mutation Origin/CSRF middleware; preserve web behavior and review the effect of any CORS/auth change explicitly rather than assuming existing protection.

Self-host support requires a separate trust screen and explicit server selection before credentials are entered. Proposed V1 URL rules: HTTPS, canonical origin only, no userinfo/query/fragment, and no cross-origin redirects. Managed host is a shipped constant, not remote user content. Any development HTTP/LAN exception is isolated from signed builds; support for private-network servers is a separate decision. Reject malformed/protocol-relative endpoint paths, unexpected absolute URLs and redirects that could forward an Authorization header. Never proxy arbitrary user hosts through the managed Worker.

Fetch capabilities without credentials first, then explain that the chosen server operator receives this account's finance data and credentials intended for that server. A capabilities response is compatibility information, not a trust attestation. Bind challenge, session, secure-store key, cache and profile data to the canonical server/environment. Never send managed tokens or provider proof issued for another environment to a self-hosted URL. OAuth provider configuration for a self-hosted server must be explicitly supported; a server with no configured provider offers approved fallback methods instead of using managed client IDs opportunistically.

## Persistence and revocation design

Proposed additive entities, with final names selected only after inspecting all migrations at implementation time:

| Entity                           | Essential fields / invariants                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_identities`                | ID, user ID, provider, subject, email/provenance if needed, timestamps; unique provider+subject; explicitly owned                                                       |
| `auth_native_challenges`         | Opaque ID, nonce hash, S256 challenge, provider/app/environment/purpose, optional linking user/session, expiry, consumed timestamp, attempt metadata                    |
| `auth_native_login_transactions` | Hashed transaction secret, verified identity/user, permitted next step, expiry, attempts, consumed timestamp; no finance access                                         |
| `auth_native_sessions`           | ID, user ID, captured user token version, creation/last use/idle/absolute expiry, revoked timestamp/reason, current refresh generation, untrusted device label/platform |
| `auth_native_refresh_tokens`     | Session ID, generation, unique token hash, issued/expiry/used/revoked times; consumed hashes retained for replay detection                                              |
| `auth_native_access_tokens`      | Unique token hash, session ID, expiry; no stored raw secret; bounded count/cleanup                                                                                      |
| `auth_native_continuations`      | ID, S256 challenge, intent, selected method/app/server, hashed completion code, browser ceremony binding, confirmed user, expiry/consumption                            |
| `auth_provider_grants`           | Owned identity, encrypted provider grant, encryption key version, provider metadata and revocation state; only if provider lifecycle requires it                        |

These are conceptual entities, not an instruction to add eight tables unchanged. Consolidate equivalent ceremony records only if invariants stay explicit. Do not select a migration number now: the audited tree ends at `0030`, and concurrent work can advance it. All merged migrations are append-only; `0001_init.sql` already reserves the retired `sessions` name. Avoid `CREATE TABLE IF NOT EXISTS` masking a schema collision. Use D1-supported transactional/batch operations with conditional consumption and verified affected-row behavior. A read followed by an unconditional write is not single-use under concurrency.

Refresh rotation must atomically consume the current generation and issue the next one; no second request can create another live successor. A used refresh token resolves back to its session so replay can revoke that family. Expired, revoked, missing-user and token-version-mismatch sessions fail. An access token lookup checks live session revocation, so revocation does not wait for its ten-minute expiration. Hashing opaque first-party secrets permits validation without recovering the original secret.

The client serializes refresh, writes the replacement refresh secret successfully before treating renewal as durable, and clears state/requires sign-in if persistence fails. With strict replay rejection, a lost response or process death between server rotation and secure-store replacement can require reauthentication. Do not quietly add an unbounded previous-token grace window. If the owner prioritizes seamless recovery, design and review a tightly bounded idempotent renewal protocol separately.

Keep the existing logout-all meaning for integration PATs; do not revoke them accidentally when adding native sessions. Password reset, account deletion, user-token-version changes and relevant security resets must make native access unusable. Add cleanup to account deletion before new entities ship, including encrypted Apple grants and out-of-band provider-revocation work as appropriate. Account deletion and store-subscription cancellation are separate lifecycles, covered by the commercial plan.

## Client states and recovery

```text
booting -> local_workspace | signed_out | restoring_session
restoring_session -> authenticated | offline_locked | signed_out
signed_out -> provider_pending | browser_pending
provider_pending/browser_pending -> second_factor_required | authenticated | signed_out
authenticated -> renewing -> authenticated | offline_locked | signed_out
authenticated -> signing_out -> signed_out
```

Cancelled provider/browser interaction returns to sign-in without a red failure banner. A network failure offers retry without claiming that credentials were invalid. Expiry/revocation requires sign-in and retains only approved account-scoped drafts. `offline_locked` means cloud authorization cannot currently be renewed; a separate privacy/cache policy determines which previously downloaded data can be read, never whether a write is remotely saved. Local-workspace use remains independent from cloud authentication.

Do not automatically retry mutations after an uncertain network result. A refresh-triggered retry is safe only when the server demonstrably rejected authentication before dispatching the mutation, or that operation has an approved idempotency contract. Preserve draft intent and show a clear reconciliation path for an uncertain save. Log out clears secret material even if the server cannot be reached; disclose that offline device revocation needs confirmation later and offer sign-out-everywhere from an online session.

## Required regression and device evidence

New tests must fail if the guard or behavior is removed. Run server cases in the repository's real Worker/D1 test environment, not only mocked repositories.

| Risk                          | Required failing regression / device case                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider impersonation/replay | Wrong issuer/audience/app/nonce/signature/expired token fails; unknown key rotation handled safely; simultaneous challenge redemption yields at most one successful continuation; wrong PKCE verifier fails            |
| 2FA bypass                    | Valid Google/Apple/password/email proof for a 2FA account grants no finance access before second factor; used recovery code and expired/over-attempt transaction fail                                                  |
| Account takeover/linking      | Matching email alone cannot link; Apple relay does not duplicate/overwrite known subject; identity attached to another user cannot move; stale link session and last-method unlink fail                                |
| Session isolation/revocation  | Native invalid bearer never falls back to cookie; PAT cannot enter ordinary routes; other user's session deletion fails; logout-all/reset/deletion revoke native access immediately; web-cookie baseline remains green |
| Rotation races                | Two refreshes cannot produce two active successors; old-token reuse revokes family; expiry/absolute cap/token-version mismatch fail; failed secure-store write and lost response require the documented recovery       |
| Browser callback theft        | Wrong state, verifier, environment, app, account or continuation fails; callback replay fails; denied/cancelled browser route issues no credential; cold/warm callback behaves once                                    |
| Captcha/recovery regression   | Browser registration/login/reset/email-code gates remain enforced; reset/verify do not issue sessions; pending email-code binding cannot be swapped between ceremonies                                                 |
| Origin/host leakage           | Custom server never receives managed credentials; cross-origin redirects/path injection rejected; fetch cookie credentials omitted for native; unknown native origin denied without widening web cookie CORS           |
| Profile and data ownership    | Native token enters the existing owned-profile guard; captured write profile cannot change beneath an open form; household read never adds another user's profiles                                                     |
| Credential persistence        | Device restart/locked state/backup restore/uninstall policy tested; raw secrets absent from local databases, logs and generated backups; invalidated key presents recoverable sign-in                                  |
| Provider/device completeness  | Google on Android/iOS with correct console certificates/clients, Apple on approved platforms, cancellation, provider app absent, network loss, revoked grants, existing passkey-only browser continuation              |

The security phase finishes with a concise evidence report listing actual devices/OS versions, selected plugin versions, test results and unresolved limitations. Passing an emulator sign-in screen alone does not establish release readiness.

## Decisions awaiting the owner

- [ ] Approve additive native sessions and proposed lifetimes, strict refresh replay policy and device-cache privacy behavior.
- [ ] Approve Google/Apple provider coverage by OS and the browser continuation tradeoff for email/captcha/passkeys/recovery in the first secure slice.
- [ ] Approve explicit identity linking, no automatic merge and the migration of existing provider identities.
- [ ] Decide whether self-hosted sign-in ships in V1 and which URL/provider configurations it supports.
- [ ] Approve the secure-store and transport spike evidence before installing production adapters.
- [ ] Approve the final endpoint/schema review, backfill/rollback strategy and security regression list before Worker changes.
- [ ] Approve biometric privacy lock and direct native email/passkey extensions separately if they are desired.

This plan supplies concrete decisions and testable contracts; it does not authorize dependent implementation until the phase decision is recorded.
