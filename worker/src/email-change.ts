/**
 * A new account email takes effect once the new address confirms it.
 *
 * Asking for a different address (Settings saves it with PUT /api/notifications/settings) stores a
 * pending change: an email_verifications row with purpose 'change' (migration 0031), whose link is
 * mailed to the new address. The account keeps its address, and whether that address is
 * confirmed, until the link is opened; GET /api/auth/verify-email then calls applyEmailChange.
 */
import type { Context } from 'hono';
import type { AppEnv } from './index';
import * as db from './db';
import { sendMail } from './email';
import { insertEmailVerification, verifyLink, VERIFY_TOKEN_TTL_HOURS } from './email-verification';
import { renderEmailChange, renderEmailChangeNotice } from './emailTemplates';
import { HttpError } from './http';
import { clientIp, enforce } from './ratelimit';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// The longest address SMTP carries (RFC 5321). The address is written into mail, so it is bounded.
const MAX_EMAIL_LENGTH = 254;

// One address gets at most three links an hour, the cap sign-in codes have (routes/email-code.ts),
// and asking again shares it. One account asks for at most five changes an hour and ten a day,
// whatever the addresses, so a session cannot mail its way down a list. One network address asks
// for at most twenty an hour, whichever accounts it signs in to.
const PER_ADDRESS_LIMIT = 3;
const PER_ACCOUNT_LIMIT = 5;
const PER_ACCOUNT_DAILY_LIMIT = 10;
const PER_IP_LIMIT = 20;
const LIMIT_WINDOW_SEC = 3600;
const DAY_SEC = 86_400;

const appBase = (c: Context<AppEnv>) =>
  c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;

/** The address a change is waiting on, while its link can still be opened. */
export async function pendingEmailChange(d1: D1Database, userId: number): Promise<string | null> {
  // expires_at is ISO 8601, so it is compared with an ISO now.
  const row = await db.first<{ email: string }>(
    d1,
    `SELECT email FROM email_verifications
     WHERE user_id = ? AND purpose = 'change' AND used_at IS NULL AND expires_at > ?
     ORDER BY id DESC LIMIT 1`,
    userId,
    new Date().toISOString()
  );
  return row?.email ?? null;
}

/**
 * Whether another account has `email`, in any case: some sign-ups have stored an address with its
 * capitals. A pending change holds nothing, so it never counts.
 */
async function emailInUse(d1: D1Database, email: string, userId: number): Promise<boolean> {
  return !!(await db.first(
    d1,
    'SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?',
    email,
    userId
  ));
}

/**
 * The key one address's limit is counted under. Spellings that reach the same inbox share it: any
 * case, a trailing dot on the domain, a +tag. Only the limit uses this; the address is kept as
 * given everywhere else.
 */
function addressBucket(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return email.toLowerCase();
  const local = email.slice(0, at).toLowerCase().split('+')[0];
  const domain = email
    .slice(at + 1)
    .toLowerCase()
    .replace(/\.+$/, '');
  return `${local}@${domain}`;
}

/** The 429 to send when `userId` may not mail `email` a link now, or null when it may. */
async function limitEmailChange(
  c: Context<AppEnv>,
  userId: number,
  email: string
): Promise<Response | null> {
  return (
    (await enforce(c, `email-change-ip:${clientIp(c)}`, PER_IP_LIMIT, LIMIT_WINDOW_SEC)) ??
    (await enforce(c, `email-change-account:${userId}`, PER_ACCOUNT_LIMIT, LIMIT_WINDOW_SEC)) ??
    (await enforce(c, `email-change-account-day:${userId}`, PER_ACCOUNT_DAILY_LIMIT, DAY_SEC)) ??
    (await enforce(c, `email-change:${addressBucket(email)}`, PER_ADDRESS_LIMIT, LIMIT_WINDOW_SEC))
  );
}

/**
 * Mail `email` the link that moves `userId` to it, replacing any change still waiting. Asking for
 * a change and sending its link again both come here. Returns the 429 past the limits above, and
 * throws 409 when another account has the address, since that link could not work. The limits
 * come first, so they bound the 409 answer too.
 *
 * Returns a 502 when the mail could not be sent. Then nothing changes: the new link is dropped, and
 * a change already waiting keeps its link.
 */
