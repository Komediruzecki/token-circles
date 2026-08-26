# Token Circles — Cloudflare Worker + D1

The API. A Hono Worker on **D1** (SQLite) for data and **R2** for receipts, live in
production at `api.tokencircles.com` and on dev at `api.dev.tokencircles.com`. It is the
only backend: the original Node/Express + `better-sqlite3` server was retired in #428.

`worker/` is deliberately **not** a pnpm workspace member — it installs and deploys on its
own (`pnpm install --ignore-workspace`) so the API's dependency set is independent of the
frontend's. It has its own committed `pnpm-lock.yaml`, and CI installs it with
`--frozen-lockfile`, so the wrangler that runs the tests is the wrangler you have locally.

## Why D1

The app was already SQLite and D1 _is_ SQLite, so the schema transferred almost verbatim.
The real work was the runtime: `better-sqlite3` (sync, native) became D1's async
`prepare().bind().all()/first()/run()`, and Express became [Hono](https://hono.dev).

## Layout

```
worker/
  wrangler.jsonc            Worker config: top-level bindings = local dev; env.dev / env.prod deploys
  package.json              hono + wrangler deps and the d1:* / dev / deploy:{dev,prod} scripts
  migrations/*.sql          D1 schema, applied in order (0001_init.sql onward)
  src/index.ts              Hono entry: CORS, /api/health, mounts every route module, error handler
  src/http.ts               HttpError (mapped to JSON by app.onError)
  src/db.ts                 async D1 helpers (all/first/run/insert/update/del) — analog of baseRepo
  src/profile.ts            X-Profile-Id scoping, verified against the JWT user
  src/auth.ts               JWT (HS256) + Google Sign-In + httpOnly cookie session
  src/routes/*.ts           one module per resource (auth, transactions, accounts, …)
  .dev.vars.example         local secrets template
```

## Routes

Every module in `src/routes/` follows one pattern (requireAuth → `getProfileId`/
`getProfileIds` → async D1) and is mounted in `index.ts`. Data is scoped by the
`X-Profile-Id` header, verified to belong to the authenticated user.

- **Covered (all of the app):** auth (Google + email/password), billing (Stripe), profiles, transactions (list/filter/
  summary/CRUD + bulk + reconcile), accounts (+ balance history), categories (+ mappings,
  auto-map, apply-mappings), tags (+ transaction tagging), budgets (+ summary/history/
  alerts/forecast/zero-based/allocate/…), bills (+ upcoming/summary/calendar/mark-paid),
  recurring (+ upcoming/populate), savings-goals, loans (+ rates/prepayments/amortization),
  portfolio (+ live Yahoo prices), housing, retirement-goals (+ projection), counterparties,
  settings, dashboard, analytics, calculators, and the report DATA/JSON endpoints.
- **PDF reports** via `pdf-lib` (pure JS): monthly, tax-summary, pl-summary, annual.
- **Receipt files** in **R2** (`[[r2_buckets]]`): upload is a **premium** feature (gated
  by `users.plan`; free accounts get 402) with type/size + per-profile count limits;
  serving is owner-scoped. **Spreadsheet import** via SheetJS (xlsx + csv).
- Remaining gaps are edge-only: the Google-Sheets **xlsx fallback** (CSV export covers the
  common case) and the old stateful `/import/file-sheet` (replaced by re-uploading with a
  `sheetName` field).
- **Tests:** `pnpm run test` — vitest through `@cloudflare/vitest-pool-workers`, so every
  case runs in a real workerd against a real (local, per-run) D1.

## Local dev (worker + frontend interplay)

Two processes, both same-origin via the vite proxy — so the `SameSite=Lax` session cookie
works with no CORS and no domain:

```bash
cd worker
pnpm install --ignore-workspace    # worker is NOT in the pnpm workspace
cp .dev.vars.example .dev.vars     # fill JWT_SECRET + Google client id/secret (for sign-in)
pnpm run d1:migrate:local          # create + migrate the LOCAL D1 (.wrangler/state)
pnpm run dev                       # worker on http://127.0.0.1:8787 (local D1 + R2)
```

In a second terminal:

```bash
pnpm -C frontend run dev           # vite on http://127.0.0.1:3800, proxies /api -> :8787
```

Open http://127.0.0.1:3800 and switch **Settings → storage to "self-hosted"** (or put
`VITE_DEFAULT_STORAGE=sqlite` in `frontend/.env.local`) to drive the app off the worker
instead of client-only IndexedDB. Google sign-in works locally once the OAuth client lists
`http://localhost:8787/api/auth/google/callback` as an authorized redirect URI (see Auth).

## Deploy (dev → prod)

`wrangler.jsonc` defines two environments — `env.dev` (`finance-manager-api-dev`,
`api.dev.<domain>`) and `env.prod` (`finance-manager-api`, `api.<domain>`) — each with its own
D1 database, R2 bucket, vars and route. Run once per environment (shown for `dev`; repeat the
`:prod` variants for production):

