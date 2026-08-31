/**
 * Passkeys (WebAuthn) — REAL ceremonies against the worker via a software authenticator
 * (test/helpers/software-authenticator.ts): registration, usernameless login, counter update,
 * user-verification enforcement, and the passkey-skips-TOTP rule.
 *
 * The test runtime's CORS_ORIGIN is http://localhost:3800 (wrangler.jsonc vars), so the
 * expected WebAuthn origin/rpID here are localhost's.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuthenticator } from './helpers/software-authenticator';
import type { SoftwareAuthenticator } from './helpers/software-authenticator';
import { confirmTotp, enrollTotp } from '../src/twofa';
import { currentStep, totpCode } from '../src/totp';

const BASE = 'https://api.example.com';
const ORIGIN = 'http://localhost:3800';
const RP_ID = 'localhost';
const EMAIL = 'passkey@example.com';
const PASSWORD = 'correct horse battery staple';

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(';')[0]!;
  }
  return null;
}

async function post(path: string, body?: unknown, cookie?: string | null): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

async function session(): Promise<string> {
  const reg = await post('/api/auth/register', { email: EMAIL, password: PASSWORD });
  expect(reg.status).toBe(200);
  const login = await post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  return cookieValue(login, 'fm_session')!;
}

/** Full registration ceremony; returns the authenticator holding the new credential. */
async function registerPasskey(sess: string): Promise<SoftwareAuthenticator> {
  const optRes = await post('/api/auth/passkeys/register/options', {}, sess);
  expect(optRes.status).toBe(200);
  const options = (await optRes.json()) as { challenge: string; rp: { id: string } };
  expect(options.rp.id).toBe(RP_ID);
  const challengeCookie = cookieValue(optRes, 'fm_webauthn');
  expect(challengeCookie).toBeTruthy();

  const authenticator = await createAuthenticator();
  const attestation = await authenticator.register(options.challenge, ORIGIN, RP_ID);
  const verifyRes = await post(
    '/api/auth/passkeys/register/verify',
    { response: attestation, name: 'Test device' },
    `${sess}; ${challengeCookie}`
  );
  expect(verifyRes.status).toBe(200);
  return authenticator;
}

/** Full login ceremony with an already-registered authenticator. */
async function passkeyLogin(
  authenticator: SoftwareAuthenticator,
  opts: { counter?: number; userVerified?: boolean } = {}
): Promise<Response> {
  const optRes = await post('/api/auth/passkeys/login/options');
  expect(optRes.status).toBe(200);
  const options = (await optRes.json()) as { challenge: string };
  const challengeCookie = cookieValue(optRes, 'fm_webauthn')!;
  const assertion = await authenticator.authenticate(options.challenge, ORIGIN, RP_ID, opts);
  return post('/api/auth/passkeys/login/verify', { response: assertion }, challengeCookie);
}

