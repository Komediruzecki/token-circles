/**
 * The work a sign-up does after its answer (POST /api/auth/register): the account it makes, the
 * mail it sends, and what is left when that work fails. The answer, the same for every address,
 * is compared in sign-in-same-answer.test.ts.
 *
 * Finding or making the account runs a second time when the first try fails, and the account,
 * its profile and its first confirm link are written together or not at all, so the second try
 * starts from nothing. Signing up again with the address of an account waiting for its confirm
 * link mails that account a fresh link.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth';
import { fetchSettled } from './helpers/after-answer';
import { dbThatRefuses, realDb, withDb } from './helpers/racing-db';

const BASE = 'https://api.example.com';
/** An address with no account before the test signs it up. */
const NEW = 'sign-up-new@example.com';
/** A password account waiting for its confirm link, with the password FIRST_PASSWORD. */
const WAITING = 'sign-up-waiting@example.com';
/** A password account whose address is confirmed. */
const CONFIRMED = 'sign-up-confirmed@example.com';
const EVERY_ADDRESS = [NEW, WAITING, CONFIRMED];
const FIRST_PASSWORD = 'the-password-it-signed-up-with';

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
  const hash = await hashPassword(FIRST_PASSWORD);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 0, 'password')"
    ).bind(WAITING, hash),
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, ?, 1, 'password')"
    ).bind(CONFIRMED, hash),
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
  await env.DB.prepare('DROP TRIGGER IF EXISTS refuse_links').run();
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

describe('a sign-up whose confirm link cannot be stored', () => {
  it('leaves no account behind, and mails nothing', async () => {
    await env.DB.prepare(
      `CREATE TRIGGER refuse_links BEFORE INSERT ON email_verifications
       BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`
    ).run();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await signUp(NEW);

    expect(res.status).toBe(200);
    expect(await accountAt(NEW)).toBeNull();
    expect(mailed).toEqual([]);
  });
});

describe('the welcome of a new account', () => {
  it('carries the confirm link stored with the account, and goes to its address alone', async () => {
    await signUp(NEW);

    expect(mailed.map((mail) => mail.to)).toEqual([NEW]);
    const token = /verify-email\?token=([0-9a-f]+)/.exec(mailed[0]!.text)?.[1];
    expect(token, mailed[0]!.text).toBeDefined();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
      ''
    );
    const stored = await realDb
      .prepare(
        `SELECT v.email, v.purpose, v.used_at FROM email_verifications v
           JOIN users u ON u.id = v.user_id WHERE u.email = ? AND v.token_hash = ?`
      )
      .bind(NEW, hash)
      .first();
    expect(stored).toEqual({ email: NEW, purpose: 'confirm', used_at: null });
  });
});

/** The unused confirm links of the account at `email`, by token hash. */
async function unusedLinks(email: string): Promise<string[]> {
  const { results } = await realDb
    .prepare(
      `SELECT v.token_hash FROM email_verifications v JOIN users u ON u.id = v.user_id
        WHERE u.email = ? AND v.used_at IS NULL`
    )
    .bind(email)
    .all<{ token_hash: string }>();
  return results.map((row) => row.token_hash);
}

/** Every header of an answer but Date, sorted, with its status and body. */
async function read(res: Response) {
  const headers: string[] = [];
  res.headers.forEach((value, name) => {
    if (name !== 'date') headers.push(`${name}: ${value}`);
  });
  return { status: res.status, headers: headers.sort(), body: await res.text() };
}

describe('signing up again with the address of an account waiting for its confirm link', () => {
  it('mails that account a fresh confirm link, not the notice that someone tried', async () => {
    await signUp(WAITING, 'another-new-password');

    expect(mailed.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: WAITING, subject: 'Confirm your Token Circles email address' },
    ]);
    expect(mailed[0]!.text).toMatch(/\/api\/auth\/verify-email\?token=[0-9a-f]+/);
  });

  it('retires the link the account had, and keeps the password it signed up with', async () => {
    await signUp(WAITING);
    const before = await unusedLinks(WAITING);
    mailed = [];

    await signUp(WAITING, 'another-new-password');

    const after = await unusedLinks(WAITING);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(before);
    const stored = await realDb
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .bind(WAITING)
      .first<{ password_hash: string }>();
    expect(await verifyPassword(FIRST_PASSWORD, stored!.password_hash)).toBe(true);
  });

  it('is answered as an address with no account and a confirmed one are', async () => {
    const answers = [];
    for (const email of [NEW, CONFIRMED, WAITING]) answers.push(await read(await signUp(email)));

    expect(answers[0]!.status).toBe(200);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });
});

describe('signing up again with the address of a confirmed account', () => {
  it('mails the notice that someone tried, and no link', async () => {
    await signUp(CONFIRMED);

    expect(mailed.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: CONFIRMED, subject: 'You already have a Token Circles account' },
    ]);
    expect(await unusedLinks(CONFIRMED)).toEqual([]);
  });
});