```bash
cd worker
npx wrangler login
pnpm run d1:create:dev     # prints a database_id -> paste into env.dev.d1_databases.database_id
pnpm run r2:create:dev     # premium receipt storage bucket
pnpm run d1:migrate:dev    # apply the schema to the remote dev D1
pnpm run secret:dev        # JWT_SECRET + GOOGLE_CLIENT_SECRET for the dev worker
# set env.dev.vars.GOOGLE_CLIENT_ID; once you own a domain also set CORS_ORIGIN / APP_ORIGINS /
# COOKIE_DOMAIN and uncomment the api.dev.<domain> route, then:
pnpm run deploy:dev
```

The frontend deploys the same way (`pnpm -C frontend run deploy:dev` / `deploy:prod`); the dev
build (`--mode dev` → `frontend/.env.dev`) points `VITE_API_URL` at `api.dev.<domain>`, sharing
the session cookie cross-subdomain via `COOKIE_DOMAIN`. Full account/domain/D1 runbook:
`~/.dotfiles/personal/finance/cloudflare-d1-setup.md`.

### CI deploys (GitHub Actions)

`.github/workflows/deploy-worker.yml` (this worker) and `deploy-frontend.yml` (the app) mirror
the mercurypitch/chaos-master setup: **push to `main` → dev**, **tag `v*` → prod**, plus manual
`workflow_dispatch` (pick dev/prod). The worker job runs `d1 migrations apply` before deploying.
Prerequisites:

- Repo secrets **`CLOUDFLARE_API_TOKEN`** + **`CLOUDFLARE_ACCOUNT_ID`** (deploy steps skip if the
  token is absent). The token needs Workers Scripts / D1 / R2 / Workers Routes / SSL edit (the
  "Edit Cloudflare Workers" template + SSL); add Zone DNS:Edit if custom-domain attach fails.
- The one-time `d1:create` / `r2:create` / `secret:` setup above must be done per env, and the
  printed `database_id` pasted into `wrangler.jsonc`, before the first CI deploy.
- **Disable Cloudflare "Workers Builds"** for the frontend — its auto-deploy targets the same
  worker as the prod job and would race on a tag.
- Prod deploys **only** from a `v*` tag. A `workflow_dispatch` build stamps its version from
  `git describe`, so it ships as `5.11.0-3-gabc1234`; see `docs/deploy-update-pipeline.md` for
  the incident that taught us. The worker job takes a full `d1 export` backup and uploads it as
  an artifact _before_ applying migrations.

## Auth

Implemented (adapted from mercurypitch's zero-dependency WebCrypto module): stateless
**JWT (HS256)** in an **httpOnly, Secure, SameSite=Lax cookie** + **Google Sign-In**
(server-side code flow with a signed-state CSRF guard and a returnTo allowlist), in
`src/auth.ts` + `src/routes/auth.ts`. Routes: `/api/auth/google/start`, `/callback`,
`/me`, `/logout`. Logout bumps `users.token_version` to revoke all issued tokens.
Password login uses **PBKDF2-SHA256 at 100,000 iterations** — the ceiling Workers' WebCrypto
allows, which is why the number is not higher.

`src/auth.ts` depends only on WebCrypto + a `D1Database` handle (the Hono-specific part is
just the `requireAuth` wrapper), so it's designed to lift into a shared cross-app auth lib
later, alongside the wrangler/D1 setup.

## Billing

Stripe, in `src/routes/billing.ts` with the tier catalogue in `src/plans.ts` — which is the
single source of truth for what each tier gets, served to the frontend at `/api/plans` so the
comparison table cannot drift from what the Worker enforces.

- Checkout is a Stripe Checkout Session; a tier or interval **change** modifies the existing
  subscription rather than opening a second one (`users.stripe_subscription_id`, migration
  0026). Opening a second Session is how an account ends up paying twice.
- `POST /api/billing/webhook` is the only writer of plan state — signature-verified, and
  ordered by `users.stripe_event_at` so an out-of-order delivery cannot roll a plan backwards.
- Entitlement is `active` / `trialing` / `past_due` (`isEntitled`). `past_due` is a dunning
  grace window, not a lapse.
- A **comped** plan is granted directly and has no Stripe customer behind it, so the portal
  and every "manage" affordance must be hidden for it, not merely disabled.

## Setup notes

- **Zone** — the `tokencircles.com` zone must be active in Cloudflare for the `custom_domain`
  routes in `wrangler.jsonc` to provision DNS on deploy.
- **R2 bucket** — create the per-env buckets (`pnpm run r2:create:dev` / `:prod`) and keep
  their names in `wrangler.jsonc`; receipt endpoints return 501 until a bucket is bound.
- **Fresh fork** — fill the placeholders before the first deploy: D1 `database_id`s (from
  `d1:create:dev` / `:prod`), `GOOGLE_CLIENT_ID`, optional `account_id`, and the secrets from
  `pnpm run secret:dev` / `:prod`.
