// Links that prove someone reads an address: minting one, and the URL that goes in the mail. The
// route that spends them is GET /api/auth/verify-email (routes/auth.ts). One kind confirms the
// address an account already has; the other moves the account to a new one (email-change.ts).
import { SAME_TOKEN_VERSION, type Bound } from './auth';

// 256-bit URL-safe token (hex). The raw token goes in the email link; only its hash is stored.
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Email verification (password signups) ──────────────────────────────────────────────────────
//
// A password account starts unverified and works anyway: the confirm link is a soft gate, so
// nothing is blocked on it — the app shows a banner until it is clicked. Google accounts arrive
// with Google's own email_verified claim and never see any of this.
//
// The link stays valid long enough to survive a night in a spam folder. It is longer than the
// password-reset TTL on purpose: a reset link is a live credential, a confirm link is not.
export const VERIFY_TOKEN_TTL_HOURS = 24;

/**
 * Confirm links mailed to one address in an hour by the ways of sending one again: Send the link
 * again while signed out, signing up again with the address, and the Confirm your email screen.
 * Each way keeps its own limit on requests; this one budget is shared by the three, so taking
 * turns between them mails no more links than one of them allows alone. The welcome's link is not
 * counted: it goes once, with the account.
 */
export const CONFIRM_LINKS_PER_HOUR = 3;

/** The rate_limits bucket that counts the confirm links mailed to `email`. */
export const confirmLinksMailed = (email: string): string =>
  `confirm-links-mailed:${email.toLowerCase()}`;

/**
 * What opening the link does: 'confirm' marks the account's current address verified, 'change'
 * moves the account to the address the link was mailed to (migration 0031).
 */
export type VerificationPurpose = 'confirm' | 'change';

/**
 * Mint a single-use token for `userId`, superseding any link of the same purpose still
 * outstanding, and store only its hash. Returns the raw token for the email.
 *
 * Only the same purpose: sending the confirm link again must not cancel a change that is
 * waiting, and asking for a change must not kill the link that confirms the address the account
 * still has.
 *
 * With `bound`, only while the account's token_version is still the one the request checked
 * (SAME_TOKEN_VERSION); null when nothing was written.
 */
export async function createEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose?: VerificationPurpose
): Promise<string>;
export async function createEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose,
  bound: Bound
): Promise<string | null>;
export async function createEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose = 'confirm',
  bound?: Bound
): Promise<string | null> {
  const { guard, values } = guardFor(bound);
  const token = randomToken();
  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM email_verifications WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND ${guard}`
      )
      .bind(userId, purpose, ...values),
    await insertStatement(db, userId, email, purpose, token, guard, values),
  ]);
  return (results[1]?.meta.changes ?? 0) > 0 ? token : null;
}

/**
 * The statement that stores the first confirm link of the account at `email`, for the batch that
 * makes that account: it reads the account's id inside the batch, once the account is written.
 */
export async function firstConfirmLink(
  db: D1Database,
  email: string,
  token: string
): Promise<D1PreparedStatement> {
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 3_600_000).toISOString();
  return db
    .prepare(
      `INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose)
       SELECT id, ?, ?, ?, 'confirm' FROM users WHERE email = ?`
    )
    .bind(email, await sha256Hex(token), expiresAt, email);
}

/**
 * Store a new single-use link for `userId` without retiring any other, and return its raw token
 * and row id. For a caller that retires the others only once the new link has been sent. With
 * `bound`, only while the account's token_version is still the one the request checked; null
 * when nothing was written.
 */
export async function insertEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose
): Promise<{ token: string; id: number }>;
export async function insertEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose,
  bound: Bound
): Promise<{ token: string; id: number } | null>;
export async function insertEmailVerification(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose,
  bound?: Bound
): Promise<{ token: string; id: number } | null> {
  const { guard, values } = guardFor(bound);
  const token = randomToken();
  const res = await (await insertStatement(db, userId, email, purpose, token, guard, values)).run();
  if ((res.meta.changes ?? 0) === 0) return null;
  return { token, id: res.meta.last_row_id as number };
}

function guardFor(bound?: Bound): { guard: string; values: number[] } {
  return bound
    ? { guard: SAME_TOKEN_VERSION, values: [bound.userId, bound.tokenVersion] }
    : { guard: '1', values: [] };
}

async function insertStatement(
  db: D1Database,
  userId: number,
  email: string,
  purpose: VerificationPurpose,
  token: string,
  guard: string,
  values: number[]
): Promise<D1PreparedStatement> {
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 3_600_000).toISOString();
  return db
    .prepare(
      `INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose)
       SELECT ?, ?, ?, ?, ? WHERE ${guard}`
    )
    .bind(userId, email, await sha256Hex(token), expiresAt, purpose, ...values);
}

/**
 * The confirm link. It points at this worker rather than the app because there is nothing for
 * the user to fill in — one GET does the whole job and bounces them back to the app.
 */
export function verifyLink(apiOrigin: string, token: string, returnTo: string): string {
  return (
    `${apiOrigin}/api/auth/verify-email?token=${encodeURIComponent(token)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`
  );
}
