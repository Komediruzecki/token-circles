/**
 * Every sign-in and every new credential is written against the account's token_version as its
 * check read it, in the same statement. When the account changes between the check and the write
 * (its address was confirmed, which clears what was set up before it, or it was signed out
 * everywhere), the write does nothing and the route answers 409, "Please try again."
 *
 * Each test changes the account at that exact point in the request (helpers/racing-db.ts), once
 * per route that signs in or adds a way in.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signState } from '../src/auth';
import { createLoginCode, newCodeHandle } from '../src/login-codes';
import { issueLoginCodeCookie } from '../src/routes/email-code';
import { currentStep, totpCode } from '../src/totp';
import {
  accessRows,
  removeAccounts,
  seedAccount,
  sessionFrom,
  whileConfirmed,
} from './helpers/account-access';
import { bumpTokenVersion, clearAndConfirm, dbWithStep, realDb, withDb } from './helpers/racing-db';
import { createAuthenticator } from './helpers/software-authenticator';
import type { SoftwareAuthenticator } from './helpers/software-authenticator';

const UID = 6640;
const ADDRESS = 'household-bound@example.com';
const GOOGLE_SUB = 'google-sub-6640';
const MINE = `SELECT ${UID} UNION SELECT id FROM users WHERE provider_id = '${GOOGLE_SUB}'`;
const ORIGIN = 'http://localhost:3800';
const RP_ID = 'localhost';
const TRY_AGAIN = { error: 'Please try again.' };

/** requireAuth's look-up of the session row, the last thing it reads before a route runs. */
const AFTER_SESSION_CHECK = /FROM auth_sessions WHERE id = \? AND user_id = \?/;

const realFetch = globalThis.fetch;

beforeEach(async () => {
  await removeAccounts(MINE);
  await realDb.prepare('DELETE FROM rate_limits').run();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).GOOGLE_CLIENT_SECRET;
  await removeAccounts(MINE);
});

function post(path: string, body: unknown, cookie?: string | null): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

function put(path: string, body: unknown, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function cookieFrom(res: Response, name: string): string | null {
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(';')[0]!;
    if (pair.startsWith(`${name}=`) && pair.length > name.length + 1) return pair;
  }
  return null;
}

const rows = async (sql: string) => (await realDb.prepare(sql).bind(UID).all()).results;

/** Check the step ran, the route refused, and no session came back. */
async function expectRefused(res: Response, ran: () => boolean): Promise<void> {
  expect(ran()).toBe(true);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual(TRY_AGAIN);
  expect(sessionFrom(res)).toBeNull();
}

/** A real passkey on the account, registered with the session seedAccount issued. */
async function registerPasskey(session: string): Promise<SoftwareAuthenticator> {
  const options = await post('/api/auth/passkeys/register/options', {}, session);
  expect(options.status).toBe(200);
  const { challenge } = (await options.json()) as { challenge: string };
  const authenticator = await createAuthenticator();
  const attestation = await authenticator.register(challenge, ORIGIN, RP_ID);
  const verified = await post(
    '/api/auth/passkeys/register/verify',
    { response: attestation, name: 'Laptop' },
    `${session}; ${cookieFrom(options, 'fm_webauthn')}`
  );
  expect(verified.status).toBe(200);
  return authenticator;
}

/** Google's two answers to the callback, for the claims given. */
function answerGoogle(): void {
  const vars = env as unknown as Record<string, string>;
  vars.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  const claims = {
    aud: vars.GOOGLE_CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: GOOGLE_SUB,
    email: ADDRESS,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ id_token: 'test-id-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo') return Response.json(claims);
    throw new Error(`Unexpected fetch in a test: ${url}`);
  }) as typeof fetch;
}

