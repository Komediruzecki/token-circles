/**
 * The sign-in, password and support routes name the field they refuse, in the words the forms use
 * (shared/signInSchema.ts), so a form can say it under that field. What each route accepts is the
 * same as before: the rules moved, they did not change.
 *
 * A wrong address or password is the exception, on purpose. It names no field: the form says it
 * once, for the whole form.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';
import { SIGN_IN_MESSAGES as SAY } from '../../shared/signInSchema';

const BASE = 'https://api.example.com';
const EMAIL = 'refusals@example.com';
const PASSWORD = 'the-right-password';

let ip = 0;

/** Each request from its own address, so no per-IP limit is reached by the tests themselves. */
function post(path: string, body: unknown): Promise<Response> {
  ip += 1;
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.77.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify(body),
  });
}

async function answer(res: Response) {
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  for (const t of ['login_codes', 'password_resets', 'rate_limits', 'auth_sessions', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(EMAIL).run();
  await env.DB.prepare(
    "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
  )
    .bind(EMAIL, await hashPassword(PASSWORD))
    .run();
});

describe('creating an account', () => {
  it('names the address that is not one', async () => {
    expect(
      await answer(await post('/api/auth/register', { email: 'name@example', password: PASSWORD }))
    ).toEqual({
      status: 400,
      body: { error: SAY.emailFormat, fields: { email: SAY.emailFormat } },
    });
  });

  it('names a password shorter than 8 characters', async () => {
    expect(
      await answer(await post('/api/auth/register', { email: EMAIL, password: 'short' }))
    ).toEqual({
      status: 400,
      body: { error: SAY.newPassword, fields: { password: SAY.newPassword } },
    });
  });

  it('names both, in the order of the form', async () => {
    expect(await answer(await post('/api/auth/register', {}))).toEqual({
      status: 400,
      body: {
        error: `${SAY.email} ${SAY.newPassword}`,
        fields: { email: SAY.email, password: SAY.newPassword },
      },
    });
  });
});

describe('signing in with a password', () => {
  it('names a field left empty', async () => {
    expect(await answer(await post('/api/auth/login', { email: ' ', password: '' }))).toEqual({
      status: 400,
      body: {
        error: `${SAY.email} ${SAY.password}`,
        fields: { email: SAY.email, password: SAY.password },
      },
    });
  });

  it('takes an address in any format, as it always has', async () => {
    const res = await post('/api/auth/login', { email: 'no-at-sign', password: PASSWORD });
    expect(await answer(res)).toEqual({
      status: 401,
      body: { error: 'Invalid email or password' },
    });
  });

  it('names no field for a wrong password', async () => {
    const res = await post('/api/auth/login', { email: EMAIL, password: 'a-wrong-password' });
    expect(await answer(res)).toEqual({
      status: 401,
      body: { error: 'Invalid email or password' },
    });
  });
});

describe('asking for a reset link or a sign-in code', () => {
  for (const path of ['/api/auth/forgot-password', '/api/auth/email-code/request']) {
    it(`${path} names the address that is not one`, async () => {
      expect(await answer(await post(path, { email: 'name example.com' }))).toEqual({
        status: 400,
        body: { error: SAY.emailFormat, fields: { email: SAY.emailFormat } },
      });
    });
  }
});

describe('trading a sign-in code', () => {
  it('names a code left empty', async () => {
    expect(
      await answer(await post('/api/auth/email-code/verify', { email: EMAIL, code: '  ' }))
    ).toEqual({
      status: 400,
      body: { error: SAY.emailCode, fields: { code: SAY.emailCode } },
    });
  });

  it('names the code it does not take', async () => {
    expect(
      await answer(await post('/api/auth/email-code/verify', { email: EMAIL, code: '000000' }))
    ).toEqual({
      status: 401,
      body: { error: SAY.emailCodeRefused, fields: { code: SAY.emailCodeRefused } },
    });
  });
});

describe('setting a password from a reset link', () => {
  it('names a password shorter than 8 characters', async () => {
    expect(
      await answer(await post('/api/auth/reset-password', { token: 'a-token', password: 'short' }))
    ).toEqual({
      status: 400,
      body: { error: SAY.newPassword, fields: { password: SAY.newPassword } },
    });
  });

  it('names no field when the link is missing', async () => {
    expect(
      await answer(await post('/api/auth/reset-password', { password: 'long-enough-password' }))
    ).toEqual({ status: 400, body: { error: 'Missing reset token' } });
  });
});

describe('writing to support', () => {
  it('names the reply address and the message', async () => {
    expect(
      await answer(await post('/api/support/contact', { email: 'me@', message: 'hi' }))
    ).toEqual({
      status: 400,
      body: {
        error: `${SAY.emailFormat} ${SAY.supportMessage}`,
        fields: { email: SAY.emailFormat, message: SAY.supportMessage },
      },
    });
  });

  it('names a message longer than 5,000 characters', async () => {
    const res = await post('/api/support/contact', { email: EMAIL, message: 'x'.repeat(5001) });
    expect(await answer(res)).toEqual({
      status: 400,
      body: { error: SAY.supportMessageLength, fields: { message: SAY.supportMessageLength } },
    });
  });
});
