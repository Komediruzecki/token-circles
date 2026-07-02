# Go-Public & Customer-Readiness Audit

**Date:** 2026-07-02
**Scope:** whole monorepo — live Cloudflare Worker plane (`worker/`), SolidJS frontend (`frontend/`), deprecated Express self-host stack (`backend/`), infra, docs, deps, legal/GDPR.
**Method:** 7 parallel domain auditors → adversarial verification of every high/critical finding → prioritized synthesis. 65 findings collected, 19 high/critical verified (1 refuted, 18 upheld). Cross-checked against independent manual spot-checks.

---

## Verdict

| Gate | Score | Verdict |
| --- | --- | --- |
| **Public repo (AGPL)** | **30 / 100** | Blocked by two trivial deletions (live-infra vhost configs + internal AI-workflow doc) and the absence of legal docs to accompany a live billing product. **No secret leak** — publishable from a credentials standpoint. |
| **Paying customers** | **18 / 100** | Not launch-ready: no Privacy Policy/ToS, GDPR erasure disabled in prod, no VAT collection, unvalidated money inputs on the live plane, zero error tracking/alerting on billing. |

**The single hardest gate is legal/compliance, and it gates both.** Everything else is bounded, verified engineering/ops work — a sequencing problem, not a discovery problem.

**Secrets gate — GREEN (independently confirmed):** no live/secret credentials in the working tree or git history. The root `.env` ever committed held only `APP_PORT/PORT/NODE_ENV`. Tracked env/config files are public config only (storage mode, localhost URLs, Turnstile *site* key, dev domain, dev D1 UUID, Google OAuth client id, Stripe *test* price ids — all publishable). Recommend a final `gitleaks` pass before flipping visibility to be certain.

---

## Blockers

### Both public-repo and customers
1. **No Privacy Policy, Terms of Service, Imprint/Impressum, or cookie/consent** anywhere (verified: zero legal artifacts repo-wide; no consent capture at signup; bare Vite `index.html`; no legal routes in the worker). An EU operator (`tokencircles.com`) processing financial PII cannot lawfully charge consumers without GDPR Art.13/14 transparency, a ToS (the billing contract), and a DE/EU Impressum. Stripe's own terms require a published privacy + refund policy. *Effort: medium. Start now — it gates everything.*

### Public repo
2. **Delete leaked production infra** — `apache/finance-manager.clodhost.com-ssl.conf` + `ready.clodhost.com-ssl.conf` (real hosts, cert paths, `/var/www` layout, internal port `127.0.0.1:3847`) and `docs/cl_workflow.md` (real repo slug, internal `claude-wip` AI-workflow, prod `/var/www` path). The `clodhost.com` / `/var/www` leak also bleeds into `frontend/sw.js:62`, `public/sw.js`, `deploy.sh`, and several `docs/` files — deleting `apache/` is necessary but not sufficient. *Effort: trivial.*

