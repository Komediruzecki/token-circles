/**
 * Email sign-in codes: mint a 6-digit code (stored hashed, mailed to the user), verify it once.
 *
 * The code space is only 10^6, so the security lives in the layers around it: the verify step is
 * addressed to ONE row (the ceremony cookie the route minted alongside the code), each row burns
 * after LOGIN_CODE_MAX_ATTEMPTS wrong guesses, codes are single-use with a 10-minute TTL, and the
 * route adds a per-IP rate limit. A new request does NOT invalidate codes already in flight —
 * that would let anyone kill the code a user is busy typing just by firing /request for their
 * address — instead the live set is capped at MAX_ACTIVE_CODES, oldest pruned first.
 */

export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
const MAX_ACTIVE_CODES = 3;

interface CodeEnv {
  DB: D1Database;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rejection sampling keeps every code exactly equally likely (2^32 % 10^6 != 0). */
export function generateLoginCode(): string {
  const LIMIT = 4_294_000_000; // largest multiple of 10^6 that fits in a uint32
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < LIMIT) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

/** Equal CPU for the unknown-address branch of /request (anti-enumeration timing parity). */
export async function hashLoginCode(code: string): Promise<string> {
  return sha256Hex(code);
}

/**
 * Mint a fresh code and return the RAW code plus its row id — the caller mails the code and
 * binds the id into the ceremony cookie; only the hash touches the database.
 */
export async function createLoginCode(
  env: CodeEnv,
  userId: number,
  email: string
): Promise<{ code: string; id: number }> {
  const code = generateLoginCode();
  const hash = await sha256Hex(code);
  const res = await env.DB.prepare(
    `INSERT INTO login_codes (user_id, email, code_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+${LOGIN_CODE_TTL_MINUTES} minutes'))`
  )
    .bind(userId, email, hash)
    .run();
  const id = res.meta.last_row_id as number;
  // Cap the live set instead of wiping it: the newest MAX_ACTIVE_CODES stay valid.
  await env.DB.prepare(
    `DELETE FROM login_codes
     WHERE user_id = ? AND used_at IS NULL
       AND id NOT IN (
         SELECT id FROM login_codes WHERE user_id = ? AND used_at IS NULL
         ORDER BY id DESC LIMIT ${MAX_ACTIVE_CODES}
       )`
  )
    .bind(userId, userId)
    .run();
  return { code, id };
}

/**
 * Consume a code — addressed to one specific row, the one the caller's ceremony cookie names.
 * Returns the user id exactly once for a live match, null otherwise. A wrong guess increments
 * the row's attempt counter; at LOGIN_CODE_MAX_ATTEMPTS the row stops matching forever. The
 * claiming UPDATE is the atomic gate, so a double submit cannot sign in twice.
 */
export async function verifyLoginCode(
  env: CodeEnv,
  codeId: number,
  email: string,
  code: string
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const hash = await sha256Hex(code);
  const row = await env.DB.prepare(
    `SELECT id, user_id, code_hash FROM login_codes
     WHERE id = ? AND email = ? AND used_at IS NULL
       AND expires_at > datetime('now') AND attempts < ${LOGIN_CODE_MAX_ATTEMPTS}`
  )
    .bind(codeId, email)
    .first<{ id: number; user_id: number; code_hash: string }>();
  if (!row) return null;
  if (row.code_hash !== hash) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?')
      .bind(codeId)
      .run();
    return null;
  }
  const res = await env.DB.prepare(
    `UPDATE login_codes SET used_at = datetime('now')
     WHERE id = ? AND used_at IS NULL AND attempts < ${LOGIN_CODE_MAX_ATTEMPTS}`
  )
    .bind(row.id)
    .run();
  return (res.meta.changes ?? 0) > 0 ? row.user_id : null;
}
