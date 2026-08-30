/**
 * TOTP two-factor auth: enrollment (Settings) and the login-time challenge.
 *
 * Flow: /api/auth/login (or the Google callback) proves the first factor, then — for accounts
 * with a confirmed TOTP credential — sets the short-lived fm_2fa challenge cookie INSTEAD of a
 * session. /api/auth/2fa/verify swaps a valid code (TOTP or recovery) for the real session.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../index';
import { issueSessionCookie, readCookies, requireAuth } from '../auth';
import { logAuthEvent } from '../authlog';
import { clearRateLimit, clientIp, enforce } from '../ratelimit';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../totp';
import {
  TWOFA_COOKIE,
  clearedTwofaCookie,
  confirmTotp,
  consumeRecoveryCode,
  disableTotp,
  enrollTotp,
  generateRecoveryCodes,
  getPendingTotpSecret,
  getTotpForLogin,
  markTotpStepUsed,
  storeRecoveryCodes,
  totpStatus,
  verifyTwofaChallenge,
} from '../twofa';

const TOTP_ISSUER = 'Token Circles';

/** Attempt budget per user: enough for fat fingers, useless for guessing 1e6 codes. */
const VERIFY_LIMIT = 10;
const VERIFY_WINDOW_SEC = 900;

export const twofaRoutes = new Hono<AppEnv>();

twofaRoutes.get('/api/auth/2fa/status', requireAuth, async (c) => {
  return c.json(await totpStatus(c.env, c.get('userId')));
});

twofaRoutes.post('/api/auth/2fa/setup', requireAuth, async (c) => {
  const userId = c.get('userId');
  if ((await totpStatus(c.env, userId)).enabled) {
    return c.json({ error: 'Two-factor authentication is already enabled' }, 409);
  }
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  const secret = generateTotpSecret();
  await enrollTotp(c.env, userId, secret);
  return c.json({
    secret,
    otpauthUri: otpauthUri(secret, user?.email ?? `user-${userId}`, TOTP_ISSUER),
  });
});

twofaRoutes.post('/api/auth/2fa/enable', requireAuth, async (c) => {
  const userId = c.get('userId');
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  const secret = await getPendingTotpSecret(c.env, userId);
  if (!secret) return c.json({ error: 'No 2FA setup in progress' }, 400);
  const matched = await verifyTotp(secret, code ?? '');
  if (matched === null) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'enable_bad_code', userId });
    return c.json({ error: 'That code did not match — check the app and try again' }, 401);
  }
  await confirmTotp(c.env, userId);
  await markTotpStepUsed(c.env, userId, matched);
  const recoveryCodes = generateRecoveryCodes();
  await storeRecoveryCodes(c.env, userId, recoveryCodes);
  logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'enabled', userId });
  // The only time the raw codes ever exist outside the user's copy — they are stored hashed.
  return c.json({ recoveryCodes });
});

/**
 * Accepts either factor-proof a signed-in user can present: the current TOTP code, or one
 * recovery code (spent by the check even when used here — a code shown to a shoulder-surfer
 * during a disable attempt must not remain valid for a login).
 */
async function verifySecondFactor(
  c: Context<AppEnv>,
  userId: number,
  code: string
): Promise<boolean> {
  const cred = await getTotpForLogin(c.env, userId);
  if (!cred) return false;
  if (/^\d{6}$/.test(code)) {
    if (!cred.secret) return false; // undecryptable secret: only recovery codes work
    const minStep = cred.lastUsedStep === null ? undefined : cred.lastUsedStep + 1;
    const matched = await verifyTotp(cred.secret, code, { minStep });
    if (matched === null) return false;
    await markTotpStepUsed(c.env, userId, matched);
    return true;
  }
  return consumeRecoveryCode(c.env, userId, code);
}

twofaRoutes.post('/api/auth/2fa/disable', requireAuth, async (c) => {
  const userId = c.get('userId');
  if (!(await totpStatus(c.env, userId)).enabled) {
    return c.json({ error: 'Two-factor authentication is not enabled' }, 400);
  }
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!(await verifySecondFactor(c, userId, code ?? ''))) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'disable_bad_code', userId });
    return c.json({ error: 'That code did not match' }, 401);
  }
  await disableTotp(c.env, userId);
  logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'disabled', userId });
  return c.json({ ok: true });
});

// Pre-session on purpose: the caller holds the fm_2fa challenge cookie, not a session.
twofaRoutes.post('/api/auth/2fa/verify', async (c) => {
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  // Try every value the browser sent (cookie identity is name+Domain+Path — see readCookies).
  let challenge: { userId: number; provider: string } | null = null;
  for (const raw of readCookies(c.req.raw, TWOFA_COOKIE)) {
    challenge = await verifyTwofaChallenge(raw, c.env);
    if (challenge) break;
  }
  if (!challenge) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'challenge_missing' });
    return c.json({ error: 'Sign-in expired — enter your password again' }, 401);
  }
  const { userId, provider } = challenge;
  const bucket = `2fa:${userId}`;
  const rl = await enforce(c, bucket, VERIFY_LIMIT, VERIFY_WINDOW_SEC);
  if (rl) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'rate_limited', userId });
    return rl;
  }
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: string };
  if (!(await verifySecondFactor(c, userId, code ?? ''))) {
    logAuthEvent(c, { event: 'twofa', outcome: 'denied', reason: 'bad_code', userId });
    return c.json({ error: 'That code did not match — check the app and try again' }, 401);
  }
  await clearRateLimit(c.env, bucket);
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'verified', userId });
  c.header('Set-Cookie', clearedTwofaCookie(c.env), { append: true });
  c.header(
    'Set-Cookie',
    await issueSessionCookie(userId, provider, c.env, {
      userAgent: c.req.header('user-agent') ?? null,
      ip: clientIp(c),
    }),
    { append: true }
  );
  return c.json({ id: userId, email: user?.email ?? null });
});
