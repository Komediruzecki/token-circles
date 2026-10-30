/**
 * Google sign-in finishes in the browser that started it. The start route leaves a short-lived
 * cookie in the browser and puts its hash in the signed `state`; the callback signs in only when
 * the request carries that cookie, and clears it whatever happens. Google's two calls (the code
 * exchange and tokeninfo) are answered here, and every call is recorded, so a callback that never
 * asks Google can be told apart from one that asked and then stopped.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/index';
import { b64urlDecode, isAllowedReturnTo, signState } from '../src/auth';
import { sha256Hex } from '../src/email-verification';
import {
  accessRows,
  accountRow,
  me,
  removeAccounts,
  seedAccount,
  sessionFrom,
} from './helpers/account-access';
import {
  GOOGLE_STATE_COOKIE,
  googleCallback,
  googleSignInFromStart,
  startGoogleSignIn,
} from './helpers/google';

const UID = 6670;
const ADDRESS = 'browser-check@example.com';
const GOOGLE_SUB = 'google-sub-6670';
const RETURN_TO = 'http://localhost:3800';
const CALLBACK_PATH = '/api/auth/google/callback';
const STATE_TTL_MS = 10 * 60 * 1000;

/** This file's accounts: the seeded one, and any a Google sign-in created. */
const MINE = `SELECT ${UID} UNION SELECT id FROM users WHERE provider_id = '${GOOGLE_SUB}' OR lower(email) = '${ADDRESS}'`;

const realFetch = globalThis.fetch;
let googleCalls: string[];
let tokeninfo: () => Response;
let mailLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await removeAccounts(MINE);
  await env.DB.prepare('DELETE FROM rate_limits').run();

  const vars = env as unknown as Record<string, string>;
  vars.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  const claims = {
    aud: vars.GOOGLE_CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: GOOGLE_SUB,
    email: ADDRESS,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  tokeninfo = () => Response.json(claims);
  googleCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    googleCalls.push(url);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ id_token: 'test-id-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo') return tokeninfo();
    throw new Error(`Unexpected fetch in a test: ${url}`);
  }) as typeof fetch;
  // With no RESEND_API_KEY the mailer logs each mail as `[email] DEV ...` instead of sending it.
  mailLog = vi.spyOn(console, 'log');
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  mailLog.mockRestore();
  const vars = env as unknown as Record<string, string>;
  delete vars.GOOGLE_CLIENT_SECRET;
  vars.APP_ENV = 'development';
  await removeAccounts(MINE);
});

/** The rows a sign-in for this file's Google account would write. */
async function rowsWritten() {
  const users = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE id IN (${MINE})`
  ).first<{
    n: number;
  }>();
  const sessions = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id IN (${MINE})`
  ).first<{ n: number }>();
  return { users: users!.n, sessions: sessions!.n };
}

const mailsSent = () =>
  mailLog.mock.calls.filter((args) => String(args[0]).startsWith('[email]')).length;

