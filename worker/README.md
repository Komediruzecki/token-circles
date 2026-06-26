# Finance Manager — Cloudflare Worker + D1

A self-contained Worker (Hono + D1) reimplementing the API off the Apache + SQLite
(`better-sqlite3`) host. **Not live yet** and intentionally **not** part of the pnpm
workspace, so it doesn't touch the existing backend, lockfile, or CI. Install and run it
on its own when you're ready.

The frontend already deploys to Cloudflare ("Workers Builds"), so the API becomes a
sibling Worker (e.g. `api.<your-domain>`) and the whole stack lives on one platform.

## Why D1
The app is already SQLite, and D1 *is* SQLite — so the schema transfers almost verbatim
(`migrations/0001_init.sql`, with the `users` table adapted for the Worker's auth). The
real work was swapping the runtime: `better-sqlite3` (sync, native) → D1's async
`prepare().bind().all()/first()/run()`, and Express → [Hono](https://hono.dev).

## Layout
```
worker/
  wrangler.toml             Worker + D1 config (PLACEHOLDERs: account_id, database_id, domain)
  package.json              hono + wrangler deps and the d1:* / dev / deploy scripts
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
- **Still `501 + // TODO`** — only what needs Workers infra not set up yet:
  - report **PDF** export (PDFKit/Puppeteer are Node-only),
  - receipt **file upload/serving** (needs an **R2** bucket binding),
  - **spreadsheet-file** import (xlsx parser; the JSON/CSV-text import path *is* ported).
- **Caveat:** it typechecks and bundles, but hasn't been run against a live D1 yet —
  smoke-test the SQL once you stand up the database (below).

## Go-live steps (run later, in order)
```bash
cd worker
pnpm install --ignore-workspace   # worker is NOT in the pnpm workspace
npx wrangler login

npx wrangler d1 create finance-manager     # prints a database_id
# -> paste database_id into wrangler.toml, set account_id (or CLOUDFLARE_ACCOUNT_ID)

pnpm run d1:migrate:local          # apply schema to the local dev D1
pnpm run dev                       # http://localhost:8787/api/health -> {"ok":true}

pnpm run d1:migrate:remote         # apply schema to the real D1

# Auth secrets (create the Google OAuth client first — see "Auth" below):
npx wrangler secret put JWT_SECRET             # any long random string
npx wrangler secret put GOOGLE_CLIENT_SECRET   # from Google Cloud Console
pnpm run deploy
```
Once you own a domain: set `CORS_ORIGIN` + the `[[routes]]` custom domain in
`wrangler.toml`, redeploy, and point the frontend's API base URL at it.

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
  All domain/route/CORS spots are `PLACEHOLDER_DOMAIN`.
- **R2 + PDF/xlsx** — wire an R2 bucket for receipts, and pick a Workers-compatible PDF and
  spreadsheet approach, to finish the remaining `501` endpoints.
- **Data migration** — to move existing rows into D1:
  `sqlite3 finance.db .dump > dump.sql`, strip pragmas/transactions, then
  `npx wrangler d1 execute finance-manager --remote --file dump.sql`.
