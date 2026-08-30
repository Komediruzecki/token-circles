/**
 * Email-code sign-in: request a 6-digit code by mail, trade it for a session. Anti-enumeration
 * (the request endpoint answers identically for unknown addresses, cookie included), single-use,
 * 10-minute TTL — and the verify step is BOUND to the browser that requested it by a signed
 * ceremony cookie, so a code can only be guessed at by the party that triggered it: five wrong
 * attempts burn it. The 2FA challenge still applies after the code.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLoginCode,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_TTL_MINUTES,
} from '../src/login-codes';
import { issueLoginCodeCookie } from '../src/routes/email-code';
import { currentStep, totpCode } from '../src/totp';
import { confirmTotp, enrollTotp } from '../src/twofa';

const BASE = 'https://api.example.com';
const EMAIL = 'codeuser@example.com';

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]!;
  }
  return null;
}

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/** Mint a code at the store level and its matching ceremony cookie, as /request would. */
async function mintWithCookie(email = EMAIL): Promise<{ code: string; cookie: string }> {
  const { code, id } = await createLoginCode(env, userId, email);
  const cookie = (await issueLoginCodeCookie(env, id, email)).split(';')[0]!;
  return { code, cookie };
}

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

  it('stores only a hash, never the code', async () => {
    const { code } = await createLoginCode(env, userId, EMAIL);
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
    await createLoginCode(env, userId, EMAIL);
    const res = await post(
      '/api/auth/email-code/verify',
      { email: EMAIL, code: first.code },
      first.cookie
    );
    expect(res.status).toBe(200);
  });

  it('keeps at most three live codes per user', async () => {
    for (let i = 0; i < 5; i++) await createLoginCode(env, userId, EMAIL);
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

describe('account deletion', () => {
  it('removes the login_codes rows with the account', async () => {
    await createLoginCode(env, userId, EMAIL);
    // The fixture user's password_hash is a dummy, so mint the session directly.
    const { issueSessionCookie } = await import('../src/auth');
    const session = (
      await issueSessionCookie(userId, 'password', env, { userAgent: null, ip: null })
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

describe('with 2FA enabled', () => {
  it('the email code is only the first factor: challenge cookie, then TOTP completes', async () => {
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
