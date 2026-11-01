/**
 * A solved Cloudflare check covers the sign-in tries that follow it, for five minutes from the
 * solve (worker/src/login-check.ts).
 *
 * A password sign-in whose token Cloudflare passed, and which then fails on the password, leaves
 * the browser a login check: an HttpOnly cookie for POST /api/auth/login, bound to the network
 * address the Worker sees and signed with a key of its own. While it is good, the next tries need
 * no new token. Five tries in all per solved check, the first one included; then the check runs
 * again. Every other route behind the captcha still needs a fresh token, the limits on sign-in are
 * unchanged, and nothing about a check can stop the right password from signing in with a token
 * Cloudflare passed.
 *
 * Cloudflare's siteverify is stubbed: a token that starts with "good" passes, any other fails, and
 * `solvedAgo` sets how long before now Cloudflare says the check was solved, and `solveTime`
 * whether its answer says so at all.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { b64urlDecode, b64urlEncode, hashPassword, hmacKey } from '../src/auth';
import {
  LOGIN_CHECK_COOKIE,
  LOGIN_CHECK_SECONDS,
  LOGIN_CHECK_TRIES,
  loginCheckBytes,
} from '../src/login-check';

const BASE = 'https://api.example.com';
const LOGIN = `${BASE}/api/auth/login`;
const EMAIL = 'login-check@example.com';
/** A password account whose address waits for its confirm link. */
const WAITING = 'login-check-waiting@example.com';
/** An account with a second factor. */
const TWOFA = 'login-check-twofa@example.com';
/** An address with no account. */
const NOBODY = 'login-check-nobody@example.com';
const PASSWORD = 'the-right-password';
const WRONG = 'not-the-password';
const HOME = '198.51.100.7';
const ELSEWHERE = '203.0.113.99';

const base = env as unknown as Env;
/** The Worker with Cloudflare's check switched on, as every deployed environment has it. */
const CHECKED: Env = { ...base, TURNSTILE_SECRET: 'test-turnstile-secret', APP_ENV: 'dev' };
/** Local development: no secret, so the captcha is off. */
const LOCAL: Env = { ...base, TURNSTILE_SECRET: undefined, APP_ENV: 'development' };
/** A deployed environment whose secret was never set: every captcha-guarded route refuses. */
const UNCONFIGURED: Env = { ...base, TURNSTILE_SECRET: undefined, APP_ENV: 'dev' };

/** The tokens siteverify was asked about, in order. */
let verified: string[] = [];
/** How many seconds before now Cloudflare says the check was solved. */
let solvedAgo = 0;
/** Whether siteverify's answer says when the check was solved: yes, not at all, or unreadably. */
let solveTime: 'given' | 'missing' | 'garbage' = 'given';

