/**
 * A solved Cloudflare check covers the password sign-in tries that follow it, for five minutes
 * from the solve.
 *
 * Cloudflare's siteverify takes a Turnstile token once, so every try used to need a check of its
 * own, and after a wrong password the box came back before the next one. Now a password sign-in
 * whose token Cloudflare passed, and which then fails on the password, leaves the browser a login
 * check: an HttpOnly cookie on this API host, sent only to POST /api/auth/login. While it is good,
 * the next tries need no token, and each refusal says for how many more seconds the next try is
 * covered (`checkValidForSeconds` in the 401), so the form knows not to ask for a check before then.
 *
 * - It lasts LOGIN_CHECK_SECONDS from when Cloudflare says the check was solved (`challenge_ts`),
 *   as the token would have, and a try does not renew it.
 * - It covers LOGIN_CHECK_TRIES tries in all, the one that carried the token included. The tries
 *   are counted in rate_limits under the check's own id, one atomic statement per try, so tabs
 *   that share the cookie share the count.
 * - It is bound to the address the Worker sees (CF-Connecting-IP). The address is signed with the
 *   rest but not written into the cookie, so the cookie holds no address and covers nothing from
 *   another one. A request that names no address neither leaves a check nor has one taken.
 * - It is signed with a key of its own, derived from JWT_SECRET with HKDF under its own label, so
 *   a session, an OAuth state, an email-link marker or a capability cannot pass for a login check.
 *   The label names the deployment (APP_ENV), so a check left on one deployment covers nothing on
 *   another, even one given the same JWT_SECRET.
 * - Everything else fails closed: a check that ran out, was changed, comes from another address,
 *   is used up or cannot be read covers nothing, and the try needs a token as it always did. The
 *   answer clears such a check, so the browser stops sending it.
 * - A token Cloudflare passes is used whenever one comes, and starts a check of its own. A carried
 *   check is looked at only for a try with no token or one Cloudflare refused, so the right
 *   password with a passed token signs in whatever check came with it.
 * - A sign-in that goes through, to a session or to the second factor, ends the check.
 * - Only this route reads it: creating an account, a reset link, the confirm link, a sign-in code
 *   and the support form need a token every time. The limits on sign-in, per network address and
 *   per account, count every try as before.
 * - With the captcha off (local development with no TURNSTILE_SECRET) there is no check to cover,
 *   and a deployment with no secret refuses every sign-in, a check included (turnstile.ts).
 */
import type { Context } from 'hono';
import type { AppEnv, Env } from './index';
import { b64urlDecode, b64urlEncode, readCookies } from './auth';
import * as db from './db';
import { turnstileConfigured, verifyTurnstileDetailed, type TurnstileResult } from './turnstile';

export const LOGIN_CHECK_COOKIE = 'fm_login_check';
/** The one route that reads it. A cookie's Path is a prefix, and this one names only that route. */
export const LOGIN_CHECK_PATH = '/api/auth/login';
/** How long a solved check covers sign-in tries, counted from the solve. */
export const LOGIN_CHECK_SECONDS = 5 * 60;
/** How many sign-in tries one solved check covers, the one that carried its token included. */
export const LOGIN_CHECK_TRIES = 5;
/** How many login checks of one request are looked at. A browser holds one; each costs a verify. */
const LOGIN_CHECKS_READ = 3;
const FORMAT = 'v1';
/** The HKDF label of the key, so the key signs login checks and nothing else. */
const KEY_LABEL = 'token-circles login-check v1';

const encoder = new TextEncoder();

/** A login check a request carried, genuine, unexpired and left for the address it came from. */
export interface LoginCheck {
  id: string;
  /** When it runs out, in epoch seconds. */
  exp: number;
}

/** How a password sign-in try got past Cloudflare's check, or why it did not. */
export type SignInCheck =
  | { ok: true; by: 'off'; carried: boolean }
  | { ok: true; by: 'token'; solvedAt: number; carried: boolean }
  | { ok: true; by: 'check'; check: LoginCheck; triesLeft: number; carried: true }
  | {
      ok: false;
      result: Extract<TurnstileResult, { ok: false }>;
      /** The reason the auth log records. */
      why: string;
      carried: boolean;
    };

/** What a login check signs. Exported so a test can sign the same bytes with another key. */
export function loginCheckBytes(exp: number, id: string, ip: string) {
  return encoder.encode(`login-check.${FORMAT}.${exp}.${id}.${ip}`);
}

/** The key that signs this deployment's login checks. Callers check that JWT_SECRET is set. */
async function loginCheckKey(secret: string, appEnv: string | undefined): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      // The deployment is part of the label: a check left on dev never verifies on prod, even if
      // the two were ever given the same JWT_SECRET.
      info: encoder.encode(`${KEY_LABEL} env=${appEnv ?? ''}`),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
}

