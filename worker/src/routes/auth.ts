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
import { enforce, clientIp } from '../ratelimit';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
function resetEmailHtml(link: string, ttlHours: number): string {
  const ttl = ttlHours === 1 ? '1 hour' : `${ttlHours} hours`;
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 12px">Reset your password</h2>
    <p>We received a request to reset the password for your Token Circles account. Click the button below to choose a new password.</p>
    <p style="margin:24px 0">
      <a href="${link}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Reset password</a>
    </p>
    <p style="color:#6b7280;font-size:13px">This link expires in ${ttl}. If you didn't request a reset, you can safely ignore this email — your password won't change.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px">If the button doesn't work, copy and paste this link:<br><span style="word-break:break-all">${link}</span></p>
  </body></html>`;
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

  const userId = await resolveGoogleUser(c.env.DB, claims);
  const sessionCookie = await issueSessionCookie(userId, 'google', c.env);
  // Build the redirect explicitly so the Set-Cookie is guaranteed to ride along.
  return new Response(null, {
    status: 302,
    headers: { Location: state.returnTo, 'Set-Cookie': sessionCookie },
  });
});

// Email + password registration. Creates a 'password' user + default profile, then signs in.
authRoutes.post('/api/auth/register', async (c) => {
  const rl = await enforce(c, `register:${clientIp(c)}`, 5, 3600);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400);
  if (password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) return c.json({ error: 'An account with that email already exists' }, 409);
  const passwordHash = await hashPassword(password);
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
  )
    .bind(email, passwordHash)
    .run();
  const userId = res.meta.last_row_id as number;
  await c.env.DB.prepare('INSERT INTO profiles (name, user_id) VALUES (?, ?)')
    .bind('Personal Profile', userId)
    .run();
  c.header('Set-Cookie', await issueSessionCookie(userId, 'password', c.env));
  return c.json({ id: userId, email });
});

// Email + password login.
authRoutes.post('/api/auth/login', async (c) => {
  const rl = await enforce(c, `login:${clientIp(c)}`, 10, 900);
  if (rl) return rl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400);
  const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; password_hash: string | null }>();
  if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
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
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
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
    await sendMail(
      c.env,
      email,
      'Reset your Token Circles password',
      resetEmailHtml(link, RESET_TOKEN_TTL_HOURS)
    );
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
