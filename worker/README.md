# Finance Manager — Cloudflare Worker + D1

A self-contained Worker (Hono + D1) reimplementing the API off the Apache + SQLite
(`better-sqlite3`) host. **Not live yet** and intentionally **not** part of the pnpm
workspace, so it doesn't touch the existing backend, lockfile, or CI. Install and run it
on its own when you're ready.

The frontend already deploys to Cloudflare ("Workers Builds"), so the API becomes a
sibling Worker (e.g. `api.<your-domain>`) and the whole stack lives on one platform.

## Why D1

The app is already SQLite, and D1 _is_ SQLite — so the schema transfers almost verbatim
(`migrations/0001_init.sql`, with the `users` table adapted for the Worker's auth). The
real work was swapping the runtime: `better-sqlite3` (sync, native) → D1's async
`prepare().bind().all()/first()/run()`, and Express → [Hono](https://hono.dev).

## Layout

```
worker/
  wrangler.jsonc            Worker config: top-level bindings = local dev; env.dev / env.prod deploys
  package.json              hono + wrangler deps and the d1:* / dev / deploy:{dev,prod} scripts
  migrations/0001_init.sql  D1 schema
  src/index.ts              Hono entry: CORS, /api/health, mounts every route module, error handler
  src/http.ts               HttpError (mapped to JSON by app.onError)
  src/db.ts                 async D1 helpers (all/first/run/insert/update/del) — analog of baseRepo
  src/profile.ts            X-Profile-Id scoping, verified against the JWT user
  src/auth.ts               JWT (HS256) + Google Sign-In + httpOnly cookie session
  src/routes/*.ts           one module per resource (auth, transactions, accounts, …)
  .dev.vars.example         local secrets template
```

## Ported routes (status)

Every module in `src/routes/` follows one pattern (requireAuth → `getProfileId`/
`getProfileIds` → async D1) and is mounted in `index.ts`. Data is scoped by the
`X-Profile-Id` header, verified to belong to the authenticated user.

- **Ported (≈all of the app):** auth (Google), profiles, transactions (list/filter/
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
- **Status:** typechecks, bundles, and **boots locally** — `pnpm run dev` serves the full
  Hono app off a local D1 + R2 (`/api/health` → `{"ok":true}`, protected routes 401 without a
  session). Not yet run against a **remote** D1/R2 — smoke-test after the first deploy.

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

## Auth

Implemented (adapted from mercurypitch's zero-dependency WebCrypto module): stateless
**JWT (HS256)** in an **httpOnly, Secure, SameSite=Lax cookie** + **Google Sign-In**
(server-side code flow with a signed-state CSRF guard and a returnTo allowlist), in
`src/auth.ts` + `src/routes/auth.ts`. Routes: `/api/auth/google/start`, `/callback`,
`/me`, `/logout`. Logout bumps `users.token_version` to revoke all issued tokens.
**Setup steps:** `~/.dotfiles/personal/finance/google-oauth-setup.md`. Password login uses
PBKDF2; existing **bcrypt** hashes need a re-hash-on-next-login migration.

`src/auth.ts` depends only on WebCrypto + a `D1Database` handle (the Hono-specific part is
just the `requireAuth` wrapper), so it's designed to lift into a shared cross-app auth lib
later, alongside the wrangler/D1 setup.

## Open items

- **Domain** — not purchased yet (name ideas in `~/.dotfiles/personal/finance/name-ideas.md`).
  All domain/route/CORS spots in `wrangler.jsonc` are `PLACEHOLDER_DOMAIN` (and
  `frontend/.env.dev` / `frontend/wrangler.jsonc` for the dev frontend).
- **Premium billing** — receipt upload is gated to `users.plan = 'premium'`, but there's no
  billing/upgrade flow yet; set a user premium manually for now
  (`UPDATE users SET plan='premium' WHERE id=?`). PDF reports + spreadsheet import are free.
- **R2 bucket** — create the per-env buckets (`pnpm run r2:create:dev` / `:prod`) and keep
  their names in `wrangler.jsonc`; receipt endpoints return 501 until the bucket is bound.
- **Data migration** — to move existing rows into D1:
  `sqlite3 finance.db .dump > dump.sql`, strip pragmas/transactions, then
  `npx wrangler d1 execute finance-manager --remote --file dump.sql`.
