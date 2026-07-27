# Research & Plan: Bank Connectivity (Erste / Revolut / aggregators) + Encryption

Status: **research + proposal for decision** — companion to
[`import-automation.md`](./import-automation.md) (the shared "Connected Sources"
pipeline that any bank feed plugs into) and to the existing
[`../e2ee-research.md`](../e2ee-research.md). Sourced July 2026; items marked
_(verify)_ need first-hand confirmation in a provider portal before building.

---

## Part A — Bank connectivity

### Verdict up front

| Account                             | Best route                                | Cost                       | Effort       | Notes                                                                       |
| ----------------------------------- | ----------------------------------------- | -------------------------- | ------------ | --------------------------------------------------------------------------- |
| **Personal Erste HR (George)**      | Aggregator (**Enable Banking** free tier) | **€0**                     | Low–Med      | Erste HR listed **live**; _(verify your retail account authorizes)_         |
| **Personal Revolut**                | Aggregator (**Enable Banking**)           | **€0**                     | Low–Med      | No public personal API exists; aggregator-only                              |
| **Revolut Business (the obrt)**     | **Revolut Business API** (official)       | **€35/mo** (Grow plan, HR) | Med          | Real `GET /transactions`; refresh token persists (no 90/180-day re-consent) |
| **Any of the above, zero red tape** | **Manual statement export → import**      | €0                         | Low (manual) | George exports CSV/XLSX/JSON/PDF; Revolut app exports too                   |

**There is no first-party "fetch my own data" API for Erste HR or personal
Revolut.** Both are reachable only by a _licensed TPP_ (AISP) — which in practice
means going through an aggregator that holds the licence for you. The single best
fit is **Enable Banking's free "Restricted Production"** tier.

### Erste Bank Croatia (George)

- Erste&Steiermärkische Bank d.d. exposes a real **PSD2 XS2A API** (Berlin Group
  NextGenPSD2). Dev hub `https://developers.erstegroup.com` (self-serve sandbox),
  Croatia TPP page `https://www.erstebank.hr/en/open-banking/for-tpp`.
- **Production is TPP-only:** you must be a licensed AISP and present **eIDAS
  certificates** (QWAC for TLS + QSealC for signing, carrying the `PSP_AI` role
  and your NCA number). Only the non-PSD2 **Corporate API** works without
  certification.
- **An _obrt_ can legally become a registered AISP** with the Croatian National
  Bank (HNB explicitly allows a "natural person pursuing a business activity"):
  no minimum capital, but **professional indemnity insurance**, ICT-security /
  business-continuity / incident-reporting documentation, a ~3-month decision
  window + months of prep, and the licence may be used **for nothing but reading
  account data**. eIDAS certs run **~€350–8,000/yr** (single QWAC from Actalis
  ~€358; a full PSD2 QWAC+QSealC pair realistically €3–8k/yr). Croatian QTSPs:
  **FINA**, **AKD** _(whether they issue the PSD2-role variant is unconfirmed)_.
  → **Disproportionate** for syncing your own accounts.
- **Manual export is officially supported and zero-friction:** George exports
  account history as CSV / XLSX / JSON / MS-Money / signed PDF, date-filtered —
  exactly what the import pipeline consumes today.
- **ErsteConnect** (corporate multibanking, aggregates Erste + 50+ CEE banks
  "without a PSD2 certificate") is a **contract-based corporate cash-management**
  product — worth a phone call _only if_ your obrt has an Erste business account.
- **Scraping George is not viable** — SCA/2FA (hardware token / mToken) blocks
  headless login and it's against bank ToS. Avoid.

### Revolut

- **Business API (official, recommended for the obrt account):**
  `GET /transactions` (reverse-chron, ≤1000/page, `from`/`to`/`account`/`state`
  params, time-based pagination), plus `GET /accounts` for balances. Auth =
  X.509 key pair + **RS256 client-assertion JWT** + OAuth authorization-code;
  the **refresh token persists**, so you sync indefinitely with **no periodic
  re-consent** (unlike PSD2 aggregator access). Free **sandbox**
  (`sandbox-b2b.revolut.com`); production `b2b.revolut.com`.
  **Gating:** requires a **Grow plan or above — €35/mo (or €360/yr) in Croatia**;
  not on the free/Basic plan.
- **Personal Revolut: no public self-service API.** Revolut is itself a licensed
  TPP; personal accounts are exposed only via its PSD2 Open Banking API, which is
  restricted to regulated TPPs with eIDAS certs. → reach personal Revolut **only
  through an aggregator**.

### Aggregators — what to actually use

What the incumbents use: **YNAB** → Plaid + MX; **Monarch** → Plaid/Finicity/MX;
**Copilot** → Plaid + proprietary; **Lunch Money** → Plaid + plugins. MX and
Finicity are **US-only**; Plaid is US-centric and **does not cover Croatia**. The
EU-capable set is GoCardless/Nordigen, Tink, TrueLayer, Salt Edge, Enable Banking.

