/**
 * Signing in with a wrong password, asking for a reset link, asking for a sign-in code and
 * creating an account answer with the same status, content type and body for an address that has
 * an account and for one that has none, and so does each route's limit on one address once it is
 * reached. The cookie a sign-in code request sets is a new random handle on every request.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { b64urlDecode, hashPassword } from '../src/auth';

const BASE = 'https://api.example.com';
const HAS_ACCOUNT = 'same-answer-account@example.com';
const NO_ACCOUNT = 'same-answer-nobody@example.com';

let ip = 0;

/** Each request from its own address, so only the limit on one email address can be reached. */
async function answer(path: string, body: unknown) {
  ip += 1;
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.88.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    body: await res.text(),
  };
}

const ROUTES: { path: string; body: (email: string) => unknown; status: number; limit: number }[] =
  [
    {
      path: '/api/auth/login',
      body: (email) => ({ email, password: 'not-the-password' }),
      status: 401,
      limit: 10,
    },
    { path: '/api/auth/forgot-password', body: (email) => ({ email }), status: 200, limit: 3 },
    { path: '/api/auth/email-code/request', body: (email) => ({ email }), status: 200, limit: 3 },
    {
      path: '/api/auth/register',
      body: (email) => ({ email, password: 'a-new-password' }),
      status: 200,
      limit: 3,
    },
  ];

beforeEach(async () => {
  for (const t of ['login_codes', 'password_resets', 'rate_limits', 'email_verifications']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  const theirs = 'SELECT id FROM users WHERE email IN (?, ?)';
  await env.DB.prepare(`DELETE FROM profiles WHERE user_id IN (${theirs})`)
    .bind(HAS_ACCOUNT, NO_ACCOUNT)
    .run();
  await env.DB.prepare('DELETE FROM users WHERE email IN (?, ?)')
    .bind(HAS_ACCOUNT, NO_ACCOUNT)
    .run();
  await env.DB.prepare(
    "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
  )
    .bind(HAS_ACCOUNT, await hashPassword('the-password'))
    .run();
});

describe('an address with an account and one without', () => {
  for (const route of ROUTES) {
    it(`get the same status, content type and body from ${route.path}`, async () => {
      const withAccount = await answer(route.path, route.body(HAS_ACCOUNT));
      const without = await answer(route.path, route.body(NO_ACCOUNT));
      expect(withAccount.status).toBe(route.status);
      expect(without).toEqual(withAccount);
    });

    it(`get the same status, content type and body from ${route.path} once its limit on the address is reached`, async () => {
      const last = async (email: string) => {
        for (let i = 0; i < route.limit; i += 1) await answer(route.path, route.body(email));
        return answer(route.path, route.body(email));
      };
      const withAccount = await last(HAS_ACCOUNT);
      const without = await last(NO_ACCOUNT);
      expect(withAccount.status).toBe(429);
      // The wait is counted from each address's first attempt, a second or so apart.
      const anyWait = (said: string) => said.replace(/\d+/g, 'N');
      expect({ ...without, body: anyWait(without.body) }).toEqual({
        ...withAccount,
        body: anyWait(withAccount.body),
      });
    });
  }
});

/** The cookie a sign-in code request for `email` sets: its whole Set-Cookie line, and its value. */
async function codeRequestCookie(email: string): Promise<{ line: string; value: string }> {
  ip += 1;
  const res = await SELF.fetch(`${BASE}/api/auth/email-code/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.88.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(200);
  const line = res.headers.getSetCookie().find((c) => c.startsWith('fm_logincode='));
  expect(line, 'a fm_logincode cookie').toBeDefined();
  return { line: line!, value: line!.slice('fm_logincode='.length).split(';')[0]! };
}

describe('the cookie a sign-in code request sets', () => {
  it('is a random handle of 32 bytes in base64url, with the same attributes on every request', async () => {
    const cookies = [await codeRequestCookie(HAS_ACCOUNT), await codeRequestCookie(NO_ACCOUNT)];
    for (const { value } of cookies) {
      expect(value).toMatch(/^[\w-]{43}$/);
      expect(b64urlDecode(value)).toHaveLength(32);
    }
    // Each line with its value taken out: the attributes set around it.
    const attributes = cookies.map(({ line, value }) => line.replace(value, 'V'));
    expect(new Set(attributes).size, attributes.join('\n')).toBe(1);
  });

  it('is a new handle on every request', async () => {
    const values = [
      (await codeRequestCookie(HAS_ACCOUNT)).value,
      (await codeRequestCookie(HAS_ACCOUNT)).value,
      (await codeRequestCookie(NO_ACCOUNT)).value,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});
