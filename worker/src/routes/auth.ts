import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import * as db from '../db';
import { deviceLabel } from '../deviceLabel';
import {
  requireAuth,
  verifyGoogleIdToken,
  signState,
  verifyState,
  isAllowedReturnTo,
  resolveGoogleUser,
  issueSessionCookie,
  clearedSessionCookie,
  hashPassword,
  verifyPassword,
} from '../auth';
import { sendMail } from '../email';
import {
  renderAccountExists,
  renderEmailVerification,
  renderPasswordReset,
  renderWelcome,
} from '../emailTemplates';
import { clearRateLimit, enforce, clientIp } from '../ratelimit';
import { logAuthEvent } from '../authlog';
import { captchaRejection, verifyTurnstileDetailed } from '../turnstile';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A fixed, valid-format PBKDF2 hash (same 600k cost as a freshly minted real one) that no password
// matches. Login verifies against this when the account or its hash is absent, so the response time
// is the same whether or not the email is registered — closing the user-enumeration timing oracle.
// Kept in lock-step with PBKDF2_ITERATIONS in auth.ts so the dummy verify costs the same as a real
// one — and, critically, stays within the Workers PBKDF2 100k cap (a 600k dummy made login throw
// for non-existent accounts instead of returning 401).
const DUMMY_PASSWORD_HASH = `pbkdf2$100000$${'A'.repeat(22)}$${'A'.repeat(43)}`;

// How long a password-reset magic link stays valid. Tune freely (a few hours is the
// safe default; raise toward 24–72h if you want links to survive longer email delays).
const RESET_TOKEN_TTL_HOURS = 2;

// 256-bit URL-safe token (hex). The raw token goes in the email link; only its hash is stored.
function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
async function sha256Hex(input: string): Promise<string> {
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
const VERIFY_TOKEN_TTL_HOURS = 24;

/**
 * Mint a single-use confirm token for `userId`, superseding any link already outstanding, and
 * store only its hash. Returns the raw token for the email.
 */
async function createEmailVerification(
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
function verifyLink(apiOrigin: string, token: string, returnTo: string): string {
  return (
    `${apiOrigin}/api/auth/verify-email?token=${encodeURIComponent(token)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`
  );
}

// Google Sign-In (server-side code flow) + session endpoints. The token is set as
// an httpOnly cookie, so the browser never handles it directly.
export const authRoutes = new Hono<AppEnv>();

// 1) Kick off login: redirect to Google with a signed state carrying returnTo.
authRoutes.get('/api/auth/google/start', async (c) => {
  const { GOOGLE_CLIENT_ID, JWT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !JWT_SECRET)
    return c.json({ error: 'Google login not configured' }, 500);

  const url = new URL(c.req.url);
  const returnTo = url.searchParams.get('returnTo') || c.env.CORS_ORIGIN || url.origin;
  if (!isAllowedReturnTo(returnTo, c.env)) return c.json({ error: 'Invalid returnTo' }, 400);

  const state = await signState({ returnTo, ts: Date.now() }, JWT_SECRET);
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('state', state);
  auth.searchParams.set('prompt', 'select_account');
  return c.redirect(auth.toString(), 302);
});

// 2) Google redirect target: exchange code, verify, set session cookie, go home.
authRoutes.get('/api/auth/google/callback', async (c) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !JWT_SECRET) {
    return c.json({ error: 'Google login not configured' }, 500);
  }
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  if (!code || !rawState) return c.json({ error: 'Missing code or state' }, 400);

  const state = await verifyState(rawState, JWT_SECRET);
  if (!state || !isAllowedReturnTo(state.returnTo, c.env))
    return c.json({ error: 'Invalid state' }, 400);

  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 401);
  const tok = (await tokenRes.json()) as { id_token?: string };
  if (!tok.id_token) return c.json({ error: 'No id_token returned' }, 401);

  const claims = await verifyGoogleIdToken(tok.id_token, GOOGLE_CLIENT_ID);
  if (!claims) return c.json({ error: 'Invalid id_token' }, 401);

  const { userId, created, email: newEmail } = await resolveGoogleUser(c.env.DB, claims);
  // Brand-new Google signups get the same welcome as email/password registrations
  // (best-effort — a mail failure must never break the OAuth redirect).
  if (created && newEmail) {
    const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
    const welcome = renderWelcome({ appUrl: base });
    await sendMail(c.env, newEmail, welcome.subject, welcome.html, { text: welcome.text }).catch(
      (e: unknown) => {
        console.error('Google welcome email failed:', e);
      }
    );
  }
  const sessionCookie = await issueSessionCookie(userId, 'google', c.env, sessionOrigin(c));
  // Build the redirect explicitly so the Set-Cookie is guaranteed to ride along.
  return new Response(null, {
    status: 302,
    headers: { Location: state.returnTo, 'Set-Cookie': sessionCookie },
  });
});

