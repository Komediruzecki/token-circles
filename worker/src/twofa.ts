/**
 * 2FA storage layer: TOTP secrets encrypted at rest, single-use recovery codes.
 *
 * The at-rest key is HKDF-derived from JWT_SECRET rather than a new deployment secret, so
 * enabling 2FA needs zero ops work. The trade-off (documented in migration 0028): rotating
 * JWT_SECRET orphans TOTP secrets. getTotpForLogin fails CLOSED for that case — a confirmed
 * credential keeps demanding a second factor and the hashed recovery codes still verify.
 */
import { b64urlDecode, b64urlEncode, cookie, hmacKey } from './auth';
import type { Env } from './index';
import { base32Encode } from './totp';

interface TwofaEnv {
  DB: D1Database;
}

const HKDF_INFO = 'token-circles totp-secret v1';

async function totpKek(jwtSecret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** `b64url(iv).b64url(ciphertext)` — a fresh IV every call, mandatory for GCM. */
export async function encryptTotpSecret(secretB32: string, jwtSecret: string): Promise<string> {
  const key = await totpKek(jwtSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secretB32)
  );
  return `${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function decryptTotpSecret(stored: string, jwtSecret: string): Promise<string | null> {
  try {
    const [ivPart, ctPart] = stored.split('.');
    if (!ivPart || !ctPart) return null;
    const key = await totpKek(jwtSecret);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(ivPart) as unknown as Uint8Array<ArrayBuffer> },
      key,
      b64urlDecode(ctPart) as unknown as Uint8Array<ArrayBuffer>
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/** 10 codes shaped XXXXX-XXXXX from the base32 alphabet (~50 bits each, unbiased). */
export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const raw = base32Encode(crypto.getRandomValues(new Uint8Array(10))).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Users retype these from paper: case and separators must not matter. */
function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function enrollTotp(
  env: TwofaEnv & { JWT_SECRET?: string },
  userId: number,
  secretB32: string
): Promise<void> {
  if (!env.JWT_SECRET) throw new Error('Auth not configured');
  const secretEnc = await encryptTotpSecret(secretB32, env.JWT_SECRET);
  // Replaces only a PENDING enrollment. A confirmed credential is never silently overwritten —
  // the route refuses setup while 2FA is on, and this WHERE backs that up at the data layer.
  await env.DB.prepare(
    `INSERT INTO totp_credentials (user_id, secret_enc) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       secret_enc = excluded.secret_enc, last_used_step = NULL, created_at = datetime('now')
     WHERE totp_credentials.confirmed_at IS NULL`
  )
    .bind(userId, secretEnc)
    .run();
}

export async function confirmTotp(env: TwofaEnv, userId: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE totp_credentials SET confirmed_at = datetime('now') WHERE user_id = ?"
  )
    .bind(userId)
    .run();
}

export async function disableTotp(env: TwofaEnv, userId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(userId),
  ]);
}

export interface TotpStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export async function totpStatus(env: TwofaEnv, userId: number): Promise<TotpStatus> {
  const row = await env.DB.prepare(
    `SELECT (SELECT confirmed_at FROM totp_credentials WHERE user_id = ?1) AS confirmed_at,
            (SELECT COUNT(*) FROM recovery_codes WHERE user_id = ?1 AND used_at IS NULL) AS left`
  )
    .bind(userId)
    .first<{ confirmed_at: string | null; left: number }>();
  return { enabled: !!row?.confirmed_at, recoveryCodesLeft: row?.left ?? 0 };
}

export interface TotpLoginCredential {
  /** Decrypted base32 secret, or null when decryption fails (fail closed — see module doc). */
  secret: string | null;
  lastUsedStep: number | null;
}

/** Null only when the user has no CONFIRMED credential; pending enrollments never challenge. */
export async function getTotpForLogin(
  env: TwofaEnv & { JWT_SECRET?: string },
  userId: number
): Promise<TotpLoginCredential | null> {
  const row = await env.DB.prepare(
    'SELECT secret_enc, last_used_step FROM totp_credentials WHERE user_id = ? AND confirmed_at IS NOT NULL'
  )
    .bind(userId)
    .first<{ secret_enc: string; last_used_step: number | null }>();
  if (!row) return null;
  const secret = env.JWT_SECRET ? await decryptTotpSecret(row.secret_enc, env.JWT_SECRET) : null;
  return { secret, lastUsedStep: row.last_used_step };
}

export async function markTotpStepUsed(env: TwofaEnv, userId: number, step: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE totp_credentials SET last_used_step = MAX(COALESCE(last_used_step, -1), ?) WHERE user_id = ?'
  )
    .bind(step, userId)
    .run();
}

/** Replaces any previous batch — old sheets of codes stop working the moment new ones exist. */
export async function storeRecoveryCodes(
  env: TwofaEnv,
  userId: number,
  codes: string[]
): Promise<void> {
  const hashes = await Promise.all(codes.map((c) => sha256Hex(normalizeRecoveryCode(c))));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(userId),
    ...hashes.map((h) =>
      env.DB.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)').bind(
        userId,
        h
      )
    ),
  ]);
}

/** Decrypted secret of a PENDING (unconfirmed) enrollment — what /2fa/enable verifies against. */
export async function getPendingTotpSecret(
  env: TwofaEnv & { JWT_SECRET?: string },
  userId: number
): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT secret_enc FROM totp_credentials WHERE user_id = ? AND confirmed_at IS NULL'
  )
    .bind(userId)
    .first<{ secret_enc: string }>();
  if (!row || !env.JWT_SECRET) return null;
  return decryptTotpSecret(row.secret_enc, env.JWT_SECRET);
}

// ── The pending-2FA challenge ─────────────────────────────────────────────────
//
// Between "password (or Google) checked out" and "TOTP checked out" the browser holds a short-
// lived signed token in its own httpOnly cookie — never a session. Possessing it grants nothing
// but the right to attempt a code, so login stays a single POST for the 99% without 2FA and
// becomes two POSTs for the rest.

export const TWOFA_COOKIE = 'fm_2fa';
const TWOFA_CHALLENGE_TTL_SECONDS = 300;

interface TwofaChallenge {
  userId: number;
  /** Carried through so the session records how the first factor was proven. */
  provider: string;
  exp: number;
}

async function hmacB64url(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64urlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export async function issueTwofaChallengeCookie(
  userId: number,
  provider: string,
  env: Env
): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('Auth not configured');
  const challenge: TwofaChallenge = {
    userId,
    provider,
    exp: Math.floor(Date.now() / 1000) + TWOFA_CHALLENGE_TTL_SECONDS,
  };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(challenge)));
  const token = `${payload}.${await hmacB64url(payload, env.JWT_SECRET)}`;
  return cookie(TWOFA_COOKIE, token, TWOFA_CHALLENGE_TTL_SECONDS, env);
}

export function clearedTwofaCookie(env: Env): string {
  return cookie(TWOFA_COOKIE, '', 0, env);
}

export async function verifyTwofaChallenge(
  raw: string,
  env: { JWT_SECRET?: string }
): Promise<{ userId: number; provider: string } | null> {
  if (!env.JWT_SECRET) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = await hmacB64url(payload, env.JWT_SECRET);
  if (mac.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as TwofaChallenge;
    if (typeof parsed.userId !== 'number' || typeof parsed.provider !== 'string') return null;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: parsed.userId, provider: parsed.provider };
  } catch {
    return null;
  }
}

/** True exactly once per code: the UPDATE claims it atomically. */
export async function consumeRecoveryCode(
  env: TwofaEnv,
  userId: number,
  code: string
): Promise<boolean> {
  const hash = await sha256Hex(normalizeRecoveryCode(code));
  const res = await env.DB.prepare(
    "UPDATE recovery_codes SET used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL"
  )
    .bind(userId, hash)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