beforeEach(async () => {
  for (const t of [
    'webauthn_credentials',
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
});

describe('registration', () => {
  it('a real attestation registers, lists, and records the device name', async () => {
    const sess = await session();
    await registerPasskey(sess);

    const list = await SELF.fetch(`${BASE}/api/auth/passkeys`, { headers: { Cookie: sess } });
    const body = (await list.json()) as { passkeys: { name: string | null }[] };
    expect(body.passkeys).toHaveLength(1);
    expect(body.passkeys[0]!.name).toBe('Test device');
  });

  it('rejects a response signed for a different challenge', async () => {
    const sess = await session();
    const optRes = await post('/api/auth/passkeys/register/options', {}, sess);
    const challengeCookie = cookieValue(optRes, 'fm_webauthn')!;
    const authenticator = await createAuthenticator();
    // Attest to a challenge the server never issued.
    const attestation = await authenticator.register(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ORIGIN,
      RP_ID
    );
    const res = await post(
      '/api/auth/passkeys/register/verify',
      { response: attestation },
      `${sess}; ${challengeCookie}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects a verify without the challenge cookie', async () => {
    const sess = await session();
    const authenticator = await createAuthenticator();
    const attestation = await authenticator.register('whatever', ORIGIN, RP_ID);
    const res = await post('/api/auth/passkeys/register/verify', { response: attestation }, sess);
    expect(res.status).toBe(401);
  });
});

describe('login', () => {
  it('a real assertion signs in: session, provider passkey, counter stored', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);

    const res = await passkeyLogin(authenticator, { counter: 7 });
    expect(res.status).toBe(200);
    const newSession = cookieValue(res, 'fm_session');
    expect(newSession).toBeTruthy();

    const me = await SELF.fetch(`${BASE}/api/auth/me`, { headers: { Cookie: newSession! } });
    expect(me.status).toBe(200);

    const cred = await env.DB.prepare(
      'SELECT counter, last_used_at FROM webauthn_credentials'
    ).first<{ counter: number; last_used_at: string | null }>();
    expect(cred?.counter).toBe(7);
    expect(cred?.last_used_at).not.toBeNull();
    const provider = await env.DB.prepare(
      "SELECT provider FROM auth_sessions WHERE provider = 'passkey'"
    ).first();
    expect(provider).not.toBeNull();
  });

  it('rejects an assertion from an unregistered authenticator', async () => {
    const sess = await session();
    await registerPasskey(sess);
    const stranger = await createAuthenticator();
    expect((await passkeyLogin(stranger)).status).toBe(401);
  });

  it('rejects an assertion without user verification (UV is what makes a passkey MFA)', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);
    expect((await passkeyLogin(authenticator, { userVerified: false })).status).toBe(401);
  });

  it('skips the TOTP challenge: a user-verified passkey is already two factors', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(EMAIL)
      .first<{ id: number }>();
    await enrollTotp(env, user!.id, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    await confirmTotp(env, user!.id);

    const res = await passkeyLogin(authenticator);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { twofaRequired?: boolean }).twofaRequired).toBeUndefined();
    expect(cookieValue(res, 'fm_session')).toBeTruthy();
  });
});

describe('management', () => {
  it('deleting a passkey ends its sign-in power', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);
    const list = await SELF.fetch(`${BASE}/api/auth/passkeys`, { headers: { Cookie: sess } });
    const { passkeys } = (await list.json()) as { passkeys: { id: string }[] };

    const del = await SELF.fetch(`${BASE}/api/auth/passkeys/${passkeys[0]!.id}`, {
      method: 'DELETE',
      headers: { Cookie: sess },
    });
    expect(del.status).toBe(200);
    expect((await passkeyLogin(authenticator)).status).toBe(401);
  });
});

describe('hardening', () => {
  it('the same authenticator signs in twice — its counter climbs', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);
    expect((await passkeyLogin(authenticator)).status).toBe(200);
    expect((await passkeyLogin(authenticator)).status).toBe(200);
  });

  it('refuses to register an authenticator that skipped user verification', async () => {
    // Login demands UV (that is what makes a passkey MFA); accepting a UV-less registration
    // would mint a credential that can never sign in.
    const sess = await session();
    const optRes = await post('/api/auth/passkeys/register/options', {}, sess);
    const options = (await optRes.json()) as { challenge: string };
    const challengeCookie = cookieValue(optRes, 'fm_webauthn')!;
    const authenticator = await createAuthenticator();
    const attestation = await authenticator.register(options.challenge, ORIGIN, RP_ID, {
      userVerified: false,
    });
    const res = await post(
      '/api/auth/passkeys/register/verify',
      { response: attestation },
      `${sess}; ${challengeCookie}`
    );
    expect(res.status).toBe(400);
  });

  it('a replayed registration answers 409, not a raw database error', async () => {
    const sess = await session();
    const optRes = await post('/api/auth/passkeys/register/options', {}, sess);
    const options = (await optRes.json()) as { challenge: string };
    const challengeCookie = cookieValue(optRes, 'fm_webauthn')!;
    const authenticator = await createAuthenticator();
    const attestation = await authenticator.register(options.challenge, ORIGIN, RP_ID);
    const first = await post(
      '/api/auth/passkeys/register/verify',
      { response: attestation, name: 'Device' },
      `${sess}; ${challengeCookie}`
    );
    expect(first.status).toBe(200);
    const replay = await post(
      '/api/auth/passkeys/register/verify',
      { response: attestation, name: 'Device' },
      `${sess}; ${challengeCookie}`
    );
    expect(replay.status).toBe(409);
  });

  it('a counter that runs backwards is logged as possible cloning, not generic failure', async () => {
    const sess = await session();
    const authenticator = await registerPasskey(sess);
    expect((await passkeyLogin(authenticator, { counter: 10 })).status).toBe(200);
    expect((await passkeyLogin(authenticator, { counter: 5 })).status).toBe(401);
    const logged = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM auth_logs WHERE reason = 'passkey_counter_regression'"
    ).first<{ n: number }>();
    expect(logged?.n).toBe(1);
  });

  it('a stale session must re-prove identity before adding a passkey', async () => {
    // A stolen or long-idle cookie must not be enough to plant a credential that skips TOTP
    // and survives password resets. Fresh logins (the nudge case) pass untouched.
    const sess = await session();
    await env.DB.prepare(
      "UPDATE auth_sessions SET created_at = datetime('now', '-11 minutes')"
    ).run();
    const refused = await post('/api/auth/passkeys/register/options', {}, sess);
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { reauth?: boolean }).reauth).toBe(true);

    const withPassword = await post(
      '/api/auth/passkeys/register/options',
      { reauth: PASSWORD },
      sess
    );
    expect(withPassword.status).toBe(200);
  });

  it('a stale session can also re-prove with a TOTP code', async () => {
    const sess = await session();
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(EMAIL)
      .first<{ id: number }>();
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    await enrollTotp(env, user!.id, secret);
    await confirmTotp(env, user!.id);
    await env.DB.prepare(
      "UPDATE auth_sessions SET created_at = datetime('now', '-11 minutes')"
    ).run();
    const res = await post(
      '/api/auth/passkeys/register/options',
      { reauth: await totpCode(secret, currentStep()) },
      sess
    );
    expect(res.status).toBe(200);
  });

  it('caps stored passkeys per account', async () => {
    const sess = await session();
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(EMAIL)
      .first<{ id: number }>();
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(
        "INSERT INTO webauthn_credentials (id, user_id, public_key, counter) VALUES (?, ?, 'x', 0)"
      )
        .bind(`cred-${i}`, user!.id)
        .run();
    }
    const res = await post('/api/auth/passkeys/register/options', {}, sess);
    expect(res.status).toBe(400);
  });

  it('rate limits registration ceremonies', async () => {
    const sess = await session();
    let last = 0;
    for (let i = 0; i < 22; i++) {
      last = (await post('/api/auth/passkeys/register/options', {}, sess)).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('deleting the account removes its passkeys', async () => {
    const sess = await session();
    await registerPasskey(sess);
    const del = await SELF.fetch(`${BASE}/api/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Cookie: sess },
      body: JSON.stringify({ confirm: 'delete' }),
    });
    expect(del.status).toBe(200);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });
});