| Provider              | Croatia / Erste HR                                           | Revolut       | Free for _own_ data?                                    | Self-serve?        | Licence covers you?   | Verdict                                   |
| --------------------- | ------------------------------------------------------------ | ------------- | ------------------------------------------------------- | ------------------ | --------------------- | ----------------------------------------- |
| **Enable Banking**    | **Erste HR live** _(verify)_; ZABA/PBZ/RBA live; OTP not yet | Yes           | **Yes — "Restricted Production"** (own linked accounts) | **Yes**            | Yes (AISP)            | **Recommended**                           |
| GoCardless (Nordigen) | Yes (historically)                                           | Yes           | Was free & generous                                     | —                  | Yes                   | **Closed to new signups since ~Jul 2025** |
| Plaid                 | **No (Croatia not covered)**                                 | Yes elsewhere | Sandbox only                                            | Partly             | Yes                   | Ruled out                                 |
| Tink (Visa)           | Plausible _(unconfirmed)_                                    | Likely        | Sandbox only                                            | **No (sales-led)** | Yes                   | Too enterprise                            |
| TrueLayer             | **No (HR not in AIS markets)**                               | Likely        | Test only                                               | No                 | Yes                   | Ruled out                                 |
| Salt Edge             | Likely                                                       | Likely        | **Fake providers only** on free tier                    | No (contract)      | Yes (Partner Program) | Real data needs a contract                |

**Recommended: Enable Banking, free "Restricted Production."** The one option
that is simultaneously self-serve (no sales call, **no KYB** on the restricted
path), free for syncing _your own_ accounts, covers Erste HR + Revolut, and
carries the AISP licence.

Onboarding (expected cost **€0**):

1. Sign up at enablebanking.com → Control Panel.
2. Create an application; generate a key pair; register redirect URL (API auth =
   **JWT signed with your private key**).
3. Activate Restricted Production by **linking your own accounts** (no
   contract/KYB on this path).
4. `GET /aspsps?country=HR` → pick Erste (and add Revolut).
5. `POST /auth` → redirect yourself to the bank's SCA (Erste hardware token /
   mToken; Revolut app) → `POST /sessions`. Set `valid_until` up to **~180 days**.
6. `GET /accounts` → `/accounts/{id}/balances` + `/accounts/{id}/transactions`.
   **Pull full history (1–3 yrs) on the first sync** (within the ~1-hour window
   after consent; afterward many banks restrict to the last ~90 days per call),
   then incremental daily/weekly.
7. Re-consent each account ~every 180 days via the same SCA redirect.

**PSD2 re-auth is 180 days, not 90** — the EBA amended the RTS (EBA/RTS/2022/03,
applicable 25 Jul 2023) and added a mandatory SCA exemption for AISP access.
Individual banks may still require sooner.

**When you'd pay:** only if you open the app to _other_ users → full production
needs a contract + KYB + volume pricing (per connected account/mo, monthly
minimum, **sales-quoted — not public**). Restricted Production is limited to
accounts you link yourself — respect that boundary.

### How a bank feed plugs into the app

Reuse the shared pipeline (see companion doc). New pieces:

- **`AggregatorAdapter`** — Enable Banking client (JWT auth, session mgmt) →
  fetch transactions → **normalize to the canonical header set**
  (`core/bankImport/canonical.ts`, engineered so `autoDetectMapping` maps it 1:1)
  → feed `execute`.
- **`external_id`** — store the bank's stable transaction id on each row (new
  nullable column + unique index on `transactions`) for DB-level idempotency and
  a real incremental cursor (`lastCursor` on the source). This is cleaner than
  the derived-fingerprint dedup for a live feed.
- **Home:** the Worker (it must hold the Enable Banking app key + per-user
  session tokens — **encrypted at rest**, see Part B) + a **cron** daily pull
  (existing `scheduled` handler). Re-consent is a 180-day SCA redirect surfaced
  in Settings.
- **Runtime note:** bank sync is inherently a _cloud-mode_ feature (needs a
  server to hold tokens and run the pull). Local-only mode keeps manual import.

**Caveats to verify first:** (1) Erste HR _live_ status for **your specific
account type** (retail vs obrt/business) — test with real credentials early;
(2) free-tier account cap / rate limits (not published); (3) each provider's DPA
controller/processor split before storing data.

### Recommendation for you, concretely

- **Obrt (business) account → Revolut Business API** if that account is on
  Revolut (€35/mo Grow, no re-consent friction). If the business account is at
  **Erste**, ask Erste about **ErsteConnect**.
- **Personal Erste HR + personal Revolut → Enable Banking free tier.** Verify
  Erste HR authorizes your account before investing.
- **Baseline that always works today → manual George/Revolut export → import.**
  Given the app already imports statements, this is the pragmatic €0 fallback and
  a fine starting point while you test the aggregator path.

---

## Part B — Encryption audit & plan

