import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authRoutes } from './routes/auth'
import { profilesRoutes } from './routes/profiles'

/** Bindings declared in wrangler.toml (env.*) plus secrets (wrangler secret put). */
export interface Env {
  DB: D1Database
  JWT_SECRET?: string // secret — signs JWTs and the OAuth state
  GOOGLE_CLIENT_ID?: string // var — OAuth client id (also checked as id_token aud)
  GOOGLE_CLIENT_SECRET?: string // secret — for the server-side code exchange
  CORS_ORIGIN?: string // the app origin (also auto-allowed as a returnTo)
  APP_ORIGINS?: string // comma-separated extra allowed returnTo origins
  COOKIE_DOMAIN?: string // e.g. ".yourdomain.com" to share the session cookie with the app
  APP_ENV?: string // 'development' drops the Secure cookie flag for local http dev
}

/** Hono generics shared across route modules: bindings + per-request vars. */
export type AppEnv = { Bindings: Env; Variables: { userId: number } }

const app = new Hono<AppEnv>()

// CORS — origin comes from the env var so it's domain-agnostic until you have one.
// credentials:true is required so the browser sends the session cookie cross-origin.
app.use('*', (c, next) => cors({ origin: c.env.CORS_ORIGIN ?? '*', credentials: true })(c, next))

// Public health check (no auth) — handy for uptime checks and the deploy smoke test.
app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV ?? 'unknown' }))

// Auth: Google Sign-In + session endpoints. start/callback are public; me/logout self-gate.
app.route('/', authRoutes)

// ── Data route modules (each applies requireAuth) ─────────────────────────────
// One sample is wired up to prove the pattern; port the rest of backend/routes/*.js here.
app.route('/', profilesRoutes)
// TODO: app.route('/', transactionsRoutes), accountsRoutes, categoriesRoutes, ...

app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Mirrors the Express AppError handler: honor an attached statusCode, else 500.
app.onError((err, c) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500
  return c.json({ error: err.message || 'Internal Server Error' }, status as 500)
})

export default app
