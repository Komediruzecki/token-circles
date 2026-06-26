import { Hono } from 'hono'
import type { AppEnv } from '../index'
import { requireAuth } from '../auth'
import * as db from '../db'

// Sample port of a slice of backend/routes/profiles.js, to demonstrate the pattern:
//   - Express `req.repos.profiles.list()` (sync better-sqlite3) becomes an async D1 query.
//   - `requireAuth` + the resolved `userId` replace express-session + getProfileId scoping.
// Port the remaining backend/routes/*.js modules the same way.
export const profilesRoutes = new Hono<AppEnv>()

profilesRoutes.get('/api/profiles', requireAuth, async (c) => {
  const userId = c.get('userId')
  const rows = await db.all(
    c.env.DB,
    'SELECT id, name, user_id, created_at FROM profiles WHERE user_id = ? ORDER BY id',
    userId
  )
  return c.json(rows)
})

// TODO: POST/PUT/DELETE /api/profiles, ownership checks, etc. (see backend/routes/profiles.js)
