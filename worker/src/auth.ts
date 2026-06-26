import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from './index'

// ──────────────────────────────────────────────────────────────────────────────
// AUTH — PLACEHOLDER. Decide a strategy before going live.
//
// The Express backend used express-session + a SQLite session store + bcrypt,
// none of which run on Workers. Two viable options:
//
//   A) Stateless JWT (simplest on Workers)
//      - login: verify password, sign a JWT with SESSION_SECRET (use `hono/jwt`).
//      - requireAuth: verify the JWT from the cookie/Authorization header.
//      - logout: short token expiry; optional denylist in Workers KV.
//
//   B) D1-backed sessions (closest to current behavior)
//      - add a `sessions` table to migrations (id TEXT PK, user_id, expires_at).
//      - login: insert a row, set an httpOnly cookie with the id.
//      - requireAuth: look the id up here and check expiry.
//
// Password hashing: bcrypt is native and won't run on Workers. Port the login
// route to Web Crypto PBKDF2 or @noble/hashes scrypt, and re-hash on next login
// (or run a one-off migration of existing hashes).
// ──────────────────────────────────────────────────────────────────────────────

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = await resolveUserId(c)
  if (userId === null) return c.json({ error: 'Unauthorized' }, 401)
  c.set('userId', userId)
  await next()
}

/**
 * Returns the authenticated user id, or null. PLACEHOLDER — returns null so every
 * guarded route is locked until a real strategy (above) is implemented. Wire this
 * to JWT verification or a D1 `sessions` lookup.
 */
async function resolveUserId(_c: Context<AppEnv>): Promise<number | null> {
  // TODO: implement JWT verify (option A) or D1 session lookup (option B).
  return null
}
