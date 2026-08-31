import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { HttpError } from '../http';
import { mintApiToken, parseScopes, type Scope } from '../apitoken';
import * as db from '../db';
import { enforce } from '../ratelimit';

// Cookie-authed token management. Deliberately NOT reachable with a bearer token: a leaked
// API token must not be able to mint itself more tokens, or wider scopes.
export const apiTokensRoutes = new Hono<AppEnv>();

const VALID_SCOPES: Scope[] = ['read', 'write', 'import'];

apiTokensRoutes.post('/api/account/api-tokens', requireAuth, async (c) => {
  // A minted token is a long-lived credential that deliberately survives sign-out-everywhere,
  // so minting is budgeted like the other credential-issuing routes.
  const limited = await enforce(c, `api-token-mint:${c.get('userId')}`, 20, 3600);
  if (limited) return limited;
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

  // verifyApiToken compares getTime() <= now, and NaN fails that comparison — an unparseable
  // expiry would mint a token that never expires while the listing shows one.
  let expiresAt: string | null = null;
  if (body.expiresAt != null) {
    const raw = typeof body.expiresAt === 'string' ? body.expiresAt : '';
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) throw new HttpError(422, 'expiresAt must be a valid date.');
    if (parsed <= Date.now()) throw new HttpError(422, 'expiresAt must be in the future.');
    expiresAt = raw;
  }

  const minted = await mintApiToken(c.env.DB, c.get('userId'), {
    name,
    scopes,
    defaultProfileId,
    expiresAt,
  });
  // The only time the secret is ever returned. It is not recoverable afterwards.
  return c.json(minted, 201);
});

apiTokensRoutes.get('/api/account/api-tokens', requireAuth, async (c) => {
  const rows = await db.all<{ scopes: string } & Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, hint, scopes, default_profile_id, created_at, last_used_at, expires_at, revoked_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
    c.get('userId')
  );
  // Scopes are stored stringified; hand back an array rather than make every client JSON.parse
  // a field of an already-parsed response. parseScopes is the same tolerance rule the auth path
  // uses: a row that does not hold an array degrades to no scopes, not a failed listing.
  const tokens = rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) }));
  return c.json({ tokens });
});

apiTokensRoutes.delete('/api/account/api-tokens/:id', requireAuth, async (c) => {
  // Idempotent: revoking an already-revoked token succeeds (two tabs, or a retry after a flaky
  // refresh — the token is in exactly the state the user asked for), and COALESCE keeps the
  // original timestamp. 404 rather than 403 for a token this user does not own: whether some
  // other account holds that id is not a fact worth confirming.
  const res = await db.run(
    c.env.DB,
    "UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ? AND user_id = ?",
    c.req.param('id'),
    c.get('userId')
  );
  if ((res.meta.changes ?? 0) === 0) throw new HttpError(404, 'Token not found.');
  return c.json({ ok: true });
});
