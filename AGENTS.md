# Working in this repository

Read this before changing anything. It exists because the repo contains a retired runtime that
still looks alive, and agents keep fixing bugs in it.

## The backend is Cloudflare. There is no other backend.

Two things ship:

| What    | Where       | Runs on                                                             |
| ------- | ----------- | ------------------------------------------------------------------- |
| The app | `frontend/` | SolidJS, built by Vite, served as static assets from Cloudflare     |
| The API | `worker/`   | Hono on Cloudflare Workers, with D1 (SQLite) and R2 (receipt files) |

A third mode has no server at all: local-first, where the same frontend keeps everything in
IndexedDB. `frontend/src/core/storage/` is the seam — one adapter talks to the Worker, one talks
to the browser.

**So: a server-side change means `worker/`.** A change to how data is stored, queried, migrated or
authorised is a change under `worker/src/` plus a migration under `worker/migrations/`.

## What used to be

There was a Node/Express + SQLite server under `backend/`, from before the Worker. It is deleted.
If you find something that still refers to it — a doc, a script, a stale comment — that is a bug in
the reference, not a runtime you should go looking for.

Two leftovers are still in the tree and are worth reading with that in mind:

- `docs/self-hosting.md` and `docs/docker.md` describe deploying that server with Docker. Kept for
  anyone running an old image, marked retired at the top. Self-hosting today means running your own
  copy of the Worker (`wrangler deploy`) against your own D1 and R2. It does not mean Docker.
- `docs/specs/backend/` and `test/e2e/specs/` were written against the Express routes. Read them for
  _what the API does_ — that contract carried over — not for how it is implemented. The
  implementation is `worker/src/routes/`.

`0001_init.sql` also still creates tables only that server used. They are empty and unread. That is
not a reason to name a new table around them, but see the schema rule below before reusing a name.

## Where things live

```
frontend/          SolidJS app. Components, features, core/ (storage, api, stores).
frontend/tests/    Playwright e2e — the real built app against a locally-run Worker.
worker/src/        Hono routes, auth, billing, mail. This is the API.
worker/migrations/ D1 schema. Numbered, applied in order, never edited once merged.
worker/test/       vitest + @cloudflare/vitest-pool-workers (real Worker isolate, real D1).
shared/            Pure TypeScript used by BOTH runtimes. Import it, don't fork it.
packages/pwa-kit/  Extractable service-worker + install-prompt kit.
docs/              Specs, plans, audits. See docs/README.md for the index.
```

## Rules that are not negotiable

**Migrations are append-only.** A merged migration has run on dev and prod; editing it changes
nothing on either and desynchronises anyone who applies it fresh. Add a new numbered file.

**Check the schema before naming a table.** `0001_init.sql` created tables for the retired Express
server that nothing reads. `CREATE TABLE IF NOT EXISTS <name>` against an existing table of that
name is a silent no-op, and the _next_ statement is what fails — `auth_sessions` is named that way
because `sessions` was already taken by one of them.

**Deploys.** `push main` deploys to **dev**. Only a `v*` tag deploys to **prod** — annotated tags
only (`git tag -a`). Migrations apply before each deploy.

**Tests.** `worker/` and `frontend/` each run `vitest run`. New behaviour needs a test that fails
without the change; a guard needs a test that fails when the guard is removed.

**No emojis.** Not in components, buttons, headings, labels, logs, commit messages, or docs. Use an
SVG icon — reuse one from the file you are editing, or add a new icon component.

**Commits have one author: the repository owner.** Never add a `Co-Authored-By` trailer.

## Running it

```bash
pnpm install                  # once, at the root

pnpm dev                      # frontend on :3800, proxying /api to :8787
pnpm dev:worker               # the Worker on :8787 (wrangler dev, local D1)
pnpm -C worker run d1:migrate:local

pnpm test                     # frontend vitest
pnpm test:worker              # worker vitest
pnpm test:e2e                 # playwright — starts both servers and seeds the fixture itself
pnpm typecheck                # both
pnpm lint                     # frontend eslint (worker has none)
```

With `TURNSTILE_SECRET` unset and `APP_ENV=development`, the captcha gate is off locally — that is
deliberate and only applies in development.

`pnpm dev:worker` and `pnpm test:e2e` both need a `JWT_SECRET` in `worker/.dev.vars` (any string —
it signs sessions for a throwaway database under `worker/.wrangler`). The e2e suite does the rest
itself: `frontend/tests/global.setup.ts` registers the fixture account, seeds it from
`frontend/tests/e2e-seed.ts` — that file is the test data — and saves the signed-in state.
