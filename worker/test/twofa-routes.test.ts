/**
 * TOTP 2FA end-to-end against the real worker: enrollment, the login challenge, verification,
 * recovery codes, replay protection, rate limiting.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentStep, totpCode } from '../src/totp';

const BASE = 'https://api.example.com';
const EMAIL = 'twofa@example.com';
const PASSWORD = 'correct horse battery staple';

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}
function cookieValue(res: Response, name: string): string | null {
  for (const c of setCookies(res)) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]!;
  }
  return null;
}

async function register(email = EMAIL): Promise<void> {
  const res = await SELF.fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
}

async function login(email = EMAIL): Promise<Response> {
  return SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

/** Register + login for a user WITHOUT 2FA: returns the session cookie. */
async function freshSession(email = EMAIL): Promise<string> {
  const res = await login(email);
  expect(res.status).toBe(200);
  const session = cookieValue(res, 'fm_session');
  expect(session).toBeTruthy();
  return session!;
}

async function post(path: string, cookie: string | null, body?: unknown): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

/** Runs the whole enrollment: returns the shared secret and the recovery codes. */
async function enable2fa(session: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setupRes = await post('/api/auth/2fa/setup', session);
  expect(setupRes.status).toBe(200);
  const setup = (await setupRes.json()) as { secret: string; otpauthUri: string };
  expect(setup.otpauthUri).toContain(setup.secret);
  const enableRes = await post('/api/auth/2fa/enable', session, {
    code: await totpCode(setup.secret, currentStep()),
  });
  expect(enableRes.status).toBe(200);
  const enabled = (await enableRes.json()) as { recoveryCodes: string[] };
  expect(enabled.recoveryCodes).toHaveLength(10);
  return { secret: setup.secret, recoveryCodes: enabled.recoveryCodes };
}

