/**
 * The work a sign-up does after its answer (POST /api/auth/register): the account it makes, the
 * mail it sends, and what is left when that work fails. The answer, the same for every address,
 * is compared in sign-in-same-answer.test.ts.
 *
 * Finding or making the account runs a second time when the first try fails, and the account and
 * its profile are written together or not at all, so the second try starts from nothing.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSettled } from './helpers/after-answer';
import { dbThatRefuses, realDb, withDb } from './helpers/racing-db';

const BASE = 'https://api.example.com';
/** An address with no account before the test signs it up. */
const NEW = 'sign-up-new@example.com';
const EVERY_ADDRESS = [NEW];

let ip = 0;

/** Sign up with `email` from a network address of its own, and wait for the work after the answer. */
function signUp(email: string, password = 'a-new-password'): Promise<Response> {
  ip += 1;
  return fetchSettled(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.66.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify({ email, password }),
  });
}

const realFetch = globalThis.fetch;
/** The mails the Worker sent, in the order the mail service took them. */
let mailed: Array<{ to: string; subject: string; text: string }> = [];

const mine = `SELECT id FROM users WHERE email IN (${EVERY_ADDRESS.map(() => '?').join(', ')})`;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limits').run();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM email_verifications WHERE user_id IN (${mine})`).bind(
      ...EVERY_ADDRESS
    ),
    env.DB.prepare(`DELETE FROM profiles WHERE user_id IN (${mine})`).bind(...EVERY_ADDRESS),
    env.DB.prepare(`DELETE FROM users WHERE id IN (${mine})`).bind(...EVERY_ADDRESS),
  ]);
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      mailed.push(JSON.parse(String(init?.body ?? '{}')) as (typeof mailed)[number]);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await env.DB.prepare('DROP TRIGGER IF EXISTS refuse_profiles').run();
});

/** The account at `email`, with how many profiles it has; null when there is none. */
function accountAt(email: string) {
  return realDb
    .prepare(
      `SELECT u.email_verified, (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles
         FROM users u WHERE u.email = ?`
    )
    .bind(email)
    .first<{ email_verified: number; profiles: number }>();
}

describe('a sign-up whose account work fails the first time', () => {
  it('makes the account and its profile on the second try, and mails the welcome once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusing = dbThatRefuses(realDb, /INSERT INTO users/, 1);

    const res = await withDb(refusing.db, () => signUp(NEW));

    expect(res.status).toBe(200);
    expect(refusing.refused()).toBe(1);
    expect(await accountAt(NEW)).toEqual({ email_verified: 0, profiles: 1 });
    expect(mailed.map((mail) => mail.to)).toEqual([NEW]);
    expect(errors).not.toHaveBeenCalledWith(
      'Sign-up could not make the account:',
      expect.anything()
    );
  });
});

describe('a sign-up whose account work fails twice', () => {
  it('leaves no account, mails nothing, and logs the second failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refusing = dbThatRefuses(realDb, /INSERT INTO users/, 2);

    const res = await withDb(refusing.db, () => signUp(NEW));

    expect(res.status).toBe(200);
    expect(refusing.refused()).toBe(2);
    expect(await accountAt(NEW)).toBeNull();
    expect(mailed).toEqual([]);
    const logged = errors.mock.calls.filter(
      ([line]) => line === 'Sign-up could not make the account:'
    );
    expect(logged.map(([, error]) => (error as Error).message)).toEqual([
      'refused for the test (2)',
    ]);
  });
});

describe('a sign-up whose profile cannot be written', () => {
  it('leaves no account behind either, and mails nothing', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER refuse_profiles BEFORE INSERT ON profiles
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`
    ).run();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await signUp(NEW);

    expect(res.status).toBe(200);
    expect(await accountAt(NEW)).toBeNull();
    expect(mailed).toEqual([]);
  });
});