### Customers
3. **Enable account deletion in production (GDPR Art.17)** — `worker/src/routes/account.ts:72` hard-refuses with 501 when `APP_ENV==='production'`; UI hidden in prod. The atomic D1-batch + R2-purge + Stripe-delete handler is already complete — it's simply blocked. *Effort: medium (unblock + ensure it also clears reminder_sends/stripe_events/rate_limit/used password_resets + cancels subs).*
4. **Add server-side schema validation to money-mutating worker routes** — the live worker uses **no** zod/valibot (confirmed). `POST /api/transactions` binds untyped `amount`/`type`/`account_id` straight into balance arithmetic (`transactions.ts:517-636`); a client can send `amount` as a string, `1e308`, fractional cents, or `type:'foo'` and corrupt persisted balances. The deprecated Express backend already validates every field with Zod — port those schemas. *Effort: medium.*
5. **Error tracking + alerting + uptime** — no Sentry/Datadog; worker has 4 `console.*` calls; `index.ts:111` `onError` returns a 500 without logging; Stripe/email errors swallowed with `.catch(()=>{})`. A silently-failing webhook strands a paying customer on `free` with nobody paged. *Effort: medium.*
6. **Stripe Tax / VAT + billing address + tax-ID at checkout** — `billing.ts:95` builds the session with no `automatic_tax`, `customer_update[address]`, `tax_id_collection`, `billing_address_collection`, or `invoice_creation`. Every EU sale is booked VAT-exclusive → operator personally liable for uncollected VAT and issues invoices with no VAT breakdown. *Effort: medium.*
7. **Sub-processor disclosure + DPAs + EU-US transfer basis** — confirmed outbound to Stripe, Resend, Google OAuth, Cloudflare, and **Yahoo Finance (leaks the user's exact holdings/tickers on every portfolio refresh)**. No sub-processor list, no DPAs, no SCC/transfer docs (GDPR Art.28 + Ch.V). *Effort: medium.*
8. **Data-retention policy + purge cron** — no retention cron, no `deleted_at`/last-activity on users, expired/used `password_resets` never purged; PII kept indefinitely with prod deletion disabled (Art.5(1)(e) storage-limitation). *Effort: medium.*

---

## Quick wins (high impact / low effort)

1. **(trivial)** Delete `apache/` + `docs/cl_workflow.md` — removes the live-infra map and internal AI doc in one commit (blockers #2).
2. **(trivial)** Scrub `clodhost.com` / `/var/www` / `/tmp/finance-manager*` references from `sw.js`, `public/sw.js`, `deploy.sh`, `scripts/`, `docs/`.
3. **(trivial)** Stop swallowing webhook/email/Stripe errors — at minimum `console.error` them (immediate operator visibility before full Sentry).
4. **(small)** Add a signup "I agree to Terms & Privacy" checkbox with recorded consent (once docs exist) — Stripe + GDPR requirement.
5. **(small)** Disclose the Yahoo Finance price lookup and gate live-price fetching behind opt-in.
6. **(trivial)** Self-host the Google Fonts (`index.html:10`) so visitor IPs aren't sent to Google pre-consent.
7. **(trivial)** `stop-tracking` `frontend/.env` (add to `.gitignore` intent) and fix version drift across `package.json`/README badge/CHANGELOG.

---

## Phased execution plan

### Phase 1 — Unblock the public repo + close the top code-integrity gap (days)
- Delete `apache/` (both clodhost vhosts); move a sanitized reverse-proxy example into `docs/self-hosting.md` with placeholder domains.
- Delete `docs/cl_workflow.md`.
- Scrub residual `clodhost.com` / `/var/www` / `/tmp/finance-manager*` leaks from `frontend/sw.js`, `public/sw.js`, `deploy.sh`, `scripts/`, `docs/`.
- Port Zod schemas from `backend/validators/schemas.js` to the worker; validate `amount` (finite, ≤2 decimals), `type` enum, positive-integer ids on every money-mutating route before balance math.
- Fix cheap correctness/hygiene: stop swallowing errors (`console.error`), self-host Google Fonts, untrack `frontend/.env`, version drift.
- Run `gitleaks` and confirm no credentials in history before flipping visibility.

### Phase 2 — Legal + operational blockers for a paid launch (weeks)
- Publish Privacy Policy, Terms, Refund/Cancellation, Imprint, cookie notice; `/privacy` + `/terms` routes, footer links, signup + pre-checkout "I agree" capture recorded server-side (timestamp + version).
- Ship production account deletion (unblock the existing atomic hard-delete; ensure full cascade + Stripe cancel).
- Enable Stripe Tax (`automatic_tax`, address/tax-ID collection, `invoice_creation`); register VAT OSS; EUR presentment pricing.
- Sign provider DPAs; publish versioned sub-processor list + transfer basis (SCC/DPF); disclose + opt-in the Yahoo price lookup.
- Wire Sentry (Cloudflare Workers SDK) into `onError` + the Stripe webhook; uptime monitoring on `/api/health` + alerting + status page.
- Retention periods + scheduled purge cron; `last_activity` on users; document retention in the privacy notice.
- Enforce email verification; configure the prod worker env (route, `EMAIL_FROM`, Stripe prices, cron); complete data export (include the account/identity record); SPF/DKIM/DMARC + `List-Unsubscribe`; document D1/R2 backup & DR.

### Phase 3 — Hardening & cloud/local parity (ongoing)
- Fix recurring-`populate` divergence (worker inserts `account_id` NULL + no balance delta vs frontend); unify EUR-vs-USD default; add cross-runtime parity tests.
- Fix bulk-`type`-change balance divergence (frontend moves balances, worker/backend don't).
- Fix `means_of_payment`-only create balance divergence; unify `amount` vs `COALESCE(amount_local, amount)` across balances/analytics/heatmap.
- Money model: migrate float `REAL` → integer cents (large).
- Harden low-severity items: receipt `Content-Disposition` filename injection, `settings` PUT mass-assignment, `profile_id IS NULL`/`=1` shared-settings tenant leak, unauthenticated unthrottled `/unsubscribe`, SameSite=Lax on cross-subdomain API, `email_verified === 'true'` string check, Stripe default-tier `'premium'` fallback.
- Add worker/backend tests for balance/amount/currency; add a self-hosting security note on the deprecated Express stack.

---

## Notable non-blockers / good news
- **Secrets:** clean (working tree + history). Vendored SheetJS `xlsx 0.20.3` is patched + SHA-pinned + not CDN-loaded. Live worker + frontend prod deps have **zero** known advisories. Runtime external loads limited to first-party Turnstile + Google Fonts CSS.
- **Deprecated `backend/` deps** still carry advisories (node-tar ×7 high via Docker, nodemailer SSRF) — matters only for self-hosters; document its deprecated status.

## Refuted (excluded)
- *"Account-list balance diverges across runtimes (current_balance vs .balance)"* — sub-claims correct but the conclusion misidentified which field the UI renders; not a real divergence.

## Caveat
High/critical findings were adversarially verified. Medium/low findings are collected but **not** individually re-verified — confirm before acting on the low-severity items.
