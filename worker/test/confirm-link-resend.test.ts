/**
 * Sending the confirm link again while signed out (POST /api/auth/verify-email/resend): from
 * Check your inbox after signing up, and from the sign-in form after a refused password.
 *
 * It answers every address the same: one with no account, a confirmed one, a Google account's and
 * one waiting for its link, and so do its limits once they are reached. It mails only the account
 * waiting for its link, after the answer. Its limits and captcha come before anything that looks
 * at the address.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import { fetchSettled, fetchUnsettled } from './helpers/after-answer';
import { dbThatNotes, dbWithStep, realDb, withDb } from './helpers/racing-db';

const BASE = 'https://api.example.com';
const RESEND = `${BASE}/api/auth/verify-email/resend`;
const WAITING = 'resend-waiting@example.com';
const CONFIRMED = 'resend-confirmed@example.com';
const GOOGLE = 'resend-google@example.com';
const NOBODY = 'resend-nobody@example.com';
const EVERY_ADDRESS = [NOBODY, CONFIRMED, GOOGLE, WAITING];
const APP = 'http://localhost:3800';

let ip = 0;

/** A request from its own network address, unless `from` names one. */
function sending(email: string, from?: string): RequestInit {
  ip += 1;
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': from ?? `10.99.${ip >> 8}.${ip & 255}`,
    },
    body: JSON.stringify({ email }),
  };
}

/** Every header of an answer but Date, sorted, with its status and body. */
async function read(res: Response) {
  const headers: string[] = [];
  res.headers.forEach((value, name) => {
    if (name !== 'date') headers.push(`${name}: ${value}`);
  });
  return { status: res.status, headers: headers.sort(), body: await res.text() };
}

type Answer = Awaited<ReturnType<typeof read>>;

const ask = async (email: string, from?: string) =>
  read(await fetchSettled(RESEND, sending(email, from)));

const realFetch = globalThis.fetch;
let mailed: Array<{ to: string; text: string }> = [];

const mine = `SELECT id FROM users WHERE email IN (${EVERY_ADDRESS.map(() => '?').join(', ')})`;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limits').run();
  await env.DB.prepare(`DELETE FROM email_verifications WHERE user_id IN (${mine})`)
    .bind(...EVERY_ADDRESS)
    .run();
  await env.DB.prepare(`DELETE FROM users WHERE id IN (${mine})`)
    .bind(...EVERY_ADDRESS)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, 'pbkdf2$100000$x$y', 0, 'password')"
    ).bind(WAITING),
    env.DB.prepare(
      "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, 'pbkdf2$100000$x$y', 1, 'password')"
    ).bind(CONFIRMED),
    env.DB.prepare(
      "INSERT INTO users (email, email_verified, auth_provider, provider_id) VALUES (?, 1, 'google', 'google-sub-resend')"
    ).bind(GOOGLE),
  ]);
  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  mailed = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      mailed.push(JSON.parse(String(init?.body ?? '{}')) as { to: string; text: string });
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
});