beforeEach(async () => {
  verified = [];
  solvedAgo = 0;
  solveTime = 'given';
  await env.DB.prepare('DELETE FROM rate_limits').run();
  const accounts = [EMAIL, WAITING, TWOFA];
  await env.DB.prepare(
    `DELETE FROM totp_credentials WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?, ?))`
  )
    .bind(...accounts)
    .run();
  await env.DB.prepare('DELETE FROM users WHERE email IN (?, ?, ?)')
    .bind(...accounts)
    .run();
  const hash = await hashPassword(PASSWORD);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
    ).bind(EMAIL, hash),
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
    ).bind(WAITING, hash),
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
    ).bind(TWOFA, hash),
  ]);
  await env.DB.prepare(
    "INSERT INTO totp_credentials (user_id, secret_enc, confirmed_at) SELECT id, 'x', datetime('now') FROM users WHERE email = ?"
  )
    .bind(TWOFA)
    .run();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('challenges.cloudflare.com')) {
      const token = new URLSearchParams(String(init?.body)).get('response') ?? '';
      verified.push(token);
      if (!token.startsWith('good')) {
        return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
      }
      return Response.json({
        success: true,
        'error-codes': [],
        // Solved on the app's page (CORS_ORIGIN). No action: siteverify is asked on behalf of
        // every route here, and a check that names none counts on each (captcha-fields.test.ts).
        hostname: new URL(CHECKED.CORS_ORIGIN!).hostname,
        ...(solveTime === 'missing'
          ? {}
          : {
              challenge_ts:
                solveTime === 'garbage'
                  ? 'not a time'
                  : new Date(Date.now() - solvedAgo * 1000).toISOString(),
            }),
      });
    }
    if (url.includes('api.resend.com')) return Response.json({ id: 're_1' });
    throw new Error(`unexpected fetch: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Try {
  password?: string;
  email?: string;
  token?: string;
  /** The network address the Worker sees; null sends no CF-Connecting-IP at all. */
  ip?: string | null;
  /** A Cookie header. */
  cookie?: string | null;
  e?: Env;
}

/** POST a request to `url` the way the app sends it, and wait for what it leaves running. */
async function post(url: string, body: unknown, t: Try = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t.ip !== null) headers['CF-Connecting-IP'] = t.ip ?? HOME;
  if (t.cookie) headers.Cookie = t.cookie;
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }),
    t.e ?? CHECKED,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** One password sign-in. */
function signIn(t: Try = {}): Promise<Response> {
  return post(
    LOGIN,
    { email: t.email ?? EMAIL, password: t.password ?? WRONG, turnstileToken: t.token },
    t
  );
}

/** The Set-Cookie line for the login check, or null. */
function checkLine(res: Response): string | null {
  return (
    res.headers.getSetCookie().find((line) => line.startsWith(`${LOGIN_CHECK_COOKIE}=`)) ?? null
  );
}

/** The login check a response left, as a Cookie header the browser sends back, or null. */
function checkLeft(res: Response): string | null {
  const line = checkLine(res);
  if (!line) return null;
  const pair = line.split(';')[0]!;
  return pair === `${LOGIN_CHECK_COOKIE}=` ? null : pair;
}

/** Whether a response removes the login check from the browser. */
function checkCleared(res: Response): boolean {
  const line = checkLine(res);
  return line !== null && line.startsWith(`${LOGIN_CHECK_COOKIE}=;`) && /Max-Age=0/.test(line);
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.clone().json()) as Record<string, unknown>;
}

/** A wrong password with a token Cloudflare passed: the check it leaves, as a Cookie header. */
async function earnCheck(t: Try = {}): Promise<string> {
  const res = await signIn({ token: 'good-first', ...t });
  expect(res.status).toBe(401);
  const cookie = checkLeft(res);
  expect(cookie, 'a refused sign-in after a passed check leaves a login check').not.toBeNull();
  return cookie!;
}

/** The parts of a check's value: format, expiry, id, signature. */
function parts(cookie: string): [string, string, string, string] {
  const value = cookie.slice(`${LOGIN_CHECK_COOKIE}=`.length);
  const [format, exp, id, mac] = value.split('.');
  return [format!, exp!, id!, mac!];
}

const withValue = (value: string) => `${LOGIN_CHECK_COOKIE}=${value}`;

describe('a wrong password after a check Cloudflare passed', () => {
  it('leaves a check that covers the next tries, for five minutes from the solve', async () => {
    const res = await signIn({ token: 'good-1' });

    expect(res.status).toBe(401);
    const said = await body(res);
    expect(said.error).toBe('Invalid email or password');
    expect(said.checkValidForSeconds).toBeGreaterThanOrEqual(LOGIN_CHECK_SECONDS - 1);
    expect(said.checkValidForSeconds).toBeLessThanOrEqual(LOGIN_CHECK_SECONDS);

    const line = checkLine(res)!;
    // Only this route reads it, on this host, and page scripts never see it.
    expect(line).toMatch(/; Path=\/api\/auth\/login(;|$)/);
    expect(line).toMatch(/; HttpOnly(;|$)/);
    expect(line).toMatch(/; SameSite=Lax(;|$)/);
    expect(line).toMatch(/; Secure(;|$)/);
    expect(line).not.toMatch(/Domain=/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(line)![1]);
    expect(maxAge).toBe(said.checkValidForSeconds);
    // Bound to the address without carrying it.
    expect(line).not.toContain(HOME);
    expect(verified).toEqual(['good-1']);
  });

  it('counts the five minutes from when Cloudflare says the check was solved', async () => {
    solvedAgo = 120;
    const res = await signIn({ token: 'good-1' });

    expect(res.status).toBe(401);
    const seconds = (await body(res)).checkValidForSeconds as number;
    expect(seconds).toBeGreaterThanOrEqual(LOGIN_CHECK_SECONDS - 121);
    expect(seconds).toBeLessThanOrEqual(LOGIN_CHECK_SECONDS - 120);
    expect(Number(/Max-Age=(\d+)/.exec(checkLine(res)!)![1])).toBe(seconds);
  });

  it('counts from now when Cloudflare dates the solve in the future, never past five minutes', async () => {
    solvedAgo = -600;
    const res = await signIn({ token: 'good-1' });

    expect((await body(res)).checkValidForSeconds).toBeLessThanOrEqual(LOGIN_CHECK_SECONDS);
  });

  it('leaves no check when Cloudflare does not say when the check was solved', async () => {
    for (const answer of ['missing', 'garbage'] as const) {
      solveTime = answer;

      const res = await signIn({ token: `good-${answer}` });

      expect(res.status, answer).toBe(401);
      expect(await body(res), answer).toEqual({ error: 'Invalid email or password' });
      expect(checkLine(res), answer).toBeNull();
    }
  });

  it('signs in as before when Cloudflare does not say when the check was solved', async () => {
    solveTime = 'missing';

    const res = await signIn({ password: PASSWORD, token: 'good-1' });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((line) => line.startsWith('fm_session='))).toBe(true);
    expect(checkLine(res)).toBeNull();
  });

  it('covers the next try with no token and nothing asked of Cloudflare', async () => {
    const cookie = await earnCheck();
    const first = verified.length;

    const res = await signIn({ cookie });

    expect(res.status).toBe(401);
    expect(verified.length).toBe(first);
    // The same check, counting down from the same solve: it is not renewed by a try.
    const seconds = (await body(res)).checkValidForSeconds as number;
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(LOGIN_CHECK_SECONDS);
    expect(checkLine(res)).toBeNull();
  });

  it('signs in with the right password next, on the one check', async () => {
    const cookie = await earnCheck();

    const res = await signIn({ password: PASSWORD, cookie });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((line) => line.startsWith('fm_session='))).toBe(true);
    // A sign-in that went through ends the check.
    expect(checkCleared(res)).toBe(true);
    expect(verified).toEqual(['good-first']);
  });

  it('ends the check when the right password leads to the second factor', async () => {
    const cookie = await earnCheck({ email: TWOFA });

    const res = await signIn({ email: TWOFA, password: PASSWORD, cookie });

    expect(res.status).toBe(200);
    expect((await body(res)).twofaRequired).toBe(true);
    expect(res.headers.getSetCookie().some((line) => line.startsWith('fm_2fa='))).toBe(true);
    expect(checkCleared(res)).toBe(true);
  });

  it('is answered for an account waiting for its confirm link exactly as for a wrong password', async () => {
    // One instant for both, so the seconds left are the same number.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-30T11:00:00Z'));
    const wrong = await signIn({ token: 'good-1' });
    const waiting = await signIn({ email: WAITING, password: PASSWORD, token: 'good-2' });

    expect(waiting.status).toBe(wrong.status);
    expect(await body(waiting)).toEqual(await body(wrong));
    const shape = (line: string | null) => line?.replace(/^[^=]+=[^;]*/, 'V');
    expect(shape(checkLine(waiting))).toBe(shape(checkLine(wrong)));
  });

  it('is answered for an address with no account exactly as for a wrong password', async () => {
    await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(NOBODY).run();
    // One instant for both, so the seconds left are the same number.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-30T11:00:00Z'));
    const wrong = await signIn({ token: 'good-1' });
    const nobody = await signIn({ email: NOBODY, token: 'good-2' });

    expect(nobody.status).toBe(401);
    expect(await body(nobody)).toEqual(await body(wrong));
    expect((await body(nobody)).checkValidForSeconds).toEqual(expect.any(Number));
    const shape = (line: string | null) => line?.replace(/^[^=]+=[^;]*/, 'V');
    expect(checkLine(nobody)).not.toBeNull();
    expect(shape(checkLine(nobody))).toBe(shape(checkLine(wrong)));
    // And it is a check like any other: it covers the next try.
    expect((await signIn({ email: NOBODY, cookie: checkLeft(nobody)! })).status).toBe(401);
  });
});

describe('what one solved check covers', () => {
  it(`is ${LOGIN_CHECK_TRIES} tries in all, then the check runs again`, async () => {
    const cookie = await earnCheck();
    const answers: Array<{ status: number; seconds: unknown; cleared: boolean }> = [];

    for (let i = 0; i < LOGIN_CHECK_TRIES; i++) {
      const res = await signIn({ cookie });
      answers.push({
        status: res.status,
        seconds: (await body(res)).checkValidForSeconds,
        cleared: checkCleared(res),
      });
    }

    // Tries 2 to 4 are covered and say the next one is too.
    for (const answer of answers.slice(0, LOGIN_CHECK_TRIES - 2)) {
      expect(answer.status).toBe(401);
      expect(answer.seconds).toEqual(expect.any(Number));
      expect(answer.cleared).toBe(false);
    }
    // Try 5 is covered and is the last: it says nothing more is, and lets the check go.
    expect(answers[LOGIN_CHECK_TRIES - 2]).toEqual({
      status: 401,
      seconds: undefined,
      cleared: true,
    });
    // Try 6, the same check sent again, is not covered.
    expect(answers[LOGIN_CHECK_TRIES - 1]!.status).toBe(403);
    expect(answers[LOGIN_CHECK_TRIES - 1]!.cleared).toBe(true);
    expect(verified).toEqual(['good-first']);
  });

  it('counts the tries of two tabs together, even when they land at once', async () => {
    const cookie = await earnCheck();

    const answers = await Promise.all(
      Array.from({ length: LOGIN_CHECK_TRIES + 1 }, () => signIn({ cookie }))
    );

    const statuses = answers.map((res) => res.status).sort();
    expect(statuses.filter((s) => s === 401)).toHaveLength(LOGIN_CHECK_TRIES - 1);
    expect(statuses.filter((s) => s === 403)).toHaveLength(2);
  });

  it('runs out five minutes after the solve', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const solved = Date.parse('2026-10-30T09:00:00Z');
    vi.setSystemTime(solved);
    const cookie = await earnCheck();

    vi.setSystemTime(solved + (LOGIN_CHECK_SECONDS - 2) * 1000);
    const lastMoment = await signIn({ cookie });
    expect(lastMoment.status).toBe(401);
    expect((await body(lastMoment)).checkValidForSeconds).toBe(2);

    vi.setSystemTime(solved + LOGIN_CHECK_SECONDS * 1000);
    const over = await signIn({ cookie });
    expect(over.status).toBe(403);
    expect(checkCleared(over)).toBe(true);
  });

  it('covers nothing from another network address', async () => {
    const cookie = await earnCheck();

    const res = await signIn({ cookie, ip: ELSEWHERE });

    expect(res.status).toBe(403);
    expect(checkCleared(res)).toBe(true);
    // The same value from the address it was left for still counts: the address is the reason.
    expect((await signIn({ cookie })).status).toBe(401);
  });

  it('is left only where Cloudflare names the address, and taken only there', async () => {
    const res = await signIn({ token: 'good-1', ip: null });

    expect(res.status).toBe(401);
    expect((await body(res)).checkValidForSeconds).toBeUndefined();
    expect(checkLine(res)).toBeNull();

    const cookie = await earnCheck();
    expect((await signIn({ cookie, ip: null })).status).toBe(403);
  });

  it('covers nothing once any part of it is changed', async () => {
    const cookie = await earnCheck();
    const [format, exp, id, mac] = parts(cookie);
    const otherId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    // A character from the middle of the signature, which carries six of its bits. The last one
    // also carries two padding bits that decoding drops, so changing it can leave the same bytes.
    const flipped = (s: string) => {
      const i = Math.floor(s.length / 2);
      return `${s.slice(0, i)}${s[i] === 'A' ? 'B' : 'A'}${s.slice(i + 1)}`;
    };
    expect(b64urlDecode(flipped(mac))).not.toEqual(b64urlDecode(mac));
    const changed = [
      ['v2', exp, id, mac],
      [format, String(Number(exp) + 60), id, mac],
      [format, String(Number(exp) - 60), id, mac],
      [format, exp, otherId, mac],
      [format, exp, id, flipped(mac)],
      [format, exp, id, mac, 'extra'],
    ];

    for (const value of changed) {
      const res = await signIn({ cookie: withValue(value.join('.')) });
      expect(res.status, value.join('.')).toBe(403);
      expect(checkCleared(res)).toBe(true);
    }
    expect(verified).toEqual(['good-first']);
  });

  it('covers nothing, and fails nothing, when the value is not a check at all', async () => {
    const values = [
      '',
      'x',
      'v1...',
      'v1.abc.def.ghi',
      `v1.${'9'.repeat(40)}.${'A'.repeat(22)}.${'A'.repeat(43)}`,
      `v1.1700000000.${'A'.repeat(22)}.%%%`,
      'v1.-5.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
      'a'.repeat(4000),
    ];

    for (const value of values) {
      const res = await signIn({ cookie: withValue(value) });
      expect(res.status, JSON.stringify(value.slice(0, 40))).toBe(403);
    }
  });

  it('is signed under a key of its own: the same bytes signed with the session key cover nothing', async () => {
    const cookie = await earnCheck();
    const [format, exp, id] = parts(cookie);
    const sessionKey = await hmacKey(base.JWT_SECRET!);
    const mac = await crypto.subtle.sign(
      'HMAC',
      sessionKey,
      loginCheckBytes(Number(exp), id, HOME)
    );

    const res = await signIn({ cookie: withValue(`${format}.${exp}.${id}.${b64urlEncode(mac)}`) });

    expect(res.status).toBe(403);
  });

  it('is signed for one deployment: a check left under another APP_ENV covers nothing', async () => {
    // The same JWT_SECRET on both, so the deployment is the only difference.
    const production: Env = { ...CHECKED, APP_ENV: 'production' };
    const cookie = await earnCheck({ e: production });

    const res = await signIn({ cookie });

    expect(res.status).toBe(403);
    expect(checkCleared(res)).toBe(true);
    // Where it was left, it covers the next try.
    expect((await signIn({ cookie, e: production })).status).toBe(401);
  });
});

describe('a sign-in that goes through ends the check on the Worker too', () => {
  // The browser is told to drop the check (above). These send a copy of the value afterwards.

  it('after a sign-in the check covered', async () => {
    const cookie = await earnCheck();
    expect((await signIn({ password: PASSWORD, cookie })).status).toBe(200);

    const copy = await signIn({ cookie });

    expect(copy.status).toBe(403);
    expect(checkCleared(copy)).toBe(true);
  });

  it('after a sign-in with a fresh token, the check sent beside it', async () => {
    const cookie = await earnCheck();
    expect((await signIn({ password: PASSWORD, token: 'good-again', cookie })).status).toBe(200);

    expect((await signIn({ cookie })).status).toBe(403);
  });

  it('after the right password reached the second factor', async () => {
    const cookie = await earnCheck({ email: TWOFA });
    const res = await signIn({ email: TWOFA, password: PASSWORD, cookie });
    expect((await body(res)).twofaRequired).toBe(true);

    expect((await signIn({ email: TWOFA, cookie })).status).toBe(403);
  });
});

describe('only a password sign-in takes a check', () => {
  const OTHERS: Array<{ name: string; url: string; body: Record<string, unknown> }> = [
    {
      name: 'creating an account',
      url: `${BASE}/api/auth/register`,
      body: { email: 'login-check-new@example.com', password: 'a-new-password-here' },
    },
    {
      name: 'asking for a reset link',
      url: `${BASE}/api/auth/forgot-password`,
      body: { email: EMAIL },
    },
    {
      name: 'sending the confirm link again',
      url: `${BASE}/api/auth/verify-email/resend`,
      body: { email: WAITING },
    },
    {
      name: 'asking for a sign-in code',
      url: `${BASE}/api/auth/email-code/request`,
      body: { email: EMAIL },
    },
    {
      name: 'writing to support',
      url: `${BASE}/api/support/contact`,
      body: { email: EMAIL, message: 'I cannot sign in.' },
    },
  ];

  it.each(OTHERS)('$name still needs a fresh token, with a good check in hand', async (route) => {
    const cookie = await earnCheck();
    const first = verified.length;

    const res = await post(route.url, route.body, { cookie });

    expect(res.status).toBe(403);
    expect(verified.length).toBe(first);
  });
});

describe('with the captcha off, or not set up', () => {
  it('leaves nothing in local development, where the captcha is off', async () => {
    const res = await signIn({ e: LOCAL });

    expect(res.status).toBe(401);
    expect(await body(res)).toEqual({ error: 'Invalid email or password' });
    expect(checkLine(res)).toBeNull();
    expect((await signIn({ e: LOCAL, password: PASSWORD })).status).toBe(200);
    expect(verified).toEqual([]);
  });

  it('refuses every sign-in where the secret was never set, a good check included', async () => {
    const cookie = await earnCheck();

    const res = await signIn({ e: UNCONFIGURED, password: PASSWORD, cookie });

    expect(res.status).toBe(503);
  });
});

describe('the right password always signs in with a token Cloudflare passed', () => {
  it('whatever check comes with it: run out, from another address, changed, or used up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const solved = Date.parse('2026-10-30T10:00:00Z');
    vi.setSystemTime(solved);
    const good = await earnCheck();
    const fromElsewhere = await earnCheck({ ip: ELSEWHERE });
    const [format, exp, id, mac] = parts(good);
    const usedUp = await earnCheck();
    for (let i = 0; i < LOGIN_CHECK_TRIES; i++) await signIn({ cookie: usedUp });
    vi.setSystemTime(solved + 60_000);
    const runOut = good;
    const later = solved + (LOGIN_CHECK_SECONDS + 1) * 1000;

    const cases: Array<[string, string, number?]> = [
      ['from another address', fromElsewhere],
      ['changed', withValue(`${format}.${exp}.${id}.${mac.slice(0, -2)}xx`)],
      ['used up', usedUp],
      ['not a check', withValue('nonsense')],
      ['run out', runOut, later],
    ];
    for (const [what, cookie, at] of cases) {
      if (at) vi.setSystemTime(at);
      const res = await signIn({ password: PASSWORD, token: `good-${what}`, cookie });
      expect(res.status, what).toBe(200);
    }
  });

  it('and with a good check, a token Cloudflare refuses changes nothing', async () => {
    const cookie = await earnCheck();

    const res = await signIn({ password: PASSWORD, token: 'forged', cookie });

    expect(res.status).toBe(200);
    expect(verified).toEqual(['good-first', 'forged']);
  });

  it('a fresh token beside a good check starts a check of its own', async () => {
    solvedAgo = 200;
    const old = await earnCheck();
    solvedAgo = 0;

    const res = await signIn({ token: 'good-fresh', cookie: old });

    expect(res.status).toBe(401);
    expect((await body(res)).checkValidForSeconds).toBeGreaterThanOrEqual(LOGIN_CHECK_SECONDS - 1);
    const fresh = checkLeft(res);
    expect(fresh).not.toBeNull();
    expect(parts(fresh!)[2]).not.toBe(parts(old)[2]);
  });

  it('one tab signing in ends the check the other tab shares, and the other tab signs in with a token', async () => {
    const shared = await earnCheck();
    expect((await signIn({ cookie: shared })).status).toBe(401);

    const first = await signIn({ password: PASSWORD, cookie: shared });
    expect(first.status).toBe(200);
    expect(checkCleared(first)).toBe(true);

    // The browser dropped the check: the other tab's next try runs Cloudflare's check again.
    expect((await signIn({ password: PASSWORD })).status).toBe(403);
    expect((await signIn({ password: PASSWORD, token: 'good-second-tab' })).status).toBe(200);
  });
});

describe('the limits on sign-in stay as they are', () => {
  const fill = (bucket: string, count: number) =>
    env.DB.prepare('INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, ?, ?)')
      .bind(bucket, count, Date.now() + 900_000)
      .run();

  it("a covered try counts against the address's limit like any other", async () => {
    const cookie = await earnCheck();
    await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ?')
      .bind(`login-email:${EMAIL}`)
      .run();
    await fill(`login-email:${EMAIL}`, 10);

    expect((await signIn({ cookie })).status).toBe(429);
  });

  it("a covered try counts against the network address's limit like any other", async () => {
    const cookie = await earnCheck();
    await env.DB.prepare('DELETE FROM rate_limits WHERE bucket = ?').bind(`login:${HOME}`).run();
    await fill(`login:${HOME}`, 30);

    expect((await signIn({ cookie })).status).toBe(429);
  });
});
