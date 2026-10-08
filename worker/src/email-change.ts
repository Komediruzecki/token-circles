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
import { createEmailVerification, verifyLink, VERIFY_TOKEN_TTL_HOURS } from './email-verification';
import { renderEmailChange, renderEmailChangeNotice } from './emailTemplates';
import { HttpError } from './http';
import { enforce } from './ratelimit';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// The longest address SMTP carries (RFC 5321). The address is written into mail, so it is bounded.
const MAX_EMAIL_LENGTH = 254;

// One address gets at most three links an hour, the cap sign-in codes have (routes/email-code.ts),
// and asking again shares it. One account asks for at most five changes an hour and ten a day,
// whatever the addresses, so a session cannot mail its way down a list.
const PER_ADDRESS_LIMIT = 3;
const PER_ACCOUNT_LIMIT = 5;
const PER_ACCOUNT_DAILY_LIMIT = 10;
const LIMIT_WINDOW_SEC = 3600;
const DAY_SEC = 86_400;

const appBase = (c: Context<AppEnv>) =>
  c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;

/** The address a change is waiting on, while its link can still be opened. */
export async function pendingEmailChange(d1: D1Database, userId: number): Promise<string | null> {
  // expires_at is an ISO string (createEmailVerification), so "now" is one too. Against
  // datetime('now'), whose space sorts before ISO's 'T', a link that expired earlier the same day
  // would still read as live.
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

/** Whether another account has `email`. A pending change holds nothing, so it never counts. */
async function emailInUse(d1: D1Database, email: string, userId: number): Promise<boolean> {
  return !!(await db.first(d1, 'SELECT id FROM users WHERE email = ? AND id != ?', email, userId));
}

/** The 429 to send when `userId` may not mail `email` a link now, or null when it may. */
async function limitEmailChange(
  c: Context<AppEnv>,
  userId: number,
  email: string
): Promise<Response | null> {
  return (
    (await enforce(c, `email-change-account:${userId}`, PER_ACCOUNT_LIMIT, LIMIT_WINDOW_SEC)) ??
    (await enforce(c, `email-change-account-day:${userId}`, PER_ACCOUNT_DAILY_LIMIT, DAY_SEC)) ??
    (await enforce(c, `email-change:${email}`, PER_ADDRESS_LIMIT, LIMIT_WINDOW_SEC))
  );
}

/**
 * Mail `email` the link that moves `userId` to it, replacing any change still waiting. Asking for
 * a change and sending its link again both come here. Returns the 429 past the limits above, and
 * throws 409 when another account has the address, since that link could not work. The limits
 * come first, so they bound the 409 answer too.
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
  const token = await createEmailVerification(c.env.DB, userId, email, 'change');
  const mail = renderEmailChange({
    link: verifyLink(new URL(c.req.url).origin, token, base),
    ttlHours: VERIFY_TOKEN_TTL_HOURS,
    assetOrigin: base,
  });
  await sendMail(c.env, email, mail.subject, mail.html, { text: mail.text });
  return null;
}

/**
 * Tell the account's current address that a change to `email` was asked for: that is how the
 * owner hears of it. Best-effort, like the other notices; the change itself does not wait on it.
 */
async function mailEmailChangeNotice(
  c: Context<AppEnv>,
  current: string,
  email: string
): Promise<void> {
  const notice = renderEmailChangeNotice({ newEmail: email, appUrl: appBase(c) });
  await sendMail(c.env, current, notice.subject, notice.html, { text: notice.text }).catch(
    (e: unknown) => {
      console.error('Email change notice failed to send:', e);
    }
  );
}

/**
 * Ask to move `userId` from `current` to `email` (trimmed and lowercased by the caller, and
 * different from `current`). Throws 400 for something that is not an address and 409 for one
 * another account has; returns the 429 past the limits above, and null once the link has gone to
 * `email` and the notice to `current`.
 */
export async function requestEmailChange(
  c: Context<AppEnv>,
  userId: number,
  email: string,
  current: string | null
): Promise<Response | null> {
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    throw new HttpError(400, 'A valid email is required');
  }
  const limited = await sendEmailChangeLink(c, userId, email);
  if (limited) return limited;
  // An account with no address yet (a Google sign-up whose address Google had not confirmed) has
  // nobody to tell.
  if (current) await mailEmailChangeNotice(c, current, email);
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
         WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE email = ? AND id != ?)`
      )
      .bind(email, userId, email, userId),
    onceMoved('DELETE FROM email_verifications WHERE user_id = ? AND used_at IS NULL'),
    onceMoved('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL'),
    onceMoved('DELETE FROM login_codes WHERE user_id = ? AND used_at IS NULL'),
  ]);
  if ((moved.meta.changes ?? 0) > 0) return 'changed';
  return (await db.first(d1, 'SELECT id FROM users WHERE id = ?', userId)) ? 'taken' : 'gone';
}
