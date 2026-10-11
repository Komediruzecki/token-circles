import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { accept, HttpError } from '../http';
import * as db from '../db';
import { isUserStateKey, USER_STATE_KEYS } from '../../../shared/accountStateKeys';
import {
  checkUserStateWrite,
  readUserStateValue,
  sqliteDateTime,
  type UserState,
} from '../../../shared/accountState';

/**
 * State that belongs to the signed-in account, not to the browser: the setup wizard's record, the
 * tours finished, whether the Getting started card is hidden (migration 0034, user_state).
 *
 * Both routes take a session cookie only (requireAuth): no API token reaches them, and an account
 * waiting for its confirm link is answered 403 like every other app route. The account is the
 * session's; no id is ever read from the request. Keys are an allowlist and each write goes
 * through its key's rule in shared/accountState.ts. Local-first keeps the same state in
 * localStorage and never calls these.
 */
export const accountStateRoutes = new Hono<AppEnv>();

accountStateRoutes.get('/api/account/state', requireAuth, async (c) => {
  const rows = await db.all<{ key: string; value: string }>(
    c.env.DB,
    'SELECT key, value FROM user_state WHERE user_id = ?',
    c.get('userId')
  );
  const state = Object.fromEntries(USER_STATE_KEYS.map((key) => [key, null])) as UserState;
  for (const row of rows) {
    if (isUserStateKey(row.key)) {
      (state as Record<string, unknown>)[row.key] = readUserStateValue(row.key, row.value);
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.json(state);
});

/** How many times a write re-reads after another write to the same row got in first. */
const WRITE_ATTEMPTS = 3;

// A write reads the row, merges the body into it by the key's rule, and stores the result only
// while the row still holds what was read. If another write landed in between, it reads again
// and merges again, so a step recorded by one tab can never undo a finish recorded by another.
accountStateRoutes.put('/api/account/state/:key', requireAuth, async (c) => {
  const key = c.req.param('key');
  if (!isUserStateKey(key)) throw new HttpError(404, 'Not found');
  const userId = c.get('userId');
  const body: unknown = await c.req.json().catch(() => null);
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await db.first<{ value: string }>(
      c.env.DB,
      'SELECT value FROM user_state WHERE user_id = ? AND key = ?',
      userId,
      key
    );
    const current = row ? readUserStateValue(key, row.value) : null;
    const next = accept(checkUserStateWrite(key, body, current, sqliteDateTime(new Date())));
    const text = JSON.stringify(next);
    if (row && row.value === text) return c.json({ [key]: next });
    const written = row
      ? await db.run(
          c.env.DB,
          `UPDATE user_state SET value = ?, updated_at = datetime('now')
            WHERE user_id = ? AND key = ? AND value = ?`,
          text,
          userId,
          key,
          row.value
        )
      : await db.run(
          c.env.DB,
          'INSERT OR IGNORE INTO user_state (user_id, key, value) VALUES (?, ?, ?)',
          userId,
          key,
          text
        );
    if ((written.meta.changes ?? 0) > 0) return c.json({ [key]: next });
  }
  throw new HttpError(503, 'Please try again.');
});
