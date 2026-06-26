import type { Context } from 'hono'
import type { AppEnv } from './index'
import { HttpError } from './http'

// Worker analog of backend/middleware/profile.js. Data is scoped by profile_id;
// the active profile comes from the X-Profile-Id header and MUST belong to the
// authenticated user (c.get('userId'), set by requireAuth).

/** Resolve + authorize the active profile. Defaults to the user's first profile. */
export async function getProfileId(c: Context<AppEnv>): Promise<number> {
  const userId = c.get('userId')
  const raw = c.req.header('X-Profile-Id')
  const id = raw ? parseInt(raw, 10) : NaN
  if (!Number.isFinite(id)) {
    const p = await c.env.DB.prepare('SELECT id FROM profiles WHERE user_id = ? ORDER BY id LIMIT 1')
      .bind(userId)
      .first<{ id: number }>()
    if (!p) throw new HttpError(403, 'No profile for this user')
    return p.id
  }
  const owned = await c.env.DB.prepare('SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first()
  if (!owned) throw new HttpError(403, 'Access denied to this profile')
  return id
}

/** Multiple profiles (X-Profile-Ids JSON array) for cross-profile reads; all must be owned. */
export async function getProfileIds(c: Context<AppEnv>): Promise<number[]> {
  const userId = c.get('userId')
  const header = c.req.header('X-Profile-Ids')
  let ids: number[] = []
  if (header) {
    try {
      const parsed = JSON.parse(header)
      if (Array.isArray(parsed)) ids = parsed.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n))
    } catch {
      /* fall through to single-profile */
    }
  }
  if (ids.length === 0) return [await getProfileId(c)]

  const placeholders = ids.map(() => '?').join(',')
  const rows = await c.env.DB.prepare(`SELECT id FROM profiles WHERE user_id = ? AND id IN (${placeholders})`)
    .bind(userId, ...ids)
    .all<{ id: number }>()
  const owned = new Set((rows.results ?? []).map((r) => r.id))
  for (const id of ids) if (!owned.has(id)) throw new HttpError(403, `Access denied to profile ${id}`)
  return ids
}