// Email + password registration. Anti-enumeration (CR-9): identical neutral response whether or not
// the email already exists, and no session is set — the user signs in afterward.
authRoutes.post('/api/auth/register', async (c) => {
  const rl = await enforce(c, `register:${clientIp(c)}`, 5, 3600);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    turnstileToken?: string;
  };
  const captcha = await verifyTurnstileDetailed(c, body.turnstileToken);
  if (!captcha.ok) return captchaRejection(c, captcha);
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  // Per-email cap (on top of the per-IP cap) so one address can't be email-bombed / junk-registered
  // from rotating IPs. Mirrors forgot-password; the response stays neutral (429 for existing + new).
  const emailRl = await enforce(c, `register-email:${email}`, 3, 3600);
  if (emailRl) return emailRl;
  // Anti-enumeration (CR-9): never reveal whether the email already exists. Always run the password
  // hash (so timing doesn't betray the branch), then EITHER create a new account OR notify the
  // existing owner by email — returning the SAME neutral response with NO session either way. The
  // user signs in afterward, so a new vs existing email is indistinguishable to the caller.
  const passwordHash = await hashPassword(password);
  const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (existing) {
    const notice = renderAccountExists({ appUrl: base });
    await sendMail(c.env, email, notice.subject, notice.html, { text: notice.text }).catch(
      (e: unknown) => {
        console.error('account-exists notice email failed to send:', e);
      }
    );
  } else {
    const res = await c.env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
    )
      .bind(email, passwordHash)
      .run();
    const userId = res.meta.last_row_id as number;
    await c.env.DB.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)')
      .bind('Personal Profile', userId)
      .run();
    // Best-effort, exactly like the mail it replaces: a signup is never held up, or failed, by
    // the mail server. An account with no confirm link can always ask for one from the app.
    let verifyUrl: string | undefined;
    try {
      const token = await createEmailVerification(c.env.DB, userId, email);
      verifyUrl = verifyLink(new URL(c.req.url).origin, token, base);
    } catch (e) {
      console.error('Verification token could not be minted:', e);
    }
    const welcome = renderWelcome({ appUrl: base, verifyUrl });
    await sendMail(c.env, email, welcome.subject, welcome.html, { text: welcome.text }).catch(
      (e) => {
        console.error('Welcome email failed:', e);
      }
    );
  }
  // Identical response regardless of existence; no session cookie is set (the user signs in next).
  return c.json({ ok: true });
});

/** What to remember about the device signing in, so it can be shown back to the user later. */
const sessionOrigin = (c: Context<AppEnv>) => ({
  userAgent: c.req.header('user-agent') ?? null,
  ip: clientIp(c),
});

/**
 * Login throttles. The window is shared; the two limits are not.
 *
 * The IP ceiling is a flood guard on a key that is not a person — CGNAT puts a whole carrier
 * behind one address. The per-account limit is the one that stops guessing at a specific account,
 * and both are cleared on a successful sign-in.
 */
const LOGIN_WINDOW_SEC = 900;
const LOGIN_IP_LIMIT = 30;
const LOGIN_EMAIL_LIMIT = 10;

