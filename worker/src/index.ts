import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { profilesRoutes } from './routes/profiles'

/** Bindings declared in wrangler.toml (env.*) plus secrets. */
export interface Env {
  DB: D1Database
  SESSION_SECRET?: string
  CORS_ORIGIN?: string
  APP_ENV?: string
}

/** Hono generics shared across route modules: bindings + per-request vars. */
export type AppEnv = { Bindings: Env; Variables: { userId: number } }

const app = new Hono<AppEnv>()

// CORS — origin comes from the env var so it's domain-agnostic until you have one.
app.use('*', (c, next) =>
  cors({ origin: c.env.CORS_ORIGIN ?? '*', credentials: true })(c, next)
)

// Public health check (no auth) — handy for uptime checks and the deploy smoke test.
app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV ?? 'unknown' }))

// ── Ported route modules ──────────────────────────────────────────────────────
// One sample module is wired up to prove the pattern end-to-end (D1 + auth stub).
// Port the rest of backend/routes/*.js the same way and mount them here.
app.route('/', profilesRoutes)
// TODO: app.route('/', transactionsRoutes)
// TODO: app.route('/', accountsRoutes)
// TODO: ... (categories, budgets, bills, recurring, receipts, portfolio, ...)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Mirrors the Express AppError handler: honor an attached statusCode, else 500.
app.onError((err, c) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500
  return c.json({ error: err.message || 'Internal Server Error' }, status as 500)
})

export default app
