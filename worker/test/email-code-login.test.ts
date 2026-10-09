/**
 * Email-code sign-in: request a 6-digit code by mail, trade it for a session. Anti-enumeration
 * (the request endpoint answers identically for unknown addresses, cookie included), single-use,
 * 10-minute TTL — and the verify step is BOUND to the browser that requested it by the
 * ceremony cookie, so a code can only be guessed at by the party that triggered it: five wrong
 * attempts burn it. On a confirmed account the 2FA challenge still applies after the code; on one
 * whose address was never confirmed, the code first removes every way in that was set up before.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MINUTES,
  newCodeHandle,
} from '../src/login-codes';
import { b64urlEncode, hmacKey } from '../src/auth';
import { issueLoginCodeCookie } from '../src/routes/email-code';
import { currentStep, totpCode } from '../src/totp';
import { confirmTotp, enrollTotp } from '../src/twofa';
import { SIGN_IN_MESSAGES } from '../../shared/signInSchema';
import { fetchSettled } from './helpers/after-answer';
import {
  ACCESS_TABLES,
  accessRows,
  accountRow,
  callMcp,
  dataRows,
  me,
  removeAccounts,
  seedAccount,
  seededData,
  signIn,
  type AccessRows,
} from './helpers/account-access';

const BASE = 'https://api.example.com';
const EMAIL = 'codeuser@example.com';
/** A code that does not sign in, at the code field, as the form shows it. */
const CODE_REFUSED = {
  error: SIGN_IN_MESSAGES.emailCodeRefused,
  fields: { code: SIGN_IN_MESSAGES.emailCodeRefused },
};
/** An account with every kind of access set up on it (helpers/account-access.ts). */
const SEEDED = 6610;
const SEEDED_ADDRESS = 'household-code@example.com';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]!;
  }
  return null;
}

