import * as db from './db';

// Personal access tokens. Bearer credentials for /mcp and /api/v1/*, and for nothing else --
// see requireToken (added alongside the middleware) for why that boundary is an allow-list
// rather than a deny-list.

export type Scope = 'read' | 'write' | 'import';
export const TOKEN_PREFIX = 'tc_pat_';

/** last_used_at is a "roughly when" field, so pay one write an hour for it, not one per request. */
const TOKEN_TOUCH_SECONDS = 3600;

export interface TokenIdentity {
  tokenId: string;
  userId: number;
  scopes: Scope[];
  defaultProfileId: number | null;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex. Deliberately not a KDF -- see the comment in 0027_api_tokens.sql. */
export async function hashToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mintApiToken(
  DB: D1Database,
  userId: number,
  opts: {
    name: string;
    scopes: Scope[];
    defaultProfileId?: number | null;
    expiresAt?: string | null;
  }
): Promise<{ id: string; secret: string; hint: string }> {
  const random = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const secret = `${TOKEN_PREFIX}${random}`;
  const id = crypto.randomUUID();
  await db.insert(DB, 'api_tokens', {
    id,
    user_id: userId,
    name: opts.name,
    token_hash: await hashToken(secret),
    hint: random.slice(0, 8),
    scopes: JSON.stringify(opts.scopes),
    default_profile_id: opts.defaultProfileId ?? null,
    expires_at: opts.expiresAt ?? null,
  });
  return { id, secret, hint: random.slice(0, 8) };
}

/**
 * Resolve a raw secret to its identity, or null.
 *
 * Note what is NOT checked: users.token_version. That counter is the blunt instrument behind
 * "sign out everywhere", and applying it here would mean signing out a laptop silently stops a
 * nightly import routine. Revoking an API token is its own explicit action (revoked_at).
 */
export async function verifyApiToken(DB: D1Database, raw: string): Promise<TokenIdentity | null> {
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const row = await db.first<{
    id: string;
    user_id: number;
    scopes: string;
    default_profile_id: number | null;
    expires_at: string | null;
    revoked_at: string | null;
  }>(
    DB,
    `SELECT id, user_id, scopes, default_profile_id, expires_at, revoked_at
       FROM api_tokens WHERE token_hash = ?`,
    await hashToken(raw)
  );
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  // Conditional, so an active token costs one write per TOKEN_TOUCH_SECONDS rather than one per
  // request. Fire-and-forget: a failed touch must never fail the request.
  void db
    .run(
      DB,
      `UPDATE api_tokens SET last_used_at = datetime('now')
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= datetime('now', ?))`,
      row.id,
      `-${TOKEN_TOUCH_SECONDS} seconds`
    )
    .catch(() => undefined);

  let scopes: Scope[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes);
    if (Array.isArray(parsed)) scopes = parsed.filter((s): s is Scope => typeof s === 'string');
  } catch {
    scopes = [];
  }
  return {
    tokenId: row.id,
    userId: row.user_id,
    scopes,
    defaultProfileId: row.default_profile_id,
  };
}

// ── Middleware ────────────────────────────────────────────────────────────────
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './index';
import { HttpError } from './http';

/**
 * Bearer auth for /mcp and /api/v1/* ONLY.
 *
 * This is deliberately a separate middleware rather than a new branch inside
 * authenticateRequest(): mounting it per-route is an allow-list, so a route is unreachable by
 * token until somebody deliberately mounts it. Teaching the global path to read the
 * Authorization header would be a deny-list, and a deny-list fails open on the next route added.
 */
export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const identity = raw ? await verifyApiToken(c.env.DB, raw) : null;
  if (!identity) return c.json({ error: 'Unauthorized' }, 401);
  c.set('userId', identity.userId);
  c.set('token', identity);
  await next();
};

/** 403 unless the calling token carries `scope`. */
export function assertScope(c: Context<AppEnv>, scope: Scope): void {
  const token = c.get('token');
  if (!token || !token.scopes.includes(scope)) {
    throw new HttpError(403, `This token lacks the "${scope}" scope.`);
  }
}
