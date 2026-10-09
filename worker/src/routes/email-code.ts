/**
 * "Email me a code" sign-in: POST /request mints a 6-digit code and mails it, after its answer
 * (identical neutral answer whether or not the address has an account — the forgot-password
 * anti-enumeration rule), POST /verify trades a live code for a session. The 2FA challenge still
 * applies after: an email code proves the inbox, which is one factor, not two. On an account whose
 * address was never confirmed, the code first removes every way in that was set up before
 * (clearUnconfirmedAccess).
 *
 * The verify step is bound to the browser that requested the code by a ceremony cookie
 * (fm_logincode): a random handle, whose SHA-256 hash the code's row keeps (login-codes.ts). That
 * binding is what keeps a 10^6 code space defensible: a third party who fires /request for
 * someone else's address gets a cookie for a code they cannot read, and has NO surface to guess at
 * the victim's own code — nor any way to exhaust a victim's verify budget, which is why there is
 * no per-address verify bucket here.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../index';
import {
  clearedAccess,
  clearedWorthSaying,
  clearUnconfirmedAccess,
  cookie,
  issueSessionCookie,
  readCookies,
  TRY_AGAIN,
} from '../auth';
import { logAuthEvent } from '../authlog';
import { sendMail } from '../email';
import { renderLoginCode } from '../emailTemplates';
import {
  createLoginCode,
  LOGIN_CODE_TTL_MINUTES,
  newCodeHandle,
  verifyLoginCode,
} from '../login-codes';
import { clearRateLimit, clientIp, enforce } from '../ratelimit';
import { getTotpForLogin, issueTwofaChallengeCookie } from '../twofa';
import { captchaRejection, verifyTurnstileDetailed } from '../turnstile';
import { refusalOf } from '../../../shared/refusal';
import {
  addressProblems,
  emailCodeProblems,
  noProblems,
  SIGN_IN_MESSAGES,
} from '../../../shared/signInSchema';

/**
 * The answer to a code that does not sign in: wrong, spent, expired, or asked for in another
 * browser. One answer for all of them, at the code field, in the words the form uses.
 */
const CODE_REFUSED = refusalOf({ code: SIGN_IN_MESSAGES.emailCodeRefused });

// ── The ceremony cookie: the handle of the request this browser made ──────────
export const LOGINCODE_COOKIE = 'fm_logincode';
const CEREMONY_TTL_SECONDS = LOGIN_CODE_TTL_MINUTES * 60;

/** The cookie that carries a code request's handle (newCodeHandle) back to the verify step. */
export function issueLoginCodeCookie(env: Env, handle: string): string {
  return cookie(LOGINCODE_COOKIE, handle, CEREMONY_TTL_SECONDS, env);
}

/**
 * The work a code request does after its answer: when `email` has an account, mint its code under
 * the request's handle and mail it. A failure here changes no answer; the person asks again.
 */
async function mailCodeIfAccount(
  env: Env,
  email: string,
  handle: string,
  base: string
): Promise<void> {
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>();
  if (!user) return;
  const { code } = await createLoginCode(env, user.id, email, handle);
  const mail = renderLoginCode({ code, ttlMinutes: LOGIN_CODE_TTL_MINUTES, assetOrigin: base });
  await sendMail(env, email, mail.subject, mail.html, { text: mail.text });
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
  const refused = addressProblems({ email });
  if (!noProblems(refused)) return c.json(refusalOf(refused), 400);
  // Per-address cap on top of per-IP (the forgot-password layering): one inbox can't be bombed
  // from rotating IPs, and the neutral 429 stays neutral for existing and unknown alike.
  const emailRl = await enforce(c, `logincode-email:${email}`, 3, 3600);
  if (emailRl) return emailRl;

  // The answer comes first: a new handle as the cookie, and ok. Looking the address up, minting
  // its code and mailing it come after the answer (mailCodeIfAccount), and a failure there is
  // logged, not answered.
  const handle = newCodeHandle();
  const base = c.env.CORS_ORIGIN || c.env.APP_ORIGINS?.split(',')[0] || new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    mailCodeIfAccount(c.env, email, handle, base).catch((e: unknown) => {
      console.error('Sign-in code could not be sent:', e);
    })
  );
  c.header('Set-Cookie', issueLoginCodeCookie(c.env, handle));
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
  const refused = emailCodeProblems({ email, code });
  if (!noProblems(refused)) return c.json(refusalOf(refused), 400);
  // Only the browser that requested the code holds its ceremony cookie; without it there is
  // nothing to guess against. The row it finds must be the one minted for this email.
  const handles = readCookies(c.req.raw, LOGINCODE_COOKIE).filter(Boolean);
  if (handles.length === 0) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'code_ceremony_missing', email });
    return c.json(CODE_REFUSED, 401);
  }

  const userId = await verifyLoginCode(c.env, handles, email, code);
  if (userId === null) {
    logAuthEvent(c, { event: 'login', outcome: 'denied', reason: 'bad_code', email });
    return c.json(CODE_REFUSED, 401);
  }
  // Proof of humanity and possession: the shared per-IP budget resets so one office/CGNAT
  // address can keep signing its users in (the auth.ts clear-on-success rule).
  await clearRateLimit(c.env, ipBucket);
  // Typing a mailed code IS proof of inbox control — the same proof the verification link asks
  // for, so the pending "confirm your address" state resolves here for free. On an account whose
  // address was not confirmed yet, every way in that was set up before goes first, in the same
  // batch (clearUnconfirmedAccess), so there is no second factor left to ask for. A confirmed
  // account keeps everything it has.
  const results = await c.env.DB.batch([
    ...clearUnconfirmedAccess(c.env.DB, userId),
    c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId),
    // The version this batch leaves, which the session below is bound to.
    c.env.DB.prepare('SELECT token_version FROM users WHERE id = ?').bind(userId),
  ]);
  const cleared = clearedWorthSaying(clearedAccess(results), 'sign-in');
  const after = results.at(-1)?.results[0] as { token_version: number } | undefined;
  c.header('Set-Cookie', cookie(LOGINCODE_COOKIE, '', 0, c.env), { append: true });
  if (!after) return c.json(CODE_REFUSED, 401);
  const signIn = { userId, provider: 'email', tokenVersion: after.token_version };

  // Second factor: identical rule to password login — the inbox is one factor, not two.
  if (await getTotpForLogin(c.env, userId)) {
    logAuthEvent(c, { event: 'twofa', outcome: 'ok', reason: 'challenge_issued', userId, email });
    c.header('Set-Cookie', await issueTwofaChallengeCookie(c.env, signIn), { append: true });
    return c.json({ twofaRequired: true });
  }
  const session = await issueSessionCookie(c.env, signIn, {
    userAgent: c.req.header('user-agent') ?? null,
    ip: clientIp(c),
  });
  if (!session) return c.json({ error: TRY_AGAIN }, 409);
  logAuthEvent(c, { event: 'login', outcome: 'ok', userId, email });
  c.header('Set-Cookie', session, { append: true });
  // `cleared` lets the app say what went. Clearing removes the TOTP too, so it never needs the
  // challenge branch above.
  return c.json(cleared ? { id: userId, email, cleared: true } : { id: userId, email });
});
