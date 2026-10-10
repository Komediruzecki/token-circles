/**
 * Google sign-in, end to end against the real D1. The callback runs as Google's redirect reaches
 * it, and its two calls to Google (the code exchange and tokeninfo) are answered here. Which
 * account the sign-in lands in, and what that account keeps, is the Worker's own code.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signState } from '../src/auth';
import { pendingEmailChange } from '../src/email-change';
import { sha256Hex } from '../src/email-verification';
import {
  ACCESS_TABLES,
  accessRows,
  accountRow,
  callMcp,
  dataRows,
  me,
  passwordIs,
  profilesWith,
  removeAccounts,
  seedAccount,
  seededData,
  sessionFrom,
  signIn,
} from './helpers/account-access';

const UID = 6600;
const ADDRESS = 'household@example.com';
const GOOGLE_SUB = 'google-sub-6600';
const RETURN_TO = 'http://localhost:3800';

/** This file's accounts: the seeded one, and any a Google sign-in created. */
const MINE = `SELECT ${UID} UNION SELECT id FROM users WHERE provider_id = '${GOOGLE_SUB}'`;

const realFetch = globalThis.fetch;
let claims: Record<string, string>;

beforeEach(async () => {
  await removeAccounts(MINE);
  await env.DB.prepare('DELETE FROM rate_limits').run();

  const vars = env as unknown as Record<string, string>;
  vars.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
  claims = {
    aud: vars.GOOGLE_CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: GOOGLE_SUB,
    email: ADDRESS,
    email_verified: 'true',
    exp: String(Math.floor(Date.now() / 1000) + 3600),
  };
  // The callback's two calls to Google. Anything else is a mistake in the test, never a request
  // that leaves the machine.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://oauth2.googleapis.com/token') {
      return Response.json({ id_token: 'test-id-token' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/tokeninfo') return Response.json(claims);
    throw new Error(`Unexpected fetch in a test: ${url}`);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).GOOGLE_CLIENT_SECRET;
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_google_join').run();
  await removeAccounts(MINE);
});

const seed = (emailVerified: 0 | 1) => seedAccount(UID, ADDRESS, emailVerified);
const account = () => accountRow(UID);

/** Arrive at the callback the way Google's redirect does. */
async function googleSignIn(): Promise<Response> {
  const state = await signState({ returnTo: RETURN_TO, ts: Date.now() }, env.JWT_SECRET);
  return SELF.fetch(
    `https://example.com/api/auth/google/callback?code=test-code&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' }
  );
}

describe('Google sign-in to an account whose address was never confirmed', () => {
  it('removes every way in that was set up before, then joins the account', async () => {
    const { session, apiToken } = await seed(0);
    // Each of them gets in beforehand.
    // The password is the account's: a sign-in answers it as a wrong one while the address
    // waits for its link.
    expect(await passwordIs(UID)).toBe(true);
    expect((await me(session)).status).toBe(200);
    // The API token is known: it is answered as one whose account waits for its link.
    expect(await (await callMcp(apiToken)).json()).toMatchObject({ code: 'EMAIL_UNCONFIRMED' });
    const before = await account();

    const res = await googleSignIn();
    expect(res.status).toBe(302);
    // Straight in, with no second-factor step: the TOTP went with the rest. The app is told that
    // something was cleared, so it can say what.
    expect(res.headers.get('Location')).toBe(`${RETURN_TO}/?cleared=1`);
    const google = sessionFrom(res);
    expect(google, 'a session cookie').not.toBeNull();

    // The Google session works, in the same account, which is now confirmed.
    const who = await me(google!);
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({
      id: UID,
      email: ADDRESS,
      auth_provider: 'google',
      email_verified: 1,
    });
    // It reaches the app's routes, which a session of an account waiting for its link does not.
    expect((await profilesWith(google!)).status).toBe(200);
    expect(await account()).toMatchObject({
      password_hash: null,
      provider_id: GOOGLE_SUB,
      token_version: before!.token_version + 1,
    });

    // Nothing set up before gets in any more.
    expect((await signIn(ADDRESS)).status).toBe(401);
    expect((await me(session)).status).toBe(401);
    expect((await callMcp(apiToken)).status).toBe(401);
    const rows = await accessRows(UID);
    expect(rows.auth_sessions).toEqual([expect.objectContaining({ provider: 'google' })]);
    for (const table of ACCESS_TABLES.filter((t) => t !== 'auth_sessions')) {
      expect(rows[table], table).toEqual([]);
    }

    // The data stays.
    expect(await dataRows(UID)).toEqual(seededData(UID));
  });

  it('ends an email change still waiting for its link', async () => {
    await seed(0);
    // A change of address waiting for its link (migration 0031), planted with a known token.
    await env.DB.prepare(
      "INSERT INTO email_verifications (user_id, email, token_hash, expires_at, purpose) VALUES (?, 'elsewhere@example.com', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'), 'change')"
    )
      .bind(UID, await sha256Hex('waiting-change-token'))
      .run();
    expect(await pendingEmailChange(env.DB, UID)).toBe('elsewhere@example.com');

    expect((await googleSignIn()).status).toBe(302);

    expect(await pendingEmailChange(env.DB, UID)).toBeNull();
    const opened = await SELF.fetch(
      `https://example.com/api/auth/verify-email?token=waiting-change-token&returnTo=${encodeURIComponent(RETURN_TO)}`,
      { redirect: 'manual' }
    );
    expect(opened.headers.get('Location')).toContain('everified_error=invalid_or_used');
    expect((await account())?.email).toBe(ADDRESS);
  });

  it('leaves the account as it was when any part of the change fails', async () => {
    const { session, apiToken } = await seed(0);
    const before = await account();
    const rowsBefore = await accessRows(UID);
    // Joining is the last write, so everything before it has run by the time it fails.
    await env.DB.prepare(
      `CREATE TRIGGER fail_google_join BEFORE UPDATE OF provider_id ON users
       WHEN NEW.id = ${UID}
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
    ).run();

    const res = await googleSignIn();
    expect(res.status).toBe(500);
    expect(sessionFrom(res)).toBeNull();

    expect(await account()).toEqual(before);
    expect(await accessRows(UID)).toEqual(rowsBefore);
    // The password is the account's: a sign-in answers it as a wrong one while the address
    // waits for its link.
    expect(await passwordIs(UID)).toBe(true);
    expect((await me(session)).status).toBe(200);
    // The API token is known: it is answered as one whose account waits for its link.
    expect(await (await callMcp(apiToken)).json()).toMatchObject({ code: 'EMAIL_UNCONFIRMED' });
  });
});

describe('Google sign-in to a confirmed account', () => {
  it('joins it and leaves everything else as it was', async () => {
    const { session, apiToken } = await seed(1);
    const before = await account();
    const rowsBefore = await accessRows(UID);

    const res = await googleSignIn();
    expect(res.status).toBe(302);
    // The account's own second factor applies to the Google sign-in, as it did before.
    const location = new URL(res.headers.get('Location')!);
    expect(location.searchParams.get('twofa')).toBe('1');
    expect(location.searchParams.has('cleared')).toBe(false);
    expect(sessionFrom(res)).toBeNull();

    expect(await account()).toEqual({
      ...before,
      auth_provider: 'google',
      provider_id: GOOGLE_SUB,
    });
    expect(await accessRows(UID)).toEqual(rowsBefore);
    expect(await (await signIn(ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
  });
});

describe('Google sign-in whose address Google has not verified', () => {
  it.each([0, 1] as const)(
    'joins no account and stores no address (existing account email_verified = %i)',
    async (emailVerified) => {
      await seed(emailVerified);
      const before = await account();
      const rowsBefore = await accessRows(UID);
      claims.email_verified = 'false';

      const res = await googleSignIn();
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(RETURN_TO);
      // The sign-in gets an account of its own, with no address on it.
      const who = await me(sessionFrom(res)!);
      expect(who.status).toBe(200);
      const created = (await who.json()) as { id: number; email: string | null };
      expect(created.id).not.toBe(UID);
      expect(created.email).toBeNull();

      // The account that has the address is as it was, and is the only one with it.
      expect(await account()).toEqual(before);
      expect(await accessRows(UID)).toEqual(rowsBefore);
      const { results } = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?')
        .bind(ADDRESS)
        .all();
      expect(results).toEqual([{ id: UID }]);
    }
  );
});
