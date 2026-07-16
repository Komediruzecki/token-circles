import { Hono } from 'hono';
import type { AppEnv } from '../index';
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
import { renderAccountExists, renderPasswordReset, renderWelcome } from '../emailTemplates';
import { enforce, clientIp } from '../ratelimit';
import { verifyTurnstile } from '../turnstile';

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
  const sessionCookie = await issueSessionCookie(userId, 'google', c.env);
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
  if (!(await verifyTurnstile(c, body.turnstileToken)))
    return c.json({ error: 'Captcha verification failed. Please try again.' }, 403);
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
    const welcome = renderWelcome({ appUrl: base });
    await sendMail(c.env, email, welcome.subject, welcome.html, { text: welcome.text }).catch(
      (e) => {
        console.error('Welcome email failed:', e);
      }
    );
  }
  // Identical response regardless of existence; no session cookie is set (the user signs in next).
  return c.json({ ok: true });
});

// Email + password login.
authRoutes.post('/api/auth/login', async (c) => {
  const rl = await enforce(c, `login:${clientIp(c)}`, 10, 900);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    turnstileToken?: string;
  };
  if (!(await verifyTurnstile(c, body.turnstileToken)))
    return c.json({ error: 'Captcha verification failed. Please try again.' }, 403);
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400);
  // Per-account throttle (on top of per-IP) so a single account can't be brute-forced from rotating
  // IPs. Mirrors the layered approach used in forgot-password.
  const emailRl = await enforce(c, `login-email:${email}`, 10, 900);
  if (emailRl) return emailRl;
  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string | null }>();
  // Always run a verification — against a dummy hash when the account/hash is missing — so login
  // takes the same time regardless of whether the email exists (anti-enumeration). Then branch on
  // the real outcome.
  const passwordOk = await verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
  if (!user || !user.password_hash || !passwordOk) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  c.header('Set-Cookie', await issueSessionCookie(user.id, 'password', c.env));
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
  if (!(await verifyTurnstile(c, body.turnstileToken)))
    return c.json({ error: 'Captcha verification failed. Please try again.' }, 403);
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

// Current user.
authRoutes.get('/api/auth/me', requireAuth, async (c) => {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare(
    'SELECT id, username, email, auth_provider FROM users WHERE id = ?'
  )
    .bind(userId)
    .first();
  return c.json(user);
});

// Logout everywhere: bump token_version (revokes all issued JWTs) and clear the cookie.
authRoutes.post('/api/auth/logout', requireAuth, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
    .bind(userId)
    .run();
  c.header('Set-Cookie', clearedSessionCookie(c.env));
  return c.json({ ok: true });
});
