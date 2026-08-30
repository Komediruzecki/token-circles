/**
 * Email-code sign-in: request a 6-digit code by mail, trade it for a session. Anti-enumeration
 * (the request endpoint answers identically for unknown addresses), single-use, 10-minute TTL,
 * superseded by the next request — and the 2FA challenge still applies after the code.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoginCode, LOGIN_CODE_TTL_MINUTES } from '../src/login-codes';
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
  it('answers the same neutral ok for existing and unknown addresses', async () => {
    const known = await post('/api/auth/email-code/request', { email: EMAIL });
    const unknown = await post('/api/auth/email-code/request', { email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());

    const rows = await env.DB.prepare('SELECT email FROM login_codes').all();
    expect(rows.results).toHaveLength(1); // only the real account got a code minted
  });

  it('stores only a hash, never the code', async () => {
    const code = await createLoginCode(env, userId, EMAIL);
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
});

describe('verifying a code', () => {
  it('a valid code signs in: session cookie, me works, provider recorded', async () => {
    const code = await createLoginCode(env, userId, EMAIL);
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code });
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

  it('proving inbox control marks the address verified', async () => {
    const code = await createLoginCode(env, userId, EMAIL);
    await post('/api/auth/email-code/verify', { email: EMAIL, code });
    const row = await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?')
      .bind(userId)
      .first<{ email_verified: number }>();
    expect(row?.email_verified).toBe(1);
  });

  it('rejects a wrong code with a neutral message', async () => {
    await createLoginCode(env, userId, EMAIL);
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code: '000000' });
    expect(res.status).toBe(401);
    expect(cookieValue(res, 'fm_session')).toBeNull();
  });

  it('rejects an expired code', async () => {
    const code = await createLoginCode(env, userId, EMAIL);
    await env.DB.prepare("UPDATE login_codes SET expires_at = datetime('now', '-1 minute')").run();
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code })).status).toBe(401);
    expect(LOGIN_CODE_TTL_MINUTES).toBe(10);
  });

  it('a code works exactly once', async () => {
    const code = await createLoginCode(env, userId, EMAIL);
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code })).status).toBe(200);
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code })).status).toBe(401);
  });

  it('requesting a new code invalidates the previous one', async () => {
    const first = await createLoginCode(env, userId, EMAIL);
    const second = await createLoginCode(env, userId, EMAIL);
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code: first })).status).toBe(
      401
    );
    expect((await post('/api/auth/email-code/verify', { email: EMAIL, code: second })).status).toBe(
      200
    );
  });

  it('rate limits guessing', async () => {
    await createLoginCode(env, userId, EMAIL);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await post('/api/auth/email-code/verify', { email: EMAIL, code: '111111' })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('with 2FA enabled', () => {
  it('the email code is only the first factor: challenge cookie, then TOTP completes', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enrollTotp(env, userId, secret);
    await confirmTotp(env, userId);

    const code = await createLoginCode(env, userId, EMAIL);
    const res = await post('/api/auth/email-code/verify', { email: EMAIL, code });
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
