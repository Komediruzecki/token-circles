/**
 * The emailed links that confirm an address or move an account to a new one (migration 0031):
 * spending one, and finishing one after a sign-in in the browser that opened it.
 *
 * GET /api/auth/verify-email spends a link only for its own account's session. Opened in a
 * browser without that session, the link stays unspent and the browser gets a marker: an HttpOnly
 * cookie on this API origin, sent only to POST /api/auth/email-link/finish, that names the link
 * and lasts 30 minutes. The app calls that route once someone signs in there, and the link
 * finishes if the session's account is the link's and the link is still unspent and unexpired.
 *
 * The marker is the link's row id and the marker's own expiry, signed with JWT_SECRET over the
 * link's token hash as well, so it names that one link and nothing a later row could reuse.
 */
import type { Env } from './index';
import { b64urlDecode, b64urlEncode, hmacKey, readCookies } from './auth';
import { applyEmailChange } from './email-change';

export const EMAIL_LINK_COOKIE = 'fm_email_link';
/** The one route that reads the marker. A cookie's Path is a prefix, so this is as narrow as it gets. */
export const EMAIL_LINK_FINISH_PATH = '/api/auth/email-link/finish';
export const EMAIL_LINK_MARKER_SECONDS = 30 * 60;

/** A row of email_verifications, as the routes that spend one read it. */
export interface EmailLink {
  id: number;
  user_id: number;
  email: string;
  expires_at: string;
  purpose: string;
  used_at: string | null;
  token_hash: string;
}

export const EMAIL_LINK_COLUMNS = 'id, user_id, email, expires_at, purpose, used_at, token_hash';

export function linkExpired(link: Pick<EmailLink, 'expires_at'>): boolean {
  return Date.parse(link.expires_at) < Date.now();
}

/** What spending a link did. */
export type SpentLink =
  'confirmed' | 'changed' | 'email_taken' | 'expired' | 'invalid' | 'server_error';

/**
 * Spend `link` for its own account and apply it. Single use: the link is spent whatever the
 * outcome, so a link that failed for any reason cannot be retried until it happens to succeed.
 * `AND used_at IS NULL` makes spending it the claim, so of two requests carrying the same link
 * only one gets past it.
 */
export async function spendLink(db: D1Database, link: EmailLink): Promise<SpentLink> {
  const claimed = await db
    .prepare(
      "UPDATE email_verifications SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL"
    )
    .bind(link.id)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return 'invalid';
  if (linkExpired(link)) return 'expired';
  // The link is spent. Whatever goes wrong from here is an outcome, not an exception: the person
  // arrived from a mail, and an error page would leave them nowhere.
  try {
    if (link.purpose === 'change') {
      // The account moves to the address this link was mailed to, unless another account has it
      // by now: a pending change holds nothing, so someone may have signed up with it meanwhile.
      const outcome = await applyEmailChange(db, link.user_id, link.email);
      if (outcome === 'taken') return 'email_taken';
      if (outcome === 'gone') return 'invalid';
      return 'changed';
    }
    const user = await db
      .prepare('SELECT email FROM users WHERE id = ?')
      .bind(link.user_id)
      .first<{ email: string | null }>();
    // The address has to still be the one this link was sent to, or changing the address after
    // asking for a link would confirm the new one on the strength of mail sent to the old.
    if (!user || (user.email ?? '').toLowerCase() !== link.email.toLowerCase()) return 'invalid';
    await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(link.user_id).run();
    return 'confirmed';
  } catch (e) {
    console.error('An email link failed after it was spent:', e);
    return 'server_error';
  }
}

// ── The marker ─────────────────────────────────────────────────────────────────────────────────

function markerCookie(value: string, maxAgeSeconds: number, env: Env): string {
  // Host-only (no Domain) and Path-limited: no other route and no other host ever receives it.
  const secure = env.APP_ENV !== 'development'; // local http dev can't send Secure cookies
  return [
    `${EMAIL_LINK_COOKIE}=${value}`,
    `Path=${EMAIL_LINK_FINISH_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

async function markerKey(env: Env): Promise<CryptoKey> {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET not configured');
  return hmacKey(env.JWT_SECRET);
}

const markerData = (id: number, exp: number, tokenHash: string) =>
  new TextEncoder().encode(`email-link.${id}.${exp}.${tokenHash}`);

/** The Set-Cookie that leaves `link`'s marker in this browser. */
export async function markerFor(
  env: Env,
  link: Pick<EmailLink, 'id' | 'token_hash'>
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + EMAIL_LINK_MARKER_SECONDS;
  const sig = await crypto.subtle.sign(
    'HMAC',
    await markerKey(env),
    markerData(link.id, exp, link.token_hash)
  );
  return markerCookie(`${link.id}.${exp}.${b64urlEncode(sig)}`, EMAIL_LINK_MARKER_SECONDS, env);
}

/** The Set-Cookie that removes the marker. */
export function clearedMarker(env: Env): string {
  return markerCookie('', 0, env);
}

/**
 * The link this request's marker names, or null when it carries none that is genuine and
 * unexpired. `carried` says whether it carried a marker at all, so the caller clears only a
 * cookie that exists.
 */
export async function markedLink(
  request: Request,
  env: Env,
  db: D1Database
): Promise<{ link: EmailLink | null; carried: boolean }> {
  const values = readCookies(request, EMAIL_LINK_COOKIE).filter((v) => v !== '');
  for (const value of values) {
    const [idPart, expPart, sigPart, ...rest] = value.split('.');
    if (rest.length > 0 || !idPart || !expPart || !sigPart) continue;
    const id = Number(idPart);
    const exp = Number(expPart);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(exp)) continue;
    if (exp <= Math.floor(Date.now() / 1000)) continue;
    const link = await db
      .prepare(`SELECT ${EMAIL_LINK_COLUMNS} FROM email_verifications WHERE id = ?`)
      .bind(id)
      .first<EmailLink>();
    if (!link) continue;
    let sig: Uint8Array;
    try {
      sig = b64urlDecode(sigPart);
    } catch {
      continue;
    }
    const genuine = await crypto.subtle.verify(
      'HMAC',
      await markerKey(env),
      sig,
      markerData(id, exp, link.token_hash)
    );
    if (genuine) return { link, carried: true };
  }
  return { link: null, carried: values.length > 0 };
}