function loginCheckCookie(value: string, maxAgeSeconds: number, env: Env): string {
  // Host-only (no Domain), and sent to the sign-in route alone.
  const secure = env.APP_ENV !== 'development'; // local http dev can't send Secure cookies
  return [
    `${LOGIN_CHECK_COOKIE}=${value}`,
    `Path=${LOGIN_CHECK_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/** The Set-Cookie that removes the login check. */
export function clearedLoginCheck(env: Env): string {
  return loginCheckCookie('', 0, env);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The address Cloudflare says the request came from, '' when it names none. */
const addressOf = (c: Context<AppEnv>) => c.req.header('CF-Connecting-IP') ?? '';

/** The login check the request carries for `ip`, or null when it carries none that is good. */
async function carriedCheck(request: Request, env: Env, ip: string): Promise<LoginCheck | null> {
  // No address, no work: no check is ever left without one (coverNextTry), and the address is
  // signed, so a check left for another one would not verify here anyway.
  if (!ip || !env.JWT_SECRET) return null;
  const values = readCookies(request, LOGIN_CHECK_COOKIE).filter((v) => v !== '');
  if (values.length === 0) return null;
  const key = await loginCheckKey(env.JWT_SECRET, env.APP_ENV);
  const now = nowSeconds();
  for (const value of values.slice(0, LOGIN_CHECKS_READ)) {
    const [format, expPart, id, macPart, ...rest] = value.split('.');
    if (rest.length > 0 || format !== FORMAT || !expPart || !id || !macPart) continue;
    if (!/^[0-9]{1,12}$/.test(expPart)) continue;
    const exp = Number(expPart);
    // Run out, or longer than any check lasts, which no check this Worker left can be.
    if (exp <= now || exp > now + LOGIN_CHECK_SECONDS) continue;
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) continue;
    let mac: Uint8Array;
    try {
      mac = b64urlDecode(macPart);
    } catch {
      continue;
    }
    if (await crypto.subtle.verify('HMAC', key, mac, loginCheckBytes(exp, id, ip))) {
      return { id, exp };
    }
  }
  return null;
}

/**
 * Count one try against `check`: the tries it covers after this one, or null when it has covered
 * all it covers. One statement, so tries that land at once are counted one by one.
 */
async function countTry(env: Env, check: LoginCheck): Promise<number | null> {
  // The try that carried the token was the first of them.
  const covered = LOGIN_CHECK_TRIES - 1;
  const res = await db.run(
    env.DB,
    `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET count = count + 1 WHERE count < ?
     RETURNING count`,
    `login-check:${check.id}`,
    // The count goes when the check does: the cron sweeps expired buckets (sweepRateLimits).
    check.exp * 1000,
    covered
  );
  const count = (res.results?.[0] as { count?: unknown } | undefined)?.count;
  return typeof count === 'number' ? covered - count : null;
}

/**
 * Whether this password sign-in try may go on: a token Cloudflare passes now, or else a login
 * check the request carries that still covers a try (and counts it).
 */
export async function checkSignInTry(
  c: Context<AppEnv>,
  token: string | undefined
): Promise<SignInCheck> {
  const carried = readCookies(c.req.raw, LOGIN_CHECK_COOKIE).some((v) => v !== '');
  if (!turnstileConfigured(c.env)) {
    // Off in local development and refused everywhere else (turnstile.ts). A check changes neither.
    const result = await verifyTurnstileDetailed(c, token);
    return result.ok
      ? { ok: true, by: 'off', carried }
      : { ok: false, result, why: `captcha:${result.reason}`, carried };
  }
  let refused: Extract<TurnstileResult, { ok: false }> | undefined;
  if (token) {
    const result = await verifyTurnstileDetailed(c, token);
    if (result.ok)
      return { ok: true, by: 'token', solvedAt: result.solvedAt ?? Date.now(), carried };
    refused = result;
  }
  if (carried) {
    const check = await carriedCheck(c.req.raw, c.env, addressOf(c));
    const triesLeft = check ? await countTry(c.env, check) : null;
    if (check && triesLeft !== null) return { ok: true, by: 'check', check, triesLeft, carried };
  }
  const result = refused ?? { ok: false as const, reason: 'no-token' as const, codes: [] };
  // A check that came and covered nothing is worth recording: it is why the box came back.
  return { ok: false, result, why: `captcha:${result.reason}${carried ? ':check' : ''}`, carried };
}

/**
 * For a sign-in refused on its password (401) after it got past the check: leave or keep the login
 * check for the next try, and say for how many seconds it covers it. Undefined when the next try
 * is not covered, and then the request's own check, if it carried one, goes.
 */
export async function coverNextTry(
  c: Context<AppEnv>,
  check: Extract<SignInCheck, { ok: true }>
): Promise<number | undefined> {
  if (check.by === 'off') return undefined;
  if (check.by === 'check') {
    const seconds = check.check.exp - nowSeconds();
    if (check.triesLeft > 0 && seconds > 0) return seconds;
    endLoginCheck(c, check);
    return undefined;
  }
  const ip = addressOf(c);
  const exp = Math.floor(check.solvedAt / 1000) + LOGIN_CHECK_SECONDS;
  const seconds = exp - nowSeconds();
  if (!ip || !c.env.JWT_SECRET || seconds <= 0) {
    endLoginCheck(c, check);
    return undefined;
  }
  const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const mac = await crypto.subtle.sign(
    'HMAC',
    await loginCheckKey(c.env.JWT_SECRET, c.env.APP_ENV),
    loginCheckBytes(exp, id, ip)
  );
  c.header(
    'Set-Cookie',
    loginCheckCookie(`${FORMAT}.${exp}.${id}.${b64urlEncode(mac)}`, seconds, c.env),
    { append: true }
  );
  return seconds;
}

/** The request's login check goes: its sign-in went through, or the check covered nothing. */
export function endLoginCheck(c: Context<AppEnv>, check: SignInCheck): void {
  if (check.carried) c.header('Set-Cookie', clearedLoginCheck(c.env), { append: true });
}
