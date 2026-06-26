# Finance Manager — Cloudflare Worker + D1 (migration scaffold)

**Status: preparation only.** This directory is a self-contained scaffold for moving
the API off the Apache + SQLite (`better-sqlite3`) host onto a Cloudflare Worker
backed by **D1** (Cloudflare's SQLite database). Nothing here is live yet, and it is
intentionally **not** part of the pnpm workspace, so it doesn't touch the existing
backend, lockfile, or CI. Install and run it on its own when you're ready.

The frontend already deploys to Cloudflare ("Workers Builds"). This makes the API a
sibling Worker (e.g. `api.<your-domain>`), so the whole stack ends up on one platform.

## Why D1
The app is already SQLite, and D1 *is* SQLite — so the schema transfers almost
verbatim (`migrations/0001_init.sql` is a copy of `backend/schema.sql`). The real work
is swapping the runtime: `better-sqlite3` (synchronous, native) → D1's async
`prepare().bind().all()/first()/run()`, and Express → [Hono](https://hono.dev).

## What's in here
```
worker/
  wrangler.toml            Worker + D1 config (PLACEHOLDERs: account_id, database_id, domain)
  package.json             hono + wrangler deps and the d1:* / dev / deploy scripts
  tsconfig.json            Workers TS config
  migrations/0001_init.sql D1 schema (generated from backend/schema.sql)
  src/index.ts             Hono entry: CORS, /api/health, mounts route modules, error handler
  src/db.ts                async D1 helpers (all/first/run/insert) — analog of baseRepo.js
  src/auth.ts              JWT (HS256) + Google Sign-In + httpOnly cookie session (implemented)
  src/routes/auth.ts       /api/auth/google/start, /callback, /me, /logout
  src/routes/profiles.ts   one sample ported data route (Express→Hono+D1 pattern)
  .dev.vars.example        local secrets template
```

## Go-live steps (run later, in order)
```bash
cd worker
pnpm install                     # pulls hono + wrangler (kept out of the root workspace)
wrangler login                   # auth the Cloudflare CLI

pnpm run d1:create               # creates the D1 db, prints a database_id
# -> paste database_id into wrangler.toml, set account_id (or CLOUDFLARE_ACCOUNT_ID)

pnpm run d1:migrate:local        # apply schema to the local dev D1
pnpm run dev                     # http://localhost:8787/api/health  -> {"ok":true}

pnpm run d1:migrate:remote       # apply schema to the real D1

# Auth secrets (create the Google OAuth client first — see "Auth" below):
wrangler secret put JWT_SECRET             # any long random string
wrangler secret put GOOGLE_CLIENT_SECRET   # from Google Cloud Console
pnpm run deploy                  # publish the Worker
```
Once you own a domain: set `CORS_ORIGIN` + the `[[routes]]` custom domain in
`wrangler.toml`, redeploy, and point the frontend's API base URL at it.

## Decisions still open (left as placeholders on purpose)
- **Domain** — not purchased yet (see candidates below). All domain/route/CORS spots
  are `PLACEHOLDER_DOMAIN`.
- **Auth** — IMPLEMENTED (adapted from mercurypitch's zero-dependency WebCrypto module):
  stateless **JWT (HS256)** in an **httpOnly, Secure, SameSite=Lax cookie** + **Google
  Sign-In** (server-side code flow with a signed-state CSRF guard and a returnTo
  allowlist), in `src/auth.ts` + `src/routes/auth.ts`. Routes: `/api/auth/google/start`,
  `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/logout`. Logout bumps
  `users.token_version` to revoke all issued tokens. **Remaining setup:** create a Google
  OAuth client and set `JWT_SECRET` + `GOOGLE_CLIENT_SECRET` (steps in
  `~/.dotfiles/personal/finance/google-oauth-setup.md`). Password login uses PBKDF2
  helpers; existing **bcrypt** hashes need a re-hash-on-next-login migration (bcrypt can't
  run on Workers).
- **Shared library (later)** — `src/auth.ts` depends only on WebCrypto + a `D1Database`
  handle (the Hono-specific part is just the `requireAuth` wrapper), so it's designed to
  lift into a shared cross-app auth lib alongside the wrangler/D1 setup.
- **Password hashing** — `bcrypt` is native and won't run on Workers; port login to
  Web Crypto **PBKDF2** or `@noble/hashes` **scrypt**, and re-hash on next login.
- **Route porting** — only `profiles` is ported as a sample; the other
  `backend/routes/*.js` modules follow the same shape.
- **Data migration** — to move existing rows from the live SQLite file into D1:
  `sqlite3 finance.db .dump > dump.sql`, strip pragmas/transactions, then
  `wrangler d1 execute finance-manager --remote --file dump.sql`.

## Domain name candidates (check availability before buying)
Brandable, finance-manager-ish, mostly short. `.app`/`.io`/`.com` as available:
- **Ledgerly** — ledger + friendly suffix; clean, trustworthy.
- **Fundary** — funds + "-ary"; brandable, short.
- **Pennywise** — classic money idiom; warm and memorable.
- **Cashmint** — "mint" evokes fresh money/budgeting.
- **Tallywell** — "tally" + wellness vibe.
- **Budgetnest** — budgeting + a safe "nest egg".
- **Coinkeep** — keeping your coins; simple compound.
- **Sumly** — from "sum"; tiny, modern SaaS feel.
- **Worthly** — net worth; aspirational.
- **Balancr** — "balance" with a startup spelling.
- **Fiscly** — from "fiscal"; short and ownable.
- **Moneyloom** — weaving your money together.

Tip: prefer one that's free on `.com` *and* an unused handle on X/GitHub. If you like a
direction (e.g. "ledger" vs "budget" vs "coin"), say so and I'll generate a tighter list.
