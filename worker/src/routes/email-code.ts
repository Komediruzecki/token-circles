/**
 * "Email me a code" sign-in: POST /request mints a 6-digit code and mails it (identical neutral
 * answer whether or not the address has an account — the forgot-password anti-enumeration rule),
 * POST /verify trades a live code for a session. The 2FA challenge still applies after: an email
 * code proves the inbox, which is one factor, not two.
 *
 * The verify step is bound to the browser that requested the code by a signed ceremony cookie
 * (fm_logincode, same construction as fm_2fa). That binding is what keeps a 10^6 code space
 * defensible: a third party who fires /request for someone else's address gets a cookie for a
 * code they cannot read, and has NO surface to guess at the victim's own code — nor any way to
 * exhaust a victim's verify budget, which is why there is no per-address verify bucket here.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../index';
import {
  b64urlDecode,
  b64urlEncode,
  cookie,
  hmacKey,
  issueSessionCookie,
  readCookies,
} from '../auth';
import { logAuthEvent } from '../authlog';
import { sendMail } from '../email';
import { renderLoginCode } from '../emailTemplates';
import {
  createLoginCode,
  generateLoginCode,
  hashLoginCode,
  LOGIN_CODE_TTL_MINUTES,
  verifyLoginCode,
} from '../login-codes';
import { clearRateLimit, clientIp, enforce } from '../ratelimit';
import { getTotpForLogin, issueTwofaChallengeCookie } from '../twofa';
import { captchaRejection, verifyTurnstileDetailed } from '../turnstile';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ── The ceremony cookie: which code row this browser may attempt ─────────────
export const LOGINCODE_COOKIE = 'fm_logincode';
const CEREMONY_TTL_SECONDS = LOGIN_CODE_TTL_MINUTES * 60;

interface CodeCeremony {
  codeId: number;
  email: string;
  exp: number;
}

async function hmacB64url(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64urlEncode(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

export async function issueLoginCodeCookie(
  env: Env,
  codeId: number,
  email: string
): Promise<string> {
  if (!env.JWT_SECRET) throw new Error('Auth not configured');
  const ceremony: CodeCeremony = {
    codeId,
    email,
    exp: Math.floor(Date.now() / 1000) + CEREMONY_TTL_SECONDS,
  };
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(ceremony)));
  const token = `${payload}.${await hmacB64url(payload, env.JWT_SECRET)}`;
  return cookie(LOGINCODE_COOKIE, token, CEREMONY_TTL_SECONDS, env);
}

async function readCodeCeremony(
  request: Request,
  env: Env
): Promise<{ codeId: number; email: string } | null> {
  if (!env.JWT_SECRET) return null;
  for (const raw of readCookies(request, LOGINCODE_COOKIE)) {
    const [payload, mac] = raw.split('.');
    if (!payload || !mac) continue;
    const expected = await hmacB64url(payload, env.JWT_SECRET);
    if (mac.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) continue;
    try {
      const ceremony = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as CodeCeremony;
      if (!ceremony.exp || ceremony.exp < Math.floor(Date.now() / 1000)) continue;
      if (typeof ceremony.codeId !== 'number' || typeof ceremony.email !== 'string') continue;
      return { codeId: ceremony.codeId, email: ceremony.email };
    } catch {
      continue;
    }
  }
  return null;
}

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
    const { code, id } = await createLoginCode(c.env, user.id, email);
    c.header('Set-Cookie', await issueLoginCodeCookie(c.env, id, email));
    const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
    const mail = renderLoginCode({ code, ttlMinutes: LOGIN_CODE_TTL_MINUTES, assetOrigin: base });
    // Off the response path: the awaited Resend round-trip (~100-400ms) was a timing oracle
    // separating known from unknown addresses, and its failures leaked the same way as 500s.
    c.executionCtx.waitUntil(
      sendMail(c.env, email, mail.subject, mail.html, { text: mail.text }).catch(() => {})
    );
  } else {
    // Unknown address: do the same visible work — mint a code nobody will read, sign a cookie
    // addressed to a row that does not exist (id 0 never matches) — so the response differs
    // from the known-address branch by one INSERT, not by crypto or mail latency.
    const decoy = generateLoginCode();
    await hashLoginCode(decoy);
    c.header('Set-Cookie', await issueLoginCodeCookie(c.env, 0, email));
  }
  return c.json({ ok: true });
});

emailCodeRoutes.post('/api/auth/email-code/verify', async (c) => {
  const ipBucket = `logincode-verify-ip:${clientIp(c)}`;
  const ipRl = await enforce(c, ipBucket, 30, 900);
  if (ipRl) return ipRl;
  if (!c.env.JWT_SECRET) return c.json({ error: 'Auth not configured' }, 500);
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const code = (body.code ?? '').trim();
  if (!EMAIL_RE.test(email) || !code) {
    return c.json({ error: 'Email and code are required' }, 400);
  }
  // Only the browser that requested the code holds its ceremony cookie; without it there is
  // nothing to guess against. The email must match the one the ceremony was minted for.
  const ceremony = await readCodeCeremony(c.req.raw, c.env);
  if (!ceremony || ceremony.email !== email) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'code_ceremony_missing', email });
    return c.json({ error: 'Invalid or expired code' }, 401);
  }

  const userId = await verifyLoginCode(c.env, ceremony.codeId, email, code);
  if (userId === null) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'bad_code', email });
    return c.json({ error: 'Invalid or expired code' }, 401);
  }
  // Proof of humanity and possession: the shared per-IP budget resets so one office/CGNAT
  // address can keep signing its users in (the auth.ts clear-on-success rule).
  await clearRateLimit(c.env, ipBucket);
  // Typing a mailed code IS proof of inbox control — the same proof the verification link asks
  // for, so the pending "confirm your address" state resolves here for free.
  await c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
  c.header('Set-Cookie', cookie(LOGINCODE_COOKIE, '', 0, c.env), { append: true });

  // Second factor: identical rule to password login — the inbox is one factor, not two.
  if (await getTotpForLogin(c.env, userId)) {
    logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'challenge_issued', userId, email });
    c.header('Set-Cookie', await issueTwofaChallengeCookie(userId, 'email', c.env), {
      append: true,
    });
    return c.json({ twofaRequired: true });
  }
  logAuthEvent(c, { event: 'login', outcome: 'ok', userId, email });
  c.header(
    'Set-Cookie',
    await issueSessionCookie(userId, 'email', c.env, {
      userAgent: c.req.header('user-agent') ?? null,
      ip: clientIp(c),
    }),
    { append: true }
  );
  return c.json({ id: userId, email });
});
