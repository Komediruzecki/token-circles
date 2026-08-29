import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { HttpError } from '../http';
import { mintApiToken, type Scope } from '../apitoken';
import * as db from '../db';

// Cookie-authed token management. Deliberately NOT reachable with a bearer token: a leaked
// API token must not be able to mint itself more tokens, or wider scopes.
export const apiTokensRoutes = new Hono<AppEnv>();

const VALID_SCOPES: Scope[] = ['read', 'write', 'import'];

apiTokensRoutes.post('/api/account/api-tokens', requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    scopes?: unknown;
    defaultProfileId?: unknown;
    expiresAt?: unknown;
  };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '' || name.length > 100) throw new HttpError(422, 'A token name is required.');

  const requested = Array.isArray(body.scopes) ? body.scopes : [];
  const scopes = requested.filter((s): s is Scope => VALID_SCOPES.includes(s as Scope));
  if (scopes.length === 0 || scopes.length !== requested.length) {
    throw new HttpError(422, `scopes must be a non-empty subset of ${VALID_SCOPES.join(', ')}.`);
  }

  let defaultProfileId: number | null = null;
  if (body.defaultProfileId != null) {
    const pid = Number(body.defaultProfileId);
    const owned = await db.first(
      c.env.DB,
      'SELECT 1 AS ok FROM profiles WHERE id = ? AND user_id = ?',
      pid,
      c.get('userId')
    );
    if (!owned) throw new HttpError(403, 'That profile does not belong to this user.');
    defaultProfileId = pid;
  }

  const minted = await mintApiToken(c.env.DB, c.get('userId'), {
    name,
    scopes,
    defaultProfileId,
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
  });
  // The only time the secret is ever returned. It is not recoverable afterwards.
  return c.json(minted, 201);
});

apiTokensRoutes.get('/api/account/api-tokens', requireAuth, async (c) => {
  const tokens = await db.all(
    c.env.DB,
    `SELECT id, name, hint, scopes, default_profile_id, created_at, last_used_at, expires_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    c.get('userId')
  );
  return c.json({ tokens });
});

apiTokensRoutes.delete('/api/account/api-tokens/:id', requireAuth, async (c) => {
  const res = await db.run(
    c.env.DB,
    "UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    c.req.param('id'),
    c.get('userId')
  );
  // 404 rather than 403 for a token this user does not own: whether some other account holds
  // that id is not a fact worth confirming.
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(404, 'Token not found.');
  return c.json({ ok: true });
});