// Email + password login.
authRoutes.post('/api/auth/login', async (c) => {
  // Per-IP, and generous: an IP is not a person. A household, an office and an entire mobile
  // carrier behind CGNAT all share one, so this ceiling only exists to stop a flood — the
  // per-account limit below is the one that actually protects an account.
  const ipBucket = `login:${clientIp(c)}`;
  const rl = await enforce(c, ipBucket, LOGIN_IP_LIMIT, LOGIN_WINDOW_SEC);
  if (rl) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'rate_limited_ip' });
    return rl;
  }
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    turnstileToken?: string;
  };
  const captcha = await verifyTurnstileDetailed(c, body.turnstileToken);
  if (!captcha.ok) {
    // The widget goes green and the request is still refused, which reads as the app being broken.
    // Recording the reason is what turns that into a five-second diagnosis.
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: `captcha:${captcha.reason}` });
    return captchaRejection(c, captcha);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400);
  // Per-account throttle (on top of per-IP) so a single account can't be brute-forced from rotating
  // IPs. Mirrors the layered approach used in forgot-password.
  const emailBucket = `login-email:${email}`;
  const emailRl = await enforce(c, emailBucket, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SEC);
  if (emailRl) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'rate_limited_email', email });
    return emailRl;
  }
  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string | null }>();
  // Always run a verification — against a dummy hash when the account/hash is missing — so login
  // takes the same time regardless of whether the email exists (anti-enumeration). Then branch on
  // the real outcome.
  const passwordOk = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !user.password_hash || !passwordOk) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'bad_credentials', email });
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  // Signing in correctly proves the credentials are right, so it must not spend the budget that
  // exists to stop people guessing them. Without this, ten successful logins in a quarter of an
  // hour — one person with a phone, a tablet and a laptop — locked the account out of its own
  // password. Failures still accumulate exactly as before.
  await Promise.all([clearRateLimit(c.env, ipBucket), clearRateLimit(c.env, emailBucket)]);
  logAuthEvent(c, { event: 'login', outcome: 'ok', userId: user.id, email });
  c.header('Set-Cookie', await issueSessionCookie(user.id, 'password', c.env, sessionOrigin(c)));
  return c.json({ id: user.id, email });
});

// Forgot password: email a magic reset link. Always returns 200 with no hint about whether
// the account exists (anti-enumeration). Only one active token per user at a time.
authRoutes.post('/api/auth/forgot-password', async (c) => {
  const ipRl = await enforce(c, `forgot-ip:${clientIp(c)}`, 5, 900);
  if (ipRl) return ipRl;
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    turnstileToken?: string;
  };
  const captcha = await verifyTurnstileDetailed(c, body.turnstileToken);
  if (!captcha.ok) return captchaRejection(c, captcha);
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400);
  // Per-email cap (on top of per-IP) so one address can't be bombed from rotating IPs.
  const emailRl = await enforce(c, `forgot-email:${email}`, 3, 3600);
  if (emailRl) return emailRl;

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (user) {
    // Invalidate any previous unused links for this user, then mint a fresh one.
    await c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL')
      .bind(user.id)
      .run();
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 3_600_000).toISOString();
    await c.env.DB.prepare(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    )
      .bind(user.id, tokenHash, expiresAt)
      .run();
    const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
    const link = `${base}/#reset-password?token=${token}`;
    const reset = renderPasswordReset({ link, ttlHours: RESET_TOKEN_TTL_HOURS, assetOrigin: base });
    await sendMail(c.env, email, reset.subject, reset.html, { text: reset.text });
  }
  return c.json({ ok: true });
});

