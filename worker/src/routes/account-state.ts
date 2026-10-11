import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { accept, HttpError } from '../http';
import * as db from '../db';
import { isUserStateKey } from '../../../shared/accountStateKeys';
import {
  answerUserState,
  applyUserStateWrite,
  sqliteDateTime,
  USER_STATE_MESSAGES,
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

// Every key: null where there is no row, 'unreadable' where the row was written by another build
// in a shape this one cannot read, so the app can tell an unknown value from no value.
accountStateRoutes.get('/api/account/state', requireAuth, async (c) => {
  const rows = await db.all<{ key: string; value: string }>(
    c.env.DB,
    'SELECT key, value FROM user_state WHERE user_id = ?',
    c.get('userId')
  );
  c.header('Cache-Control', 'no-store');
  return c.json(answerUserState(rows));
});

/** How many times a write re-reads after another write to the same row got in first. */
const WRITE_ATTEMPTS = 3;

// A write reads the row, merges the body into it by the key's rule, and stores the result only
// while the row still holds what was read. If another write landed in between, it reads again
// and merges again, so a step recorded by one tab can never undo a finish recorded by another.
// A row this build reads only in part (another build's step or tour) is merged over what it can
// read, and left byte for byte when the merge changes nothing. A row it cannot read at all was
// written by another build: it is never replaced, and the write is refused (409).
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
    const write = applyUserStateWrite(key, body, row?.value ?? null, sqliteDateTime(new Date()));
    if (!write.ok) {
      if ('unreadable' in write) throw new HttpError(409, USER_STATE_MESSAGES.unreadable);
      return accept(write);
    }
    const next = write.value;
    if (!write.changed) return c.json({ [key]: next });
    const text = JSON.stringify(next);
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
