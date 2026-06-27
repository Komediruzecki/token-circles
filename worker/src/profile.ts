import type { Context } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './http';

// Worker analog of backend/middleware/profile.js. Data is scoped by profile_id;
// the active profile comes from the X-Profile-Id header and MUST belong to the
// authenticated user (c.get('userId'), set by requireAuth).

/** The user's first profile, lazily creating a default one if they have none. Accounts created
 *  before profile-seeding (and any edge case) get a profile here instead of 403-ing every route. */
export async function ensureProfile(c: Context<AppEnv>): Promise<number> {
  const userId = c.get('userId');
  let p = await c.env.DB.prepare('SELECT id FROM profiles WHERE user_id = ? ORDER BY id LIMIT 1')
    .bind(userId)
    .first<{ id: number }>();
  if (p) return p.id;
  // INSERT OR IGNORE + re-select avoids a UNIQUE(user_id,name) race when many profile-scoped
  // requests fire at once on first load.
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO profiles (name, user_id) VALUES ('Personal Profile', ?)"
  )
    .bind(userId)
    .run();
  p = await c.env.DB.prepare('SELECT id FROM profiles WHERE user_id = ? ORDER BY id LIMIT 1')
    .bind(userId)
    .first<{ id: number }>();
  if (!p) throw new HttpError(500, 'Failed to create a default profile');
  return p.id;
}

/** Resolve + authorize the active profile. A missing, malformed, stale or unowned X-Profile-Id
 *  gracefully falls back to the user's first profile (created if needed) — a stale id in the
 *  browser's localStorage must never 403 the whole app. Data stays user-scoped either way. */
export async function getProfileId(c: Context<AppEnv>): Promise<number> {
  const userId = c.get('userId');
  const raw = c.req.header('X-Profile-Id');
  const id = raw && /^\d+$/.test(raw.trim()) ? parseInt(raw.trim(), 10) : NaN;
  if (Number.isFinite(id)) {
    const owned = await c.env.DB.prepare(
      'SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?'
    )
      .bind(id, userId)
      .first();
    if (owned) return id;
  }
  return ensureProfile(c);
}

/** Multiple profiles (X-Profile-Ids JSON array) for cross-profile reads; all must be owned. */
export async function getProfileIds(c: Context<AppEnv>): Promise<number[]> {
  const userId = c.get('userId');
  const header = c.req.header('X-Profile-Ids');
  let ids: number[] = [];
  if (header) {
    try {
      const parsed = JSON.parse(header);
      if (Array.isArray(parsed))
        ids = parsed.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n));
    } catch {
      /* fall through to single-profile */
    }
  }
  if (ids.length === 0) return [await getProfileId(c)];

  const placeholders = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT id FROM profiles WHERE user_id = ? AND id IN (${placeholders})`
  )
    .bind(userId, ...ids)
    .all<{ id: number }>();
  const ownedSet = new Set((rows.results ?? []).map((r) => r.id));
  const kept = ids.filter((id) => ownedSet.has(id));
  // Drop stale/unowned ids instead of 403-ing; fall back to the primary profile if none remain.
  return kept.length > 0 ? kept : [await getProfileId(c)];
}
