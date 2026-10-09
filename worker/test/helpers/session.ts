/**
 * A signed-in session for a test, issued the way a sign-in route issues one: bound to the
 * account's token_version as it stands now. The account must exist.
 */
import { env } from 'cloudflare:test';
import { issueSessionCookie, type SessionOrigin } from '../../src/auth';
import type { Env } from '../../src/index';

/** The whole Set-Cookie header for a new session of `userId`. */
export async function sessionCookie(
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
