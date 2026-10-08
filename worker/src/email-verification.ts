// The confirm-your-address link: minting it, and the URL that goes in the mail. The route that
// spends it is GET /api/auth/verify-email (routes/auth.ts).

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
 * Mint a single-use confirm token for `userId`, superseding any link already outstanding, and
 * store only its hash. Returns the raw token for the email.
 */
export async function createEmailVerification(
  db: D1Database,
  userId: number,
  email: string
): Promise<string> {
  await db
    .prepare('DELETE FROM email_verifications WHERE user_id = ? AND used_at IS NULL')
    .bind(userId)
    .run();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 3_600_000).toISOString();
  await db
    .prepare(
      'INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    )
    .bind(userId, email, await sha256Hex(token), expiresAt)
    .run();
  return token;
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
