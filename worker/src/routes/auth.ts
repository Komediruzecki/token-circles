import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import * as db from '../db';
import { deviceLabel } from '../deviceLabel';
import {
  authenticateRequest,
  clearedAccess,
  clearedWorthSaying,
  clearUnconfirmedAccess,
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
  boundTo,
  TOKEN_TTL_SECONDS,
  TRY_AGAIN,
} from '../auth';
import { sendMail } from '../email';
import { cancelEmailChange, pendingEmailChange, sendEmailChangeLink } from '../email-change';
import {
  clearedMarker,
  EMAIL_LINK_COLUMNS,
  EMAIL_LINK_FINISH_PATH,
  linkExpired,
  markedLink,
  markerFor,
  spendLink,
  type EmailLink,
} from '../email-link';
import {
  createEmailVerification,
  randomToken,
  sha256Hex,
  verifyLink,
  VERIFY_TOKEN_TTL_HOURS,
} from '../email-verification';
import {
  renderAccountExists,
  renderEmailVerification,
  renderPasswordReset,
  renderWelcome,
} from '../emailTemplates';
import { clearRateLimit, enforce, clientIp } from '../ratelimit';
import { getTotpForLogin, issueTwofaChallengeCookie } from '../twofa';
import { logAuthEvent } from '../authlog';
import { captchaRejection, verifyTurnstileDetailed } from '../turnstile';
import { refusalOf } from '../../../shared/refusal';
import {
  addressProblems,
  noProblems,
  registrationProblems,
  resetPasswordProblems,
  signInProblems,
} from '../../../shared/signInSchema';

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

  const {
    userId,
    created,
    email: newEmail,
    cleared,
    tokenVersion,
  } = await resolveGoogleUser(c.env.DB, claims);
  const signIn = { userId, provider: 'google', tokenVersion };
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
  // Second factor: same rule as password login. The redirect carries ?twofa=1 so the SPA knows
  // to show the code screen instead of treating the return as signed-in.
  if (await getTotpForLogin(c.env, userId)) {
    logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'challenge_issued', userId });
    const dest = new URL(state.returnTo);
    dest.searchParams.set('twofa', '1');
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest.toString(),
        'Set-Cookie': await issueTwofaChallengeCookie(c.env, signIn),
      },
    });
  }
  const sessionCookie = await issueSessionCookie(c.env, signIn, sessionOrigin(c));
  if (!sessionCookie) return c.json({ error: TRY_AGAIN }, 409);
  // Joining cleared what the account had set up before its address was confirmed: ?cleared=1
  // lets the app say what. Joining clears the TOTP too, so this never meets ?twofa=1.
  let location = state.returnTo;
  if (cleared) {
    const dest = new URL(state.returnTo);
    dest.searchParams.set('cleared', '1');
    location = dest.toString();
  }
  // Build the redirect explicitly so the Set-Cookie is guaranteed to ride along.
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Set-Cookie': sessionCookie },
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
  // The field each problem is about, in the words the form uses (shared/signInSchema.ts).
  const refused = registrationProblems({ email, password });
  if (!noProblems(refused)) return c.json(refusalOf(refused), 400);
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
  // Only a field left empty is named. A wrong address or password names neither (below).
  const missing = signInProblems({ email, password });
  if (!noProblems(missing)) return c.json(refusalOf(missing), 400);
  // Per-account throttle (on top of per-IP) so a single account can't be brute-forced from rotating
  // IPs. Mirrors the layered approach used in forgot-password.
  const emailBucket = `login-email:${email}`;
  const emailRl = await enforce(c, emailBucket, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_SEC);
  if (emailRl) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'rate_limited_email', email });
    return emailRl;
  }
  // token_version is read with the password: the session below is bound to it.
  const user = await c.env.DB.prepare(
    'SELECT id, password_hash, token_version FROM users WHERE email = ?'
  )
    .bind(email)
    .first<{ id: number; password_hash: string | null; token_version: number }>();
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
  const signIn = { userId: user.id, provider: 'password', tokenVersion: user.token_version };
  // Second factor: the password alone must not buy a session for a 2FA account. The browser
  // gets a short-lived challenge cookie instead; /api/auth/2fa/verify trades it for the session.
  if (await getTotpForLogin(c.env, user.id)) {
    logAuthEvent(c, {
      event: 'twofa',
      outcome: 'ok',
      reason: 'challenge_issued',
      userId: user.id,
      email,
    });
    c.header('Set-Cookie', await issueTwofaChallengeCookie(c.env, signIn));
    return c.json({ twofaRequired: true });
  }
  const session = await issueSessionCookie(c.env, signIn, sessionOrigin(c));
  if (!session) return c.json({ error: TRY_AGAIN }, 409);
  logAuthEvent(c, { event: 'login', outcome: 'ok', userId: user.id, email });
  c.header('Set-Cookie', session);
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
  const refused = addressProblems({ email });
  if (!noProblems(refused)) return c.json(refusalOf(refused), 400);
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
  // expires_at is written as ISO 8601. datetime(expires_at) and datetime('now') compare the two in
  // one format, and the POST below compares the same way.
  const row = await c.env.DB.prepare(
    "SELECT id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')"
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
  const refused = resetPasswordProblems({ password });
  if (!noProblems(refused)) return c.json(refusalOf(refused), 400);

  // Deliberately does NOT filter on `used_at IS NULL`. Whether the link is still unspent is
  // decided by the conditional UPDATE below and nowhere else — two gates for one fact means the
  // read can say yes while the write says no, and the read is the one that is not a claim.
  const row = await c.env.DB.prepare(
    "SELECT id, user_id FROM password_resets WHERE token_hash = ? AND datetime(expires_at) > datetime('now')"
  )
    .bind(await sha256Hex(token))
    .first<{ id: number; user_id: number }>();
  if (!row) return c.json({ error: 'This reset link is invalid or has expired' }, 400);

  // Spend the token, and only if it is still unspent. This is the gate. It used to be a read
  // (`used_at IS NULL` in the SELECT) followed by an unconditional write, so two requests carrying
  // the same link — a mail client prefetching it while the person clicks, a forwarded message —
  // both passed the read and both set a password, with no way to say which one won.
  const claimed = await c.env.DB.prepare(
    "UPDATE password_resets SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL"
  )
    .bind(row.id)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) {
    return c.json({ error: 'This reset link is invalid or has expired' }, 400);
  }

  const passwordHash = await hashPassword(password);
  // One batch, so the password change and the retiring of the account's other pending links
  // either both happen or neither does. They used to be separate awaited writes: a failure
  // between them left live reset links pointing at an account whose password had just changed.
  const results = await c.env.DB.batch([
    // On an account whose address was not confirmed yet, every way in that was set up before goes
    // first (clearUnconfirmedAccess), the old password with it. It has to come before the write
    // below: that write confirms the address, after which these do nothing, and it sets the new
    // password, which has to be the one that stays. A confirmed account keeps everything it has.
    ...clearUnconfirmedAccess(c.env.DB, row.user_id),
    // Set the password, mark the email verified (they proved control), and bump token_version
    // to revoke every previously issued session.
    c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, email_verified = 1, token_version = token_version + 1 WHERE id = ?'
    ).bind(passwordHash, row.user_id),
    c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').bind(
      row.user_id
    ),
  ]);
  // Do NOT auto-login: send the user back to the sign-in screen to log in with the new
  // password (avoids a half-authenticated state). The token_version bump above already
  // revoked any existing sessions. `cleared` lets the app say what else went, if anything.
  return c.json(
    clearedWorthSaying(clearedAccess(results), 'reset') ? { ok: true, cleared: true } : { ok: true }
  );
});