/** Each request comes back once the work its route does after the answer is done, too. */
async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return fetchSettled(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Mint a code at the store level and its matching ceremony cookie, as /request would. */
async function mintWithCookie(
  email = EMAIL,
  user = userId
): Promise<{ code: string; cookie: string; id: number }> {
  const handle = newCodeHandle();
  const { code, id } = await createLoginCode(env, user, email, handle);
  const cookie = issueLoginCodeCookie(env, handle).split(';')[0]!;
  return { code, cookie, id };
}

/** The login codes as they were, with code `id` spent the way checking it spends it. */
const withSpent = (codes: AccessRows['login_codes'], id: number) =>
  codes.map((row) => (row.id === id ? { ...row, used_at: expect.any(String) } : row));

let userId: number;

beforeEach(async () => {
  for (const t of [
    'login_codes',
    'recovery_codes',
    'totp_credentials',
    'auth_sessions',
    'rate_limits',
    'auth_logs',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  const res = await env.DB.prepare(
    "INSERT INTO users (email, password_hash, email_verified, auth_provider) VALUES (?, 'x', 0, 'password')"
  )
    .bind(EMAIL)
    .run();
  userId = res.meta.last_row_id as number;
});

afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_code_confirm').run();
  await removeAccounts(`SELECT ${SEEDED}`);
});

describe('requesting a code', () => {
  it('answers the same neutral ok — ceremony cookie included — for existing and unknown addresses', async () => {
    const known = await post('/api/auth/email-code/request', { email: EMAIL });
    const unknown = await post('/api/auth/email-code/request', { email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    // The cookie is part of the neutral surface: its absence would betray the unknown address.
    expect(cookieValue(known, 'fm_logincode')).toBeTruthy();
    expect(cookieValue(unknown, 'fm_logincode')).toBeTruthy();

    const rows = await env.DB.prepare('SELECT email FROM login_codes').all();
    expect(rows.results).toHaveLength(1); // only the real account got a code minted
  });

  it('sets as its cookie the handle whose SHA-256 hash the code row keeps', async () => {
    const res = await post('/api/auth/email-code/request', { email: EMAIL });
    const handle = cookieValue(res, 'fm_logincode')!.slice('fm_logincode='.length);
    const rows = await env.DB.prepare('SELECT handle_hash FROM login_codes WHERE email = ?')
      .bind(EMAIL)
      .all<{ handle_hash: string }>();
    expect(rows.results).toEqual([{ handle_hash: await sha256Hex(handle) }]);
  });

  it('stores only a hash, never the code', async () => {
    const { code } = await createLoginCode(env, userId, EMAIL, newCodeHandle());
    const row = await env.DB.prepare('SELECT code_hash FROM login_codes WHERE user_id = ?')
      .bind(userId)
      .first<{ code_hash: string }>();
    expect(code).toMatch(/^\d{6}$/);
    expect(row!.code_hash).not.toContain(code);
  });

  it('rate limits repeated requests for one address', async () => {
    let last = 0;
    for (let i = 0; i < 5; i++) {
      last = (await post('/api/auth/email-code/request', { email: EMAIL })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('a newer request does not kill the code already in flight', async () => {
    // The old delete-previous behavior let anyone invalidate the code a user was busy typing,
    // just by firing /request for their address.
    const first = await mintWithCookie();
    await createLoginCode(env, userId, EMAIL, newCodeHandle());
    const res = await post(
      '/api/auth/email-code/verify',
      { email: EMAIL, code: first.code },
      first.cookie
    );
    expect(res.status).toBe(200);
  });

  it('keeps at most three live codes per user', async () => {
    for (let i = 0; i < 5; i++) await createLoginCode(env, userId, EMAIL, newCodeHandle());
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM login_codes WHERE user_id = ? AND used_at IS NULL'
    )
      .bind(userId)
      .first<{ n: number }>();
    expect(row?.n).toBe(3);
  });
});

describe('verifying a code', () => {
  it('a valid code with its ceremony cookie signs in: session, me works, provider recorded', async () => {
    const { code, cookie } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    expect(res.status).toBe(200);
    const session = cookieValue(res, 'fm_session');
    expect(session).toBeTruthy();

    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: session! } });
    expect(me.status).toBe(200);
    const row = await env.DB.prepare('SELECT provider FROM auth_sessions WHERE user_id = ?')
      .bind(userId)
      .first<{ provider: string }>();
    expect(row?.provider).toBe('email');
  });

  it('the right code without the ceremony cookie is refused', async () => {
    // The cookie binds verification to the browser that asked. Without it, a third party who
    // triggered a code for someone else's address has no surface to guess against at all.
    const { code } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code });
    expect(res.status).toBe(401);
    expect(cookieValue(res, 'fm_session')).toBeNull();
    // The same answer as a wrong code: at the code field.
    expect(await res.json()).toEqual(CODE_REFUSED);
  });

  it('says the password was cleared on an unconfirmed account that had nothing else', async () => {
    const { code, cookie } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    expect(await res.json()).toEqual({ id: userId, email: EMAIL, cleared: true });
  });

  it('says nothing was cleared on a confirmed account', async () => {
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
    const { code, cookie } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    expect(await res.json()).toEqual({ id: userId, email: EMAIL });
  });

  it('proving inbox control marks the address verified', async () => {
    const { code, cookie } = await mintWithCookie();
    await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    const row = await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email_verified: number }>();
    expect(row?.email_verified).toBe(1);
  });

  it('rejects a wrong code with a neutral message', async () => {
    const { cookie } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code: '000000' }, cookie);
    expect(res.status).toBe(401);
    expect(cookieValue(res, 'fm_session')).toBeNull();
    expect(await res.json()).toEqual(CODE_REFUSED);
  });

  it('refuses a cookie in the signed form it had before, as it refuses an expired code', async () => {
    // A cookie as a code request set it before this change, for a code that is still live.
    const signedForm = async (id: number) => {
      const payload = b64urlEncode(
        new TextEncoder().encode(
          JSON.stringify({ codeId: id, email: EMAIL, exp: Math.floor(Date.now() / 1000) + 600 })
        )
      );
      const mac = await crypto.subtle.sign(
        'HMAC',
        await hmacKey(env.JWT_SECRET),
        new TextEncoder().encode(payload)
      );
      return `fm_logincode=${payload}.${b64urlEncode(mac)}`;
    };
    const minted = await mintWithCookie();
    const earlier = await post(
      '/api/auth/email-code/verify',
      { email: EMAIL, code: minted.code },
      await signedForm(minted.id)
    );
    await env.DB.prepare("UPDATE login_codes SET expires_at = datetime('now', '-1 minute')").run();
    const expired = await post(
      '/api/auth/email-code/verify',
      { email: EMAIL, code: minted.code },
      minted.cookie
    );

    expect(earlier.status).toBe(401);
    expect(cookieValue(earlier, 'fm_session')).toBeNull();
    expect({ status: earlier.status, body: await earlier.json() }).toEqual({
      status: expired.status,
      body: await expired.json(),
    });
  });

  it('rejects an expired code', async () => {
    const { code, cookie } = await mintWithCookie();
    await env.DB.prepare("UPDATE login_codes SET expires_at = datetime('now', '-1 minute')").run();
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie)).status).toBe(
      401
    );
    expect(LOGIN_CODE_TTL_MINUTES).toBe(10);
  });

  it('a code works exactly once', async () => {
    const { code, cookie } = await mintWithCookie();
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie)).status).toBe(
      200
    );
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie)).status).toBe(
      401
    );
  });

  it('five wrong guesses burn the code — the right one no longer works', async () => {
    const { code, cookie } = await mintWithCookie();
    for (let i = 0; i < LOGIN_CODE_MAX_ATTEMPTS; i++) {
      const res = await post(
        '/api/auth/email-code/verify',
        { email: EMAIL, code: '000000' },
        cookie
      );
      expect(res.status).toBe(401);
    }
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    expect(res.status).toBe(401);
  });

  it('rate limits verify attempts per IP', async () => {
    const { cookie } = await mintWithCookie();
    let last = 0;
    for (let i = 0; i < 32; i++) {
      last = (await post('/api/auth/email-code/verify', { email: EMAIL, code: '111111' }, cookie))
        .status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('two codes asked for from two browsers, on a confirmed account', () => {
  const realFetch = globalThis.fetch;
  /** The codes the Worker mailed, in the order it mailed them. */
  let mailed: string[] = [];

  beforeEach(async () => {
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
    (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
    mailed = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes('api.resend.com')) return realFetch(input as RequestInfo, init);
      const { subject } = JSON.parse(String(init?.body)) as { subject: string };
      mailed.push(/^\d{6}/.exec(subject)![0]);
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  });

  for (const order of [
    ['first', 'second'],
    ['second', 'first'],
  ] as const) {
    it(`each sign in with the cookie of their own request, the ${order[0]} one traded first`, async () => {
      const cookies = { first: '', second: '' };
      for (const which of ['first', 'second'] as const) {
        const asked = await post('/api/auth/email-code/request', { email: EMAIL });
        expect(asked.status).toBe(200);
        cookies[which] = cookieValue(asked, 'fm_logincode')!;
      }
      const codes = { first: mailed[0]!, second: mailed[1]! };

      for (const which of order) {
        const res = await post(
          '/api/auth/email-code/verify',
          { email: EMAIL, code: codes[which] },
          cookies[which]
        );
        expect(res.status, `the ${which} code`).toBe(200);
        expect(cookieValue(res, 'fm_session'), `a session from the ${which} code`).toBeTruthy();
      }
    });
  }
});

describe('account deletion', () => {
  it('removes the login_codes rows with the account', async () => {
    await createLoginCode(env, userId, EMAIL, newCodeHandle());
    // The fixture user's password_hash is a dummy, so mint the session directly.
    const { sessionCookie } = await import('./helpers/session');
    const session = (
      await sessionCookie(userId, 'password', env, { userAgent: null, ip: null })
    ).split(';')[0]!;
    const del = await SELF.fetch(`${BASE}/api/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: session },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    expect(del.status).toBe(200);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });
});

describe('with 2FA enabled on a confirmed account', () => {
  it('the email code is only the first factor: challenge cookie, then TOTP completes', async () => {
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enrollTotp(env, userId, secret);
    await confirmTotp(env, userId);

    const { code, cookie } = await mintWithCookie();
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code }, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { twofaRequired?: boolean }).twofaRequired).toBe(true);
    expect(cookieValue(res, 'fm_session')).toBeNull();
    const challenge = cookieValue(res, 'fm_2fa');
    expect(challenge).toBeTruthy();

    const verify = await post(
      '/api/auth/2fa/verify',
      { code: await totpCode(secret, currentStep()) },
      challenge!
    );
    expect(verify.status).toBe(200);
    expect(cookieValue(verify, 'fm_session')).toBeTruthy();
  });
});

describe('a code for an account whose address was never confirmed', () => {
  it('removes every way in that was set up before, then signs in', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 0);
    // Each of them gets in beforehand.
    expect(await (await signIn(SEEDED_ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
    const { code, cookie, id } = await mintWithCookie(SEEDED_ADDRESS, SEEDED);

    const res = await post('/api/auth/email-code/verify', { email: SEEDED_ADDRESS, code }, cookie);
    expect(res.status).toBe(200);
    // Straight in, with no second-factor step: the TOTP went with the rest. The answer says that
    // something was cleared, so the app can say what.
    expect(await res.json()).toEqual({ id: SEEDED, email: SEEDED_ADDRESS, cleared: true });
    const signedIn = cookieValue(res, 'fm_session');
    expect(signedIn, 'a session cookie').toBeTruthy();
    const who = await me(signedIn!);
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({
      id: SEEDED,
      email: SEEDED_ADDRESS,
      email_verified: 1,
    });
    expect(await accountRow(SEEDED)).toMatchObject({ password_hash: null, email_verified: 1 });

    // Nothing set up before gets in any more.
    expect((await signIn(SEEDED_ADDRESS)).status).toBe(401);
    expect((await me(session)).status).toBe(401);
    expect((await callMcp(apiToken)).status).toBe(401);
    const rows = await accessRows(SEEDED);
    expect(rows.auth_sessions).toEqual([expect.objectContaining({ provider: 'email' })]);
    // The code just used stays, spent. The one sent before it is gone with the other links.
    expect(rows.login_codes).toEqual([
      expect.objectContaining({ id, used_at: expect.any(String) }),
    ]);
    for (const table of ACCESS_TABLES.filter((t) => t !== 'auth_sessions' && t !== 'login_codes')) {
      expect(rows[table], table).toEqual([]);
    }

    // The data stays.
    expect(await dataRows(SEEDED)).toEqual(seededData(SEEDED));
  });

  it('leaves the account as it was when any part of the change fails', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 0);
    const { code, cookie, id } = await mintWithCookie(SEEDED_ADDRESS, SEEDED);
    const before = await accountRow(SEEDED);
    const rowsBefore = await accessRows(SEEDED);
    // Confirming the address is the last write, so everything before it has run when it fails.
    await env.DB.prepare(
      `CREATE TRIGGER fail_code_confirm BEFORE UPDATE OF email_verified ON users
       WHEN NEW.id = ${SEEDED}
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
    ).run();

    const res = await post('/api/auth/email-code/verify', { email: SEEDED_ADDRESS, code }, cookie);
    expect(res.status).toBe(500);
    expect(cookieValue(res, 'fm_session')).toBeNull();

    expect(await accountRow(SEEDED)).toEqual(before);
    expect(await accessRows(SEEDED)).toEqual({
      ...rowsBefore,
      login_codes: withSpent(rowsBefore.login_codes, id),
    });
    expect(await (await signIn(SEEDED_ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
  });
});

describe('a code for a confirmed account', () => {
  it('leaves every other way in as it was, and asks for the second factor', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 1);
    const { code, cookie, id } = await mintWithCookie(SEEDED_ADDRESS, SEEDED);
    const before = await accountRow(SEEDED);
    const rowsBefore = await accessRows(SEEDED);

    const res = await post('/api/auth/email-code/verify', { email: SEEDED_ADDRESS, code }, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ twofaRequired: true });
    expect(cookieValue(res, 'fm_session')).toBeNull();

    expect(await accountRow(SEEDED)).toEqual(before);
    expect(await accessRows(SEEDED)).toEqual({
      ...rowsBefore,
      login_codes: withSpent(rowsBefore.login_codes, id),
    });
    expect(await (await signIn(SEEDED_ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
  });
});