/** The line that clears the start route's cookie, if the response carries one. */
function clearing(res: Response): string | undefined {
  return res.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${GOOGLE_STATE_COOKIE}=;`) && /Max-Age=0(;|$)/.test(line));
}

/** The JSON a signed state carries. */
function stateBody(state: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(state.split('.')[0]!)));
}

describe('the start of a Google sign-in', () => {
  it('leaves a cookie only the callback gets, and puts its hash in the state', async () => {
    const { state, cookie, setCookie } = await startGoogleSignIn(RETURN_TO);

    expect(setCookie, 'the start sets the cookie').not.toBeNull();
    const attrs = setCookie!.split(';').map((a) => a.trim());
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('SameSite=Lax');
    expect(attrs).toContain(`Path=${CALLBACK_PATH}`);
    // Host-only: no Domain, so no other host under the parent domain receives it.
    expect(attrs.some((a) => a.toLowerCase().startsWith('domain='))).toBe(false);
    const maxAge = Number(attrs.find((a) => a.startsWith('Max-Age='))!.slice('Max-Age='.length));
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(STATE_TTL_MS / 1000);
    // Local http dev cannot keep a Secure cookie.
    expect(attrs).not.toContain('Secure');

    const nonce = cookie!.slice(`${GOOGLE_STATE_COOKIE}=`.length);
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    const body = stateBody(state);
    expect(body.browser).toBe(await sha256Hex(nonce));
    // The state travels through Google and the address bar; the cookie's value never does.
    expect(state).not.toContain(nonce);
  });

  it('marks the cookie Secure outside development', async () => {
    (env as unknown as Record<string, string>).APP_ENV = 'dev';
    const { setCookie } = await startGoogleSignIn(RETURN_TO);
    expect(setCookie!.split(';').map((a) => a.trim())).toContain('Secure');
  });

  it('gives each start its own cookie', async () => {
    const first = await startGoogleSignIn(RETURN_TO);
    const second = await startGoogleSignIn(RETURN_TO);
    expect(first.cookie).not.toBe(second.cookie);
    expect(stateBody(first.state).browser).not.toBe(stateBody(second.state).browser);
  });
});

describe('the callback in the browser that started the sign-in', () => {
  it('signs in, as before', async () => {
    const res = await googleSignInFromStart(RETURN_TO);

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(RETURN_TO);
    const session = sessionFrom(res);
    expect(session, 'a session cookie').not.toBeNull();
    expect(await (await me(session!)).json()).toMatchObject({
      email: ADDRESS,
      auth_provider: 'google',
    });
    expect(await rowsWritten()).toEqual({ users: 1, sessions: 1 });
    expect(googleCalls).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://www.googleapis.com/oauth2/v3/tokeninfo',
    ]);
    // The new account's welcome mail, which shows the mail check below can see a mail.
    expect(mailsSent()).toBe(1);
  });
});

describe('the callback without the cookie of the start that made its state', () => {
  const cases = [
    { name: 'no cookie', cookieFor: async () => null },
    {
      name: 'the cookie of another start',
      cookieFor: async () => (await startGoogleSignIn(RETURN_TO)).cookie,
    },
    {
      name: 'a cookie of the right shape',
      cookieFor: async () => `${GOOGLE_STATE_COOKIE}=${'A'.repeat(43)}`,
    },
    { name: 'an empty cookie', cookieFor: async () => `${GOOGLE_STATE_COOKIE}=` },
  ];

  it.each(cases)(
    'with $name: signs nothing in, creates no account and sends the browser back',
    async ({ cookieFor }) => {
      const { state } = await startGoogleSignIn(RETURN_TO);
      const cookie = await cookieFor();

      const res = await googleCallback(state, cookie);

      expect(res.status).toBe(302);
      // Back to the app, signed out, which shows sign-in. Nothing in the address names why.
      expect(res.headers.get('Location')).toBe(RETURN_TO);
      expect(sessionFrom(res)).toBeNull();
      expect(res.headers.getSetCookie().some((l) => l.startsWith('fm_2fa='))).toBe(false);
      expect(await rowsWritten()).toEqual({ users: 0, sessions: 0 });
      expect(googleCalls, 'Google is never asked for the account').toEqual([]);
      expect(mailsSent()).toBe(0);
      expect(clearing(res), 'the cookie is cleared').toBeDefined();
    }
  );

  it('leaves an existing account at that address as it was', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const before = await accountRow(UID);
    const rowsBefore = await accessRows(UID);
    const { state } = await startGoogleSignIn(RETURN_TO);
    const other = await startGoogleSignIn(RETURN_TO);

    const res = await googleCallback(state, other.cookie);

    expect(res.status).toBe(302);
    expect(sessionFrom(res)).toBeNull();
    expect(await accountRow(UID)).toEqual(before);
    expect(await accessRows(UID)).toEqual(rowsBefore);
    expect(googleCalls).toEqual([]);
  });
});

describe('the cookie is cleared whatever the callback answers', () => {
  it('when the sign-in succeeds', async () => {
    const res = await googleSignInFromStart(RETURN_TO);
    expect(sessionFrom(res)).not.toBeNull();
    const line = clearing(res);
    expect(line).toBeDefined();
    // Cleared at the Path it was set on, or the browser keeps the original.
    expect(line).toContain(`Path=${CALLBACK_PATH}`);
  });

  it('when the code is missing', async () => {
    const { state, cookie } = await startGoogleSignIn(RETURN_TO);
    const res = await googleCallback(state, cookie, null);
    expect(res.status).toBe(400);
    expect(clearing(res)).toBeDefined();
  });

  it('when the state is not one the Worker signed', async () => {
    const { state, cookie } = await startGoogleSignIn(RETURN_TO);
    const res = await googleCallback(`${state.split('.')[0]}.not-a-signature`, cookie);
    expect(res.status).toBe(400);
    expect(sessionFrom(res)).toBeNull();
    expect(clearing(res)).toBeDefined();
  });

  it("when Google's code exchange is refused", async () => {
    globalThis.fetch = (async () => new Response('no', { status: 400 })) as typeof fetch;
    const { state, cookie } = await startGoogleSignIn(RETURN_TO);
    const res = await googleCallback(state, cookie);
    expect(res.status).toBe(401);
    expect(clearing(res)).toBeDefined();
  });

  it('when the callback fails part way', async () => {
    tokeninfo = () => {
      throw new Error('tokeninfo unreachable');
    };
    const { state, cookie } = await startGoogleSignIn(RETURN_TO);
    const res = await googleCallback(state, cookie);
    expect(res.status).toBe(500);
    expect(sessionFrom(res)).toBeNull();
    expect(clearing(res)).toBeDefined();
  });
});

describe('a state older than ten minutes', () => {
  /** A state for this browser's cookie, signed `ageMs` ago. */
  async function signedAgo(ageMs: number) {
    const nonce = 'n'.repeat(43);
    const state = await signState(
      { returnTo: RETURN_TO, ts: Date.now() - ageMs, browser: await sha256Hex(nonce) },
      env.JWT_SECRET!
    );
    return googleCallback(state, `${GOOGLE_STATE_COOKIE}=${nonce}`);
  }

  it('is refused, even with its cookie', async () => {
    const res = await signedAgo(STATE_TTL_MS + 1000);
    expect(res.status).toBe(400);
    expect(sessionFrom(res)).toBeNull();
    expect(await rowsWritten()).toEqual({ users: 0, sessions: 0 });
    expect(googleCalls).toEqual([]);
    expect(clearing(res)).toBeDefined();
  });

  it('while one a minute younger than that still signs in', async () => {
    const res = await signedAgo(STATE_TTL_MS - 60_000);
    expect(res.status).toBe(302);
    expect(sessionFrom(res)).not.toBeNull();
  });
});

describe('isAllowedReturnTo and the local app', () => {
  const at = (APP_ENV: string | undefined, origins: Partial<Env> = {}) =>
    ({ APP_ENV, CORS_ORIGIN: 'https://app.example.com', ...origins }) as unknown as Env;

  it.each(['http://localhost:3800', 'http://127.0.0.1:3800/'])(
    'takes %s in development',
    (returnTo) => {
      expect(isAllowedReturnTo(returnTo, at('development'))).toBe(true);
    }
  );

  it.each([['dev'], ['production'], [undefined]])(
    'takes no local address when APP_ENV is %s',
    (appEnv) => {
      expect(isAllowedReturnTo('http://localhost:3800', at(appEnv))).toBe(false);
      expect(isAllowedReturnTo('http://127.0.0.1:3800', at(appEnv))).toBe(false);
      // The environment's own app still is.
      expect(isAllowedReturnTo('https://app.example.com/', at(appEnv))).toBe(true);
    }
  );

  it('takes the app origins an environment names', () => {
    const env = at('production', {
      APP_ORIGINS: 'https://one.example.com, https://two.example.com',
    });
    expect(isAllowedReturnTo('https://two.example.com/x', env)).toBe(true);
    expect(isAllowedReturnTo('https://three.example.com', env)).toBe(false);
  });
});
