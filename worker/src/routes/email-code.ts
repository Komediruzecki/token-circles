/**
 * "Email me a code" sign-in: POST /request mints a 6-digit code and mails it (identical neutral
 * answer whether or not the address has an account — the forgot-password anti-enumeration rule),
 * POST /verify trades a live code for a session. The 2FA challenge still applies after: an email
 * code proves the inbox, which is one factor, not two.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { issueSessionCookie } from '../auth';
import { logAuthEvent } from '../authlog';
import { sendMail } from '../email';
import { renderLoginCode } from '../emailTemplates';
import { createLoginCode, LOGIN_CODE_TTL_MINUTES, verifyLoginCode } from '../login-codes';
import { clearRateLimit, clientIp, enforce } from '../ratelimit';
import { getTotpForLogin, issueTwofaChallengeCookie } from '../twofa';
import { captchaRejection, verifyTurnstileDetailed } from '../turnstile';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const emailCodeRoutes = new Hono<AppEnv>();

emailCodeRoutes.post('/api/auth/email-code/request', async (c) => {
  const ipRl = await enforce(c, `logincode-ip:${clientIp(c)}`, 10, 900);
  if (ipRl) return ipRl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    turnstileToken?: string;
  };
  const captcha = await verifyTurnstileDetailed(c, body.turnstileToken);
  if (!captcha.ok) return captchaRejection(c, captcha);
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email is required' }, 400);
  // Per-address cap on top of per-IP (the forgot-password layering): one inbox can't be bombed
  // from rotating IPs, and the neutral 429 stays neutral for existing and unknown alike.
  const emailRl = await enforce(c, `logincode-email:${email}`, 3, 3600);
  if (emailRl) return emailRl;

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (user) {
    const code = await createLoginCode(c.env, user.id, email);
    const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
    const mail = renderLoginCode({ code, ttlMinutes: LOGIN_CODE_TTL_MINUTES, assetOrigin: base });
    await sendMail(c.env, email, mail.subject, mail.html, { text: mail.text });
  }
  return c.json({ ok: true });
});

emailCodeRoutes.post('/api/auth/email-code/verify', async (c) => {
  const ipRl = await enforce(c, `logincode-verify-ip:${clientIp(c)}`, 30, 900);
  if (ipRl) return ipRl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').trim();
  if (!EMAIL_RE.test(email) || !code) {
    return c.json({ error: 'Email and code are required' }, 400);
  }
  // Per-address guess budget: 10 tries against a 10^6 space, then a 15-minute wall.
  const emailBucket = `logincode-verify:${email}`;
  const emailRl = await enforce(c, emailBucket, 10, 900);
  if (emailRl) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'code_rate_limited', email });
    return emailRl;
  }

  const userId = await verifyLoginCode(c.env, email, code);
  if (userId === null) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'bad_code', email });
    return c.json({ error: 'Invalid or expired code' }, 401);
  }
  await clearRateLimit(c.env, emailBucket);
  // Typing a mailed code IS proof of inbox control — the same proof the verification link asks
  // for, so the pending "confirm your address" state resolves here for free.
  await c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();

  // Second factor: identical rule to password login — the inbox is one factor, not two.
  if (await getTotpForLogin(c.env, userId)) {
    logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'challenge_issued', userId, email });
    c.header('Set-Cookie', await issueTwofaChallengeCookie(userId, 'email', c.env));
    return c.json({ twofaRequired: true });
  }
  logAuthEvent(c, { event: 'login', outcome: 'ok', userId, email });
  c.header(
    'Set-Cookie',
    await issueSessionCookie(userId, 'email', c.env, {
      userAgent: c.req.header('user-agent') ?? null,
      ip: clientIp(c),
    })
  );
  return c.json({ id: userId, email });
});