// ── Email verification ─────────────────────────────────────────────────────────────────────────

// The emailed confirm link. A top-level navigation, so the outcome comes back to the app as a
// fragment (#everified=1 / #everified_error=…) the way the Google callback does — there is no
// page to render here and nothing for the user to type.
//
// Two kinds of link land here (migration 0031): one confirms the address the account has, the
// other moves the account to the address it was mailed to. The second adds `change=1` to every
// answer that names its outcome, so the app can say which happened.
//
// Either kind is spent only with its own account's session. The session cookie is SameSite=Lax
// on the parent domain (COOKIE_DOMAIN), so it reaches this API origin on a top-level navigation
// from a mail client. Opened without that session, the link stays unspent, the answer is
// `signin_required`, and the browser keeps a marker that finishes the link once its account
// signs in there (email-link.ts, POST /api/auth/email-link/finish).
authRoutes.get('/api/auth/verify-email', async (c) => {
  const rl = await enforce(c, `verify-email:${clientIp(c)}`, 30, 60);
  if (rl) return rl;
  const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  const requested = c.req.query('returnTo') ?? '';
  const returnTo = isAllowedReturnTo(requested, c.env) ? requested : base;
  const back = (fragment: string) =>
    new Response(null, { status: 302, headers: { Location: `${returnTo}/#${fragment}` } });
  const fail = (reason: string, change = false) =>
    back(`everified_error=${encodeURIComponent(reason)}${change ? '&change=1' : ''}`);

  const token = c.req.query('token') ?? '';
  if (!token) return fail('missing_token');
  // The read finds the token; spendLink's conditional UPDATE decides whether it is still
  // spendable, so a read that says yes can never disagree with the write.
  const link = await c.env.DB.prepare(
    `SELECT ${EMAIL_LINK_COLUMNS} FROM email_verifications WHERE token_hash = ?`
  )
    .bind(await sha256Hex(token))
    .first<EmailLink>();
  // One message for an unknown token and one for an already-used one would let a caller probe
  // token state, so both land here.
  if (!link) return fail('invalid_or_used');
  const change = link.purpose === 'change';
  const auth = await authenticateRequest(c.req.raw, c.env);
  if (auth.user?.userId !== link.user_id) {
    // No session, or another account's: the link waits for its own account to sign in here.
    // Unless no sign-in can complete it: the account is gone, or the link is spent or expired.
    const owner = await c.env.DB.prepare('SELECT 1 AS found FROM users WHERE id = ?')
      .bind(link.user_id)
      .first();
    if (!owner || link.used_at !== null) return fail('invalid_or_used');
    if (linkExpired(link)) return fail('expired', change);
    const asked = fail('signin_required', change);
    asked.headers.append('Set-Cookie', await markerFor(c.env, link));
    return asked;
  }
  const spent = await spendLink(c.env.DB, link);
  if (spent === 'confirmed') return back('everified=1');
  if (spent === 'changed') return back('everified=1&change=1');
  if (spent === 'email_taken') return fail('email_taken', true);
  if (spent === 'invalid') return fail('invalid_or_used');
  return fail(spent, change);
});