Most of this is already answered by [`../e2ee-research.md`](../e2ee-research.md)
(sourced, thorough). This section **audits current state** and adds **what bank
sync changes**.

### Current state (audited against the code)

- **At rest + in transit is already the accepted baseline.** Cloudflare **D1 and
  R2 are AES-256 at rest by default + TLS in transit**; auth is a stateless
  **HS256 JWT in an httpOnly cookie** (`worker/src/auth.ts`) with `token_version`
  revocation. GDPR Art. 32 treats encryption as an _example_ measure, not a
  mandate — **the stack already meets the compliance baseline.**
- **No E2EE today.** Server sees plaintext transactions (required for
  server-side reports, email reminders with amounts, PDF rendering).
- **Password hashing is PBKDF2-SHA256 at 100k iterations** (Workers CPU cap,
  `auth.ts`) — acceptable but below current OWASP guidance; note for a future
  bump / Argon2id-in-WASM.
- **`SECURITY.md` is stale** — it describes the deprecated Express stack, not the
  Worker. Quick win: rewrite it + add `security.txt` (RFC 9116) + GitHub private
  vulnerability reporting (all free) — this is e2ee-research's "Stage 0".
- **Google OAuth stores no token** (sign-in only, scope `openid email profile`) —
  so today there is _no_ long-lived third-party secret at rest.

### What bank sync / storage sync ADDS

The automation features introduce **long-lived secrets the server must be able to
use**: Google Drive/Sheets **refresh tokens**, Enable Banking **session tokens**,
a Revolut **refresh token**, plus richer bank transaction data. These are
high-value and change the threat model.

- **Token-at-rest encryption (do this before storing any of them):** keep the
  provider _app_ secrets in **Workers Secrets / Secrets Store**; encrypt each
  **per-user token** at rest with a Worker-held key using an envelope scheme
  (AES-256-GCM data key wrapped by a KEK in Secrets). This is standard
  server-side encryption, **not** E2EE — and it's the right bar here.
- **The unavoidable tension:** anything the **server** must use to sync (OAuth /
  bank tokens) **cannot be end-to-end encrypted** — the server needs the
  plaintext to call the provider. This is exactly what e2ee-research and Actual
  Budget document: _"bank-sync tokens live outside the E2EE envelope."_ So bank
  sync and full E2EE are **partially in tension by design**; token-at-rest
  encryption is the correct, achievable protection.
- **Bank transaction _data_** could still ride a future E2EE track for the
  fields the server doesn't need server-side — but if you keep server-side
  reports/reminders, that data must stay server-readable too. Decide per feature.

### EU regulatory recap

- **GDPR:** bank transactions are personal (and financially sensitive) data →
  lawful basis, data minimization, retention limits, erasure/access support.
  **Art. 34(3)(a):** a breach of _properly encrypted_ data waives user
  notification — encryption shrinks blast radius even without E2EE. The **household
  exemption** may cover purely-personal own-account use, but operating an **obrt**
  and/or ever processing a third party's data makes you a **controller**. Keep it
  single-user/own-accounts to stay in the lightest regime.
- **PSD2** governs the _access_ (handled by the aggregator's licence).
- **SOC 2 / PCI:** not needed now. Stripe Checkout keeps you at PCI SAQ-A; never
  persist full card PANs from bank imports.

### Effort & recommendation (from e2ee-research, unchanged)

- **Stage 0 (now, ~1–2 wk, ~$0):** honest SECURITY.md + security.txt + private
  vuln reporting + JWT/secret-rotation hygiene. **Plus: token-at-rest envelope
  encryption** as a prerequisite for the sync features.
- **Stage 1 (Actual-style E2EE of synced data, ~4–8 wk):** separate encryption
  passphrase, Argon2id/PBKDF2≥600k, per-user DEK wrapped by a password KEK,
  mandatory printable recovery key, AES-256-GCM client-side. Precondition: make
  the server store opaque blobs — decide _before_ building a real sync engine.
- **Stage 2 (~2–4 mo):** client-side receipt encryption, key rotation, threat
  model. Server-side reports/reminders must move client-side or degrade.

**Recommendation:** ship any E2EE **free on every tier** (the pattern everywhere
E2EE exists; and AGPL makes the implementation public anyway). But treat **bank
sync** and **full E2EE** as **separate tracks** — do **token-at-rest encryption
now** (required, cheap), and pursue transaction-data E2EE only if/when you're
willing to move reports and reminders client-side. E2EE remains a genuine
differentiator: no mainstream budgeting app can offer it, precisely because their
server-side bank aggregation forbids it.

### Open decisions

1. Token-at-rest scheme — Workers Secrets KEK + per-user AES-GCM DEK (recommended)
   — approve before storing any OAuth/bank token.
2. Do we open the E2EE (Stage 1) track now, or after the sync features ship?
3. Refresh `SECURITY.md` + add security.txt as a standalone quick win now?
4. Password KDF bump (Argon2id-WASM or PBKDF2 ≥600k) — in scope or later?