// Check a reset link without consuming it (lets the reset page show "expired" up front).
authRoutes.get('/api/auth/reset-password', async (c) => {
  const token = c.req.query('token') ?? '';
  if (!token) return c.json({ valid: false });
  const row = await c.env.DB.prepare(
    "SELECT id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  )
    .bind(await sha256Hex(token))
    .first();
  return c.json({ valid: !!row });
});

// Consume the token, set the new password, revoke other sessions, and sign the user in.
authRoutes.post('/api/auth/reset-password', async (c) => {
  const rl = await enforce(c, `reset:${clientIp(c)}`, 10, 900);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = (body.token ?? '').trim();
  const password = body.password ?? '';
  if (!token) return c.json({ error: 'Missing reset token' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

  const row = await c.env.DB.prepare(
    "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
  )
    .bind(await sha256Hex(token))
    .first<{ id: number; user_id: number }>();
  if (!row) return c.json({ error: 'This reset link is invalid or has expired' }, 400);

  const passwordHash = await hashPassword(password);
  // Set the password, mark the email verified (they proved control), and bump token_version
  // to revoke every previously issued session.
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, email_verified = 1, token_version = token_version + 1 WHERE id = ?'
  )
    .bind(passwordHash, row.user_id)
    .run();
  await c.env.DB.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?")
    .bind(row.id)
    .run();
  await c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL')
    .bind(row.user_id)
    .run();
  // Do NOT auto-login: send the user back to the sign-in screen to log in with the new
  // password (avoids a half-authenticated state). The token_version bump above already
  // revoked any existing sessions.
  return c.json({ ok: true });
});

// ── Email verification ─────────────────────────────────────────────────────────────────────────

// The emailed confirm link. A top-level navigation, so the outcome comes back to the app as a
// fragment (#everified=1 / #everified_error=…) the way the Google callback does — there is no
// page to render here and nothing for the user to type.
authRoutes.get('/api/auth/verify-email', async (c) => {
  const rl = await enforce(c, `verify-email:${clientIp(c)}`, 30, 60);
  if (rl) return rl;
  const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  const requested = c.req.query('returnTo') ?? '';
  const returnTo = isAllowedReturnTo(requested, c.env) ? requested : base;
  const back = (fragment: string) =>
    new Response(null, { status: 302, headers: { Location: `${returnTo}/#${fragment}` } });
  const fail = (reason: string) => back(`everified_error=${encodeURIComponent(reason)}`);

  const token = c.req.query('token') ?? '';
  if (!token) return fail('missing_token');
  const row = await c.env.DB.prepare(
    'SELECT id, user_id, email, expires_at FROM email_verifications WHERE token_hash = ? AND used_at IS NULL'
  )
    .bind(await sha256Hex(token))
    .first<{ id: number; user_id: number; email: string; expires_at: string }>();
  // One message for an unknown token and one for an already-used one would let a caller probe
  // token state, so both land here.
  if (!row) return fail('invalid_or_used');
  // Single-use: spend the token whatever the outcome below, so a link that failed for any reason
  // cannot be retried until it happens to succeed.
  await c.env.DB.prepare("UPDATE email_verifications SET used_at = datetime('now') WHERE id = ?")
    .bind(row.id)
    .run();
  if (Date.parse(row.expires_at) < Date.now()) return fail('expired');
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ email: string | null }>();
  // The address has to still be the one this link was sent to. Otherwise changing the address
  // after asking for a link would confirm the NEW one on the strength of mail sent to the old.
  if (!user || (user.email ?? '').toLowerCase() !== row.email.toLowerCase()) {
    return fail('invalid_or_used');
  }
  await c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?')
    .bind(row.user_id)
    .run();
  return back('everified=1');
});

// Send the confirm link again. Authenticated, so unlike forgot-password there is no address to
// keep secret — the caller has already proved the account is theirs, and a 429 can be shown.
authRoutes.post('/api/auth/resend-verification', requireAuth, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT email, email_verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null; email_verified: number }>();
  if (!user) return c.json({ error: 'User not found' }, 404);
  if (!user.email) return c.json({ error: 'This account has no email address' }, 400);
  // Not an error: the address is confirmed, which is what the caller wanted.
  if (user.email_verified) return c.json({ ok: true, alreadyVerified: true });
  // Per-address cap on top of the per-IP one — the IP bucket does nothing against a caller who
  // rotates addresses, and this route sends real mail to a real inbox.
  const emailRl = await enforce(c, `resend-verification:${user.email}`, 3, 3600);
  if (emailRl) return emailRl;

  const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  const token = await createEmailVerification(c.env.DB, userId, user.email);
  const link = verifyLink(new URL(c.req.url).origin, token, base);
  const mail = renderEmailVerification({
    link,
    ttlHours: VERIFY_TOKEN_TTL_HOURS,
    assetOrigin: base,
  });
  await sendMail(c.env, user.email, mail.subject, mail.html, { text: mail.text });
  return c.json({ ok: true });
});