async function unusedLinks(email: string) {
  return (
    await env.DB.prepare(
      `SELECT token_hash FROM email_verifications
        WHERE user_id = (SELECT id FROM users WHERE email = ?) AND used_at IS NULL`
    )
      .bind(email)
      .all<{ token_hash: string }>()
  ).results;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('POST /api/auth/verify-email/resend', () => {
  it("answers the same status, headers and body for an address with no account, a confirmed one, a Google account's and one waiting for its link", async () => {
    const answers = [];
    for (const email of EVERY_ADDRESS) answers.push(await ask(email));

    expect(answers[0]).toMatchObject({ status: 200, body: '{"ok":true}' });
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it('mails a fresh link to the account waiting for its link, and to no other address', async () => {
    for (const email of EVERY_ADDRESS) await ask(email);

    expect(mailed.map((m) => m.to)).toEqual([WAITING]);
    expect(await unusedLinks(WAITING)).toHaveLength(1);
    for (const email of [CONFIRMED, GOOGLE]) expect(await unusedLinks(email)).toEqual([]);
  });

  it('retires the link the account had, and the fresh one waits to be opened', async () => {
    const before = 'resend-before-token';
    await env.DB.prepare(
      "INSERT INTO email_verifications (user_id, email, token_hash, expires_at) SELECT id, email, ?, datetime('now', '+1 day') FROM users WHERE email = ?"
    )
      .bind(await sha256(before), WAITING)
      .run();

    await ask(WAITING);

    const open = (token: string) =>
      fetchSettled(`${BASE}/api/auth/verify-email?token=${token}`, { redirect: 'manual' });
    expect((await open(before)).headers.get('Location')).toBe(
      `${APP}/#everified_error=invalid_or_used`
    );
    const fresh = /verify-email\?token=([0-9a-f]+)/.exec(mailed[0]!.text)![1]!;
    expect((await open(fresh)).headers.get('Location')).toBe(
      `${APP}/#everified_error=signin_required`
    );
  });

  it('counts against a limit of three an hour on the address, answered the same for every address', async () => {
    const last = async (email: string) => {
      for (let i = 0; i < 3; i += 1) await ask(email);
      return ask(email);
    };

    const waiting = await last(WAITING);
    const nobody = await last(NOBODY);

    expect(waiting.status).toBe(429);
    // The wait is counted from each address's first ask, a moment apart.
    const anyWait = (one: Answer) => ({
      ...one,
      headers: one.headers.map((h) => h.replace(/\d+/g, 'N')),
      body: one.body.replace(/\d+/g, 'N'),
    });
    expect(anyWait(nobody)).toEqual(anyWait(waiting));
    expect(mailed.map((m) => m.to)).toEqual([WAITING, WAITING, WAITING]);
  });

  it('counts against a limit of five every fifteen minutes from one network address', async () => {
    const from = '10.99.250.1';
    const statuses = [];
    for (let i = 0; i < 6; i += 1)
      statuses.push((await ask(`resend-${i}@example.com`, from)).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('refuses something that is not an address, at the field', async () => {
    const answer = await ask('not-an-address');

    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body)).toMatchObject({ fields: { email: expect.any(String) } });
  });

  it('asks for the captcha before anything looks at the address', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('challenges.cloudflare.com')) {
        return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
      }
      throw new Error(`Unexpected fetch in a test: ${url}`);
    });
    const noting = dbThatNotes(realDb);
    const ctx = createExecutionContext();
    const withCaptcha = {
      ...(env as unknown as Env),
      DB: noting.db,
      TURNSTILE_SECRET: 'test-secret',
      APP_ENV: 'production',
    } as Env;

    const res = await worker.fetch(
      new Request(RESEND, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.99.251.1' },
        body: JSON.stringify({ email: WAITING, turnstileToken: 'refused' }),
      }),
      withCaptcha,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(403);
    expect(noting.statements.filter((sql) => /FROM users/.test(sql))).toEqual([]);
    expect(mailed).toEqual([]);
  });

  it('answers first, and ok, while the look-up of the address is held, and mails the link once it goes on', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = dbWithStep(realDb, /FROM users WHERE email = \?/, () => held);

    await withDb(holding.db, async () => {
      const sent = fetchUnsettled(RESEND, sending(WAITING));
      try {
        const answered = await Promise.race([
          sent.answer.then(read),
          new Promise<'no answer'>((resolve) => setTimeout(() => resolve('no answer'), 5_000)),
        ]);
        expect(answered, 'the answer, while the look-up is held').toMatchObject({
          status: 200,
          body: '{"ok":true}',
        });
        expect(mailed).toEqual([]);
      } finally {
        release();
        await sent.settled();
      }
    });

    expect(holding.ran()).toBe(true);
    expect(mailed.map((m) => m.to)).toEqual([WAITING]);
  });

  it('answers ok while the mail cannot be sent, and the failure is in the log', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('api.resend.com')) throw new TypeError('the mail service cannot be reached');
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await ask(WAITING)).toMatchObject({ status: 200, body: '{"ok":true}' });
    expect(errors).toHaveBeenCalledWith(
      'Confirm link could not be sent again:',
      expect.any(TypeError)
    );
  });
});
