/**
 * A signed-in session for a test, issued the way a sign-in route issues one: bound to the
 * account's token_version as it stands now. The account must exist.
 *
 * sessionCookie confirms the account's address first. A password account whose address is not
 * confirmed reaches only the routes confirming it needs (requireAuth answers the rest 403
 * EMAIL_UNCONFIRMED), and most tests insert their account without saying either way, which
 * leaves it unconfirmed. A test about an account waiting for its link uses
 * unconfirmedSessionCookie, which leaves the account as it is.
 */
import { env } from 'cloudflare:test';
import { issueSessionCookie, type SessionOrigin } from '../../src/auth';
import type { Env } from '../../src/index';

/** The whole Set-Cookie header for a new session of `userId`, whose address is confirmed first. */
export async function sessionCookie(
  userId: number,
  provider = 'password',
  e: Env = env as unknown as Env,
  origin: SessionOrigin = {}
): Promise<string> {
  await e.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
  return unconfirmedSessionCookie(userId, provider, e, origin);
}

/** The whole Set-Cookie header for a new session of `userId`, with its address left as it is. */
export async function unconfirmedSessionCookie(
  userId: number,
  provider = 'password',
  e: Env = env as unknown as Env,
  origin: SessionOrigin = {}
): Promise<string> {
  const row = await e.DB.prepare('SELECT token_version FROM users WHERE id = ?')
    .bind(userId)
    .first<{ token_version: number }>();
  if (!row) throw new Error(`sessionCookie: there is no user ${userId}`);
  const cookie = await issueSessionCookie(
    e,
    { userId, provider, tokenVersion: row.token_version },
    origin
  );
  if (!cookie) throw new Error(`sessionCookie: no session was written for user ${userId}`);
  return cookie;
}