export async function sendEmailChangeLink(
  c: Context<AppEnv>,
  userId: number,
  email: string
): Promise<Response | null> {
  const limited = await limitEmailChange(c, userId, email);
  if (limited) return limited;
  if (await emailInUse(c.env.DB, email, userId)) {
    throw new HttpError(409, 'That email is already in use');
  }
  const base = appBase(c);
  const { token, id } = await insertEmailVerification(c.env.DB, userId, email, 'change');
  const mail = renderEmailChange({
    link: verifyLink(new URL(c.req.url).origin, token, base),
    ttlHours: VERIFY_TOKEN_TTL_HOURS,
    assetOrigin: base,
  });
  const result = await sendMail(c.env, email, mail.subject, mail.html, { text: mail.text }).catch(
    (e: unknown) => {
      console.error('Email change link failed to send:', e);
      return { sent: false, skipped: false };
    }
  );
  // Without a mail key (local development) the send is skipped, which is not a failure.
  if (!result.sent && !result.skipped) {
    await db.run(c.env.DB, 'DELETE FROM email_verifications WHERE id = ?', id);
    return c.json({ error: "We couldn't send the link. Try again in a moment." }, 502);
  }
  // Sent: this link replaces any change still waiting.
  await db.run(
    c.env.DB,
    "DELETE FROM email_verifications WHERE user_id = ? AND purpose = 'change' AND used_at IS NULL AND id != ?",
    userId,
    id
  );
  return null;
}

/**
 * Tell the account's current address that a change was asked for: that is how the owner hears of
 * it. `named` is the new address, or null to leave it out. Best-effort, like the other notices;
 * the change itself does not wait on it.
 */
async function mailEmailChangeNotice(
  c: Context<AppEnv>,
  current: string,
  named: string | null
): Promise<void> {
  const notice = renderEmailChangeNotice({ newEmail: named, appUrl: appBase(c) });
  await sendMail(c.env, current, notice.subject, notice.html, { text: notice.text }).catch(
    (e: unknown) => {
      console.error('Email change notice failed to send:', e);
    }
  );
}

/**
 * Ask to move `userId` from its `current` address to `email` (trimmed and lowercased by the
 * caller, and different from the current one). Throws 400 for something that is not an address
 * and 409 for one another account has; returns the 429 past the limits above, and null once the
 * link has gone to `email` and the notice to the current address.
 */
export async function requestEmailChange(
  c: Context<AppEnv>,
  userId: number,
  email: string,
  current: { email: string | null; confirmed: boolean }
): Promise<Response | null> {
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, 'A valid email is required');
  }
  const limited = await sendEmailChangeLink(c, userId, email);
  if (limited) return limited;
  // An account with no address yet (a Google sign-up whose address Google had not confirmed) has
  // nobody to tell. An address nobody has confirmed may not be the owner's, so its notice says a
  // change was asked for without naming the new address.
  if (current.email) {
    await mailEmailChangeNotice(c, current.email, current.confirmed ? email : null);
  }
  return null;
}

/** End the change waiting for `userId`, if there is one. The confirm link for the current address stays. */
export async function cancelEmailChange(d1: D1Database, userId: number): Promise<void> {
  await db.run(
    d1,
    "DELETE FROM email_verifications WHERE user_id = ? AND purpose = 'change' AND used_at IS NULL",
    userId
  );
}

/**
 * Move `userId` to `email`, which the link mailed there has just proved, and mark it confirmed.
 *
 * 'taken' when another account has the address by now (a pending change holds nothing, so someone
 * may have signed up with it meanwhile), and then nothing changes. 'gone' when the account is.
 */
export async function applyEmailChange(
  d1: D1Database,
  userId: number,
  email: string
): Promise<'changed' | 'taken' | 'gone'> {
  // One batch: the move, and the end of everything else the account has out by mail: a change
  // still waiting, the confirm link for the address it leaves, and the password reset links and
  // sign-in codes that address was sent. Each DELETE only matches once the row has `email`, so a
  // refused move ends nothing.
  const onceMoved = (sql: string) =>
    d1.prepare(`${sql} AND (SELECT email FROM users WHERE id = ?) = ?`).bind(userId, userId, email);
  const [moved] = await d1.batch([
    d1
      .prepare(
        `UPDATE users SET email = ?, email_verified = 1
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(?) AND id != ?)`
      )
      .bind(email, userId, email, userId),
    onceMoved('DELETE FROM email_verifications WHERE user_id = ? AND used_at IS NULL'),
    onceMoved('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL'),
    onceMoved('DELETE FROM login_codes WHERE user_id = ? AND used_at IS NULL'),
  ]);
  if ((moved.meta.changes ?? 0) > 0) return 'changed';
  return (await db.first(d1, 'SELECT id FROM users WHERE id = ?', userId)) ? 'taken' : 'gone';
}