async function googleCallback(): Promise<Response> {
  const state = await signState({ returnTo: ORIGIN, ts: Date.now() }, env.JWT_SECRET);
  return SELF.fetch(
    `https://example.com/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' }
  );
}

describe('a sign-in is refused when the account changed after the check', () => {
  it('a password, when the address was confirmed after the password was checked', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const racing = dbWithStep(realDb, /FROM users WHERE email = \?/, () => clearAndConfirm(UID));
    const res = await withDb(racing.db, () =>
      post('/api/auth/login', { email: ADDRESS, password: 'the-password-from-signup' })
    );
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });

  it('a second factor, when the address was confirmed after the code was checked', async () => {
    const { totpSecret } = await seedAccount(UID, ADDRESS, 0);
    const first = await post('/api/auth/login', {
      email: ADDRESS,
      password: 'the-password-from-signup',
    });
    expect(await first.json()).toEqual({ twofaRequired: true });
    const challenge = cookieFrom(first, 'fm_2fa');
    const code = await totpCode(totpSecret, currentStep());
    const racing = dbWithStep(
      realDb,
      /FROM totp_credentials WHERE user_id = \? AND confirmed_at IS NOT NULL/,
      () => clearAndConfirm(UID)
    );
    const res = await withDb(racing.db, () => post('/api/auth/2fa/verify', { code }, challenge));
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });

  it('a passkey, when the address was confirmed after the passkey was checked', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const authenticator = await whileConfirmed(UID, () => registerPasskey(session));
    const options = await post('/api/auth/passkeys/login/options', {});
    const { challenge } = (await options.json()) as { challenge: string };
    const assertion = await authenticator.authenticate(challenge, ORIGIN, RP_ID);
    const racing = dbWithStep(realDb, /FROM webauthn_credentials\b[\s\S]*WHERE (c\.)?id = \?/, () =>
      clearAndConfirm(UID)
    );
    const res = await withDb(racing.db, () =>
      post(
        '/api/auth/passkeys/login/verify',
        { response: assertion },
        cookieFrom(options, 'fm_webauthn')
      )
    );
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });

  it('an emailed code, when the account moved on after the code confirmed it', async () => {
    await seedAccount(UID, ADDRESS, 0);
    const handle = newCodeHandle();
    const { code } = await createLoginCode(env, UID, ADDRESS, handle);
    const ceremony = issueLoginCodeCookie(env, handle).split(';')[0]!;
    const racing = dbWithStep(realDb, /UPDATE users SET email_verified = 1/, () =>
      bumpTokenVersion(UID)
    );
    const res = await withDb(racing.db, () =>
      post('/api/auth/email-code/verify', { email: ADDRESS, code }, ceremony)
    );
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });

  it('Google, joining an account, when it moved on after the join confirmed it', async () => {
    await seedAccount(UID, ADDRESS, 0);
    answerGoogle();
    const racing = dbWithStep(realDb, /SET auth_provider = 'google'/, () => bumpTokenVersion(UID));
    const res = await withDb(racing.db, googleCallback);
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });

  it('Google, on an account it already signs in to, when it moved on after the look-up', async () => {
    await seedAccount(UID, ADDRESS, 1);
    await realDb.batch([
      realDb
        .prepare("UPDATE users SET auth_provider = 'google', provider_id = ? WHERE id = ?")
        .bind(GOOGLE_SUB, UID),
      realDb.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(UID),
      realDb.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(UID),
    ]);
    answerGoogle();
    const racing = dbWithStep(realDb, /WHERE auth_provider = 'google' AND provider_id = \?/, () =>
      bumpTokenVersion(UID)
    );
    const res = await withDb(racing.db, googleCallback);
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).auth_sessions).toEqual([]);
  });
});

// A session reaches these routes only once its account's address is confirmed, so the change that
// can still come between its check and the write is signing out everywhere.
describe('a new way in is refused when the account changed after the session was checked', () => {
  it('an API token', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    const before = (await accessRows(UID)).api_tokens;
    const racing = dbWithStep(realDb, AFTER_SESSION_CHECK, () => bumpTokenVersion(UID));
    const res = await withDb(racing.db, () =>
      post('/api/account/api-tokens', { name: 'Laptop', scopes: ['read'] }, session)
    );
    await expectRefused(res, racing.ran);
    // The token seedAccount minted, and no other.
    expect((await accessRows(UID)).api_tokens).toEqual(before);
  });

  it('a passkey', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    await realDb.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').bind(UID).run();
    const options = await post('/api/auth/passkeys/register/options', {}, session);
    const { challenge } = (await options.json()) as { challenge: string };
    const attestation = await (await createAuthenticator()).register(challenge, ORIGIN, RP_ID);
    const racing = dbWithStep(realDb, AFTER_SESSION_CHECK, () => bumpTokenVersion(UID));
    const res = await withDb(racing.db, () =>
      post(
        '/api/auth/passkeys/register/verify',
        { response: attestation, name: 'Laptop' },
        `${session}; ${cookieFrom(options, 'fm_webauthn')}`
      )
    );
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).webauthn_credentials).toEqual([]);
  });

  it('two-factor setup', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    await realDb.batch([
      realDb.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(UID),
      realDb.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(UID),
    ]);
    const racing = dbWithStep(realDb, AFTER_SESSION_CHECK, () => bumpTokenVersion(UID));
    const res = await withDb(racing.db, () => post('/api/auth/2fa/setup', {}, session));
    await expectRefused(res, racing.ran);
    expect((await accessRows(UID)).totp_credentials).toEqual([]);
  });

  it('turning two-factor on, when the account was signed out everywhere after the check', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    await realDb.batch([
      realDb.prepare('DELETE FROM totp_credentials WHERE user_id = ?').bind(UID),
      realDb.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(UID),
    ]);
    const setup = await post('/api/auth/2fa/setup', {}, session);
    expect(setup.status).toBe(200);
    const { secret } = (await setup.json()) as { secret: string };
    const code = await totpCode(secret, currentStep());
    const racing = dbWithStep(
      realDb,
      /FROM totp_credentials WHERE user_id = \? AND confirmed_at IS NULL/,
      () => bumpTokenVersion(UID)
    );
    const res = await withDb(racing.db, () => post('/api/auth/2fa/enable', { code }, session));
    await expectRefused(res, racing.ran);
    const access = await accessRows(UID);
    // The enrollment it checked is still there, and still not on.
    expect(access.totp_credentials).toHaveLength(1);
    expect(access.totp_credentials[0]?.confirmed_at).toBeNull();
    expect(access.recovery_codes).toEqual([]);
  });

  it('a confirm link sent again', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 0);
    const racing = dbWithStep(realDb, /SELECT email, email_verified FROM users WHERE id = \?/, () =>
      clearAndConfirm(UID)
    );
    const res = await withDb(racing.db, () => post('/api/auth/resend-verification', {}, session));
    await expectRefused(res, racing.ran);
    expect(
      await rows('SELECT id FROM email_verifications WHERE user_id = ? AND used_at IS NULL')
    ).toEqual([]);
  });

  it('a change of address asked for in Settings', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    const racing = dbWithStep(realDb, AFTER_SESSION_CHECK, () => bumpTokenVersion(UID));
    const res = await withDb(racing.db, () =>
      put('/api/notifications/settings', { email: 'moved-6640@example.com' }, session)
    );
    await expectRefused(res, racing.ran);
    expect(
      await rows("SELECT id FROM email_verifications WHERE user_id = ? AND purpose = 'change'")
    ).toEqual([]);
  });

  it('a change of address sent again', async () => {
    const { session } = await seedAccount(UID, ADDRESS, 1);
    const asked = await put(
      '/api/notifications/settings',
      { email: 'moved-6640@example.com' },
      session
    );
    expect(asked.status).toBe(200);
    const waiting = () =>
      rows(
        "SELECT id FROM email_verifications WHERE user_id = ? AND purpose = 'change' AND used_at IS NULL"
      );
    const before = await waiting();
    expect(before).toHaveLength(1);
    const racing = dbWithStep(
      realDb,
      /purpose = 'change' AND used_at IS NULL AND expires_at > \?/,
      () => bumpTokenVersion(UID)
    );
    const res = await withDb(racing.db, () => post('/api/auth/email-change/resend', {}, session));
    await expectRefused(res, racing.ran);
    // No second link: the one sent before is still the only one waiting.
    expect(await waiting()).toEqual(before);
  });
});
