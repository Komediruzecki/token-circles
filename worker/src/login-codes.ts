/**
 * Email sign-in codes: mint a 6-digit code (stored hashed, mailed to the user), verify it once.
 *
 * The code space is only 10^6, so the security lives in the layers around it: single active code
 * per user, single use, 10-minute TTL, and the verify endpoint's rate limit (the route's job).
 */

export const LOGIN_CODE_TTL_MINUTES = 10;

interface CodeEnv {
  DB: D1Database;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rejection sampling keeps every code exactly equally likely (2^32 % 10^6 != 0). */
function generateLoginCode(): string {
  const LIMIT = 4_294_000_000; // largest multiple of 10^6 that fits in a uint32
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < LIMIT) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

/**
 * Invalidate any previous unused codes for the user, mint a fresh one, and return the RAW code —
 * the caller mails it; only the hash touches the database.
 */
export async function createLoginCode(
  env: CodeEnv,
  userId: number,
  email: string
): Promise<string> {
  const code = generateLoginCode();
  const hash = await sha256Hex(code);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE user_id = ? AND used_at IS NULL').bind(userId),
    env.DB.prepare(
      `INSERT INTO login_codes (user_id, email, code_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+${LOGIN_CODE_TTL_MINUTES} minutes'))`
    ).bind(userId, email, hash),
  ]);
  return code;
}

/**
 * Consume a code: returns the user id exactly once for a live match, null otherwise.
 * The UPDATE claims the row atomically, so a double submit cannot sign in twice.
 */
export async function verifyLoginCode(
  env: CodeEnv,
  email: string,
  code: string
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const hash = await sha256Hex(code);
  const row = await env.DB.prepare(
    `SELECT id, user_id FROM login_codes
     WHERE email = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
  )
    .bind(email, hash)
    .first<{ id: number; user_id: number }>();
  if (!row) return null;
  const res = await env.DB.prepare(
    "UPDATE login_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL"
  )
    .bind(row.id)
    .run();
  return (res.meta.changes ?? 0) > 0 ? row.user_id : null;
}