/** What POST /api/auth/email-link/finish answers. */
type EmailLinkOutcome = 'confirmed' | 'changed' | 'email_taken' | 'server_error' | 'none';

// Finish the link this browser opened without its account's session (verify-email above). The
// app calls this once someone signs in. The link finishes only for its own account's session,
// and only while it is unspent and unexpired; the answer says what happened, for the app to show.
//
// The marker stays for another account's session, so signing out and in to the right account
// still finishes the link. Every other answer clears it: the link finished, or it never can.
authRoutes.post(EMAIL_LINK_FINISH_PATH, requireAuth, async (c) => {
  const rl = await enforce(c, `email-link-finish:${clientIp(c)}`, 30, 60);
  if (rl) return rl;
  const { link, carried } = await markedLink(c.req.raw, c.env, c.env.DB);
  const done = (outcome: EmailLinkOutcome, change = false) => {
    if (carried) c.header('Set-Cookie', clearedMarker(c.env));
    return c.json({ outcome, change });
  };
  if (!link) return done('none');
  const change = link.purpose === 'change';
  if (link.user_id !== c.get('userId')) return c.json({ outcome: 'other_account', change });
  // A spent or expired link is left exactly as it is.
  if (link.used_at !== null || linkExpired(link)) return done('none');
  const spent = await spendLink(c.env.DB, link);
  if (spent === 'expired' || spent === 'invalid') return done('none');
  return done(spent, change);
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
  const token = await createEmailVerification(c.env.DB, userId, user.email, 'confirm', boundTo(c));
  if (token === null) return c.json({ error: TRY_AGAIN }, 409);
  const link = verifyLink(new URL(c.req.url).origin, token, base);
  const mail = renderEmailVerification({
    link,
    ttlHours: VERIFY_TOKEN_TTL_HOURS,
    assetOrigin: base,
  });
  await sendMail(c.env, user.email, mail.subject, mail.html, { text: mail.text });
  return c.json({ ok: true });
});

// Send the link for the account's waiting email change again (email-change.ts). A fresh link,
// which retires the earlier one; it shares its limits with asking for the change, and sends
// nothing once another account has the address (409).
authRoutes.post('/api/auth/email-change/resend', requireAuth, async (c) => {
  const userId = c.get('userId');
  const pendingEmail = await pendingEmailChange(c.env.DB, userId);
  if (!pendingEmail) return c.json({ error: 'No email change is waiting to be confirmed' }, 404);
  const limited = await sendEmailChangeLink(c, userId, pendingEmail);
  if (limited) return limited;
  return c.json({ ok: true, pendingEmail });
});

// Cancel the account's waiting email change: its link stops working and the address stays.
// Nothing waiting is not an error; the outcome is the same.
authRoutes.delete('/api/auth/email-change', requireAuth, async (c) => {
  await cancelEmailChange(c.env.DB, c.get('userId'));
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
 *
 * Bounded by the token lifetime. A session row outlives the token that points at it — nothing
 * rewrites `exp`, and the sweep that removes the row runs on a cron — so listing the table
 * unfiltered showed devices that had been signed out by the clock weeks ago, mixed in with the
 * live ones and impossible to tell apart. `last_seen_at` cannot answer this: it says when the
 * session was last used, not when it expires, and a token issued seven days ago and used a minute
 * ago is dead either way.
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
     FROM auth_sessions
     WHERE user_id = ? AND created_at > datetime('now', ?)
     ORDER BY last_seen_at DESC`,
    c.get('userId'),
    `-${TOKEN_TTL_SECONDS} seconds`
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