// Current user. email_verified rides along because the app's confirm-your-email banner is the
// only thing that reads it, and this is the call it already makes.
authRoutes.get('/api/auth/me', requireAuth, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(
    'SELECT id, username, email, auth_provider, email_verified FROM users WHERE id = ?'
  )
    .bind(userId)
    .first();
  return c.json(user);
});

/**
 * Sign out THIS device: clear the cookie, leave every other session alone.
 *
 * It used to bump `token_version`, which revokes every JWT the account has ever been issued — so
 * signing out on a laptop silently signed the same person out on their phone and tablet too. The
 * button that calls this is labelled "Logout", next to nothing that suggests it reaches other
 * devices, and being ejected from a session you are actively using reads as the app breaking.
 *
 * The cookie is httpOnly, so clearing it ends the session for this browser. The JWT stays
 * technically valid until it expires, which is the standing trade-off for a stateless token —
 * and the case that trade-off is wrong for (a session you believe is stolen) is exactly what
 * /api/auth/logout-all is for.
 */
authRoutes.post('/api/auth/logout', requireAuth, async (c) => {
  const sessionId = c.get('sessionId');
  // Deleting the row is what actually ends it — clearing the cookie only ends it for a browser
  // that cooperates. A token issued before the sessions table existed has no row to delete and
  // simply ages out; "sign out everywhere" is what revokes those.
  if (sessionId !== undefined) {
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, c.get('userId'))
      .run();
  }
  logAuthEvent(c, { event: 'logout', outcome: 'ok', userId: c.get('userId') });
  c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});

/**
 * Where this account is signed in. The current device is flagged rather than hidden — seeing
 * yourself in the list is how you know the list is the whole truth.
 */
authRoutes.get('/api/auth/sessions', requireAuth, async (c) => {
  const rows = await db.all<{
    id: string;
    provider: string | null;
    user_agent: string | null;
    ip: string | null;
    created_at: string;
    last_seen_at: string;
  }>(
    c.env.DB,
    `SELECT id, provider, user_agent, ip, created_at, last_seen_at
     FROM auth_sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
    c.get('userId')
  );
  const current = c.get('sessionId');
  return c.json({
    sessions: rows.map((row) => ({
      id: row.id,
      device: deviceLabel(row.user_agent),
      provider: row.provider,
      ip: row.ip,
      created_at: row.created_at,
      last_seen_at: row.last_seen_at,
      current: row.id === current,
    })),
  });
});

/** End one device. Scoped to the caller's own sessions — an id alone is not authority. */
authRoutes.delete('/api/auth/sessions/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id = ? AND user_id = ?')
    .bind(id, c.get('userId'))
    .run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Session not found' }, 404);
  logAuthEvent(c, {
    event: 'logout',
    outcome: 'ok',
    reason: id === c.get('sessionId') ? 'this_device' : 'other_device',
    userId: c.get('userId'),
  });
  // Ending the session you are asking from should also clear your own cookie.
  if (id === c.get('sessionId')) c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});

/** Sign out everywhere: bump token_version, which revokes every JWT issued for this account. */
authRoutes.post('/api/auth/logout-all', requireAuth, async (c) => {
  const userId = c.get('userId');
  // Both: the rows end every device that has one, and the token_version bump is the only thing
  // that can reach a token issued before the sessions table existed.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId),
    c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(
      userId
    ),
  ]);
  logAuthEvent(c, { event: 'logout', outcome: 'ok', reason: 'all_devices', userId });
  c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});