beforeEach(async () => {
  for (const t of [
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
  await register();
});

describe('enrollment', () => {
  it('setup + enable flips status on and hands out 10 recovery codes', async () => {
    const session = await freshSession();
    await enable2fa(session);
    const status = await SELF.fetch(`${BASE}/api/auth/2fa/status`, {
      headers: { Cookie: session },
    });
    expect(await status.json()).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('enable rejects a wrong code and stays disabled', async () => {
    const session = await freshSession();
    await post('/api/auth/2fa/setup', session);
    const res = await post('/api/auth/2fa/enable', session, { code: '000000' });
    expect(res.status).toBe(401);
    const status = await SELF.fetch(`${BASE}/api/auth/2fa/status`, {
      headers: { Cookie: session },
    });
    expect(((await status.json()) as { enabled: boolean }).enabled).toBe(false);
  });

  it('setup answers 409 while 2FA is already enabled', async () => {
    const session = await freshSession();
    await enable2fa(session);
    expect((await post('/api/auth/2fa/setup', session)).status).toBe(409);
  });
});

describe('login challenge', () => {
  it('withholds the session and sets the challenge cookie instead', async () => {
    await enable2fa(await freshSession());
    const res = await login();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { twofaRequired?: boolean }).twofaRequired).toBe(true);
    expect(cookieValue(res, 'fm_session')).toBeNull();
    expect(cookieValue(res, 'fm_2fa')).toBeTruthy();
  });

  it('a valid TOTP code completes the login end-to-end', async () => {
    const { secret } = await enable2fa(await freshSession());
    const challenge = cookieValue(await login(), 'fm_2fa')!;
    // Enrollment consumed the current step's code (anti-replay), so present the next one —
    // exactly what the authenticator app would be showing by the time the user signs in.
    const verify = await post('/api/auth/2fa/verify', challenge, {
      code: await totpCode(secret, currentStep() + 1),
    });
    expect(verify.status).toBe(200);
    const session = cookieValue(verify, 'fm_session');
    expect(session).toBeTruthy();
    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: session! } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe(EMAIL);
  });

  it('rejects a wrong code', async () => {
    await enable2fa(await freshSession());
    const challenge = cookieValue(await login(), 'fm_2fa')!;
    expect((await post('/api/auth/2fa/verify', challenge, { code: '000000' })).status).toBe(401);
  });

  it('rejects a verify with no challenge cookie', async () => {
    await enable2fa(await freshSession());
    expect((await post('/api/auth/2fa/verify', null, { code: '123456' })).status).toBe(401);
  });

  it('the same TOTP code is never accepted twice (anti-replay)', async () => {
    const { secret } = await enable2fa(await freshSession());
    const code = await totpCode(secret, currentStep() + 1);
    const first = await post('/api/auth/2fa/verify', cookieValue(await login(), 'fm_2fa')!, {
      code,
    });
    expect(first.status).toBe(200);
    const second = await post('/api/auth/2fa/verify', cookieValue(await login(), 'fm_2fa')!, {
      code,
    });
    expect(second.status).toBe(401);
  });

  it('a recovery code signs in exactly once', async () => {
    const { recoveryCodes } = await enable2fa(await freshSession());
    const first = await post('/api/auth/2fa/verify', cookieValue(await login(), 'fm_2fa')!, {
      code: recoveryCodes[0],
    });
    expect(first.status).toBe(200);
    expect(cookieValue(first, 'fm_session')).toBeTruthy();
    const second = await post('/api/auth/2fa/verify', cookieValue(await login(), 'fm_2fa')!, {
      code: recoveryCodes[0],
    });
    expect(second.status).toBe(401);
  });

  it('rate limits repeated wrong codes', async () => {
    await enable2fa(await freshSession());
    const challenge = cookieValue(await login(), 'fm_2fa')!;
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await post('/api/auth/2fa/verify', challenge, { code: '000000' })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('disable', () => {
  it('a valid TOTP code disables 2FA and login goes back to one step', async () => {
    const session = await freshSession();
    const { secret } = await enable2fa(session);
    const res = await post('/api/auth/2fa/disable', session, {
      code: await totpCode(secret, currentStep() + 1),
    });
    expect(res.status).toBe(200);
    const after = await login();
    expect(cookieValue(after, 'fm_session')).toBeTruthy();
  });

  it('refuses to disable with a wrong code', async () => {
    const session = await freshSession();
    await enable2fa(session);
    expect((await post('/api/auth/2fa/disable', session, { code: '000000' })).status).toBe(401);
  });
});

describe('hardening', () => {
  it('rate limits repeated wrong codes on disable, same budget as verify', async () => {
    const session = await freshSession();
    await enable2fa(session);
    for (let i = 0; i < 10; i++) {
      expect((await post('/api/auth/2fa/disable', session, { code: '000000' })).status).toBe(401);
    }
    // The guessing budget is spent: even more wrong codes now bounce off the limiter.
    expect((await post('/api/auth/2fa/disable', session, { code: '000000' })).status).toBe(429);
  });

  it('a successful disable clears the shared attempt budget', async () => {
    const session = await freshSession();
    const { secret } = await enable2fa(session);
    for (let i = 0; i < 9; i++) {
      await post('/api/auth/2fa/disable', session, { code: '000000' });
    }
    const ok = await post('/api/auth/2fa/disable', session, {
      code: await totpCode(secret, currentStep() + 1),
    });
    expect(ok.status).toBe(200);
    // Re-enabling and verifying must start from a clean budget, like verify's own clear.
    const { secret: secret2 } = await enable2fa(session);
    const challenged = await login();
    const twofaCookie = cookieValue(challenged, 'fm_2fa');
    const verified = await post('/api/auth/2fa/verify', twofaCookie, {
      code: await totpCode(secret2, currentStep() + 1),
    });
    expect(verified.status).toBe(200);
  });

  it('enabling 2FA signs out every other session', async () => {
    const other = await freshSession();
    const current = await freshSession();
    await enable2fa(current);

    const otherMe = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: other } });
    expect(otherMe.status).toBe(401);
    // The session that performed the enrollment keeps working.
    const currentMe = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: current } });
    expect(currentMe.status).toBe(200);
  });

  it('deleting the account removes the TOTP credential and recovery codes', async () => {
    const session = await freshSession();
    await enable2fa(session);
    const del = await SELF.fetch(`${BASE}/api/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: session },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    expect(del.status).toBe(200);
    const totp = await env.DB.prepare('SELECT COUNT(*) AS n FROM totp_credentials').first<{
      n: number;
    }>();
    const codes = await env.DB.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first<{
      n: number;
    }>();
    expect(totp?.n).toBe(0);
    expect(codes?.n).toBe(0);
  });
});
