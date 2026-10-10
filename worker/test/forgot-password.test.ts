/**
 * Forgot password, sent for real: the route mints a reset link, mails it, and the mailed link sets
 * a new password. The app's own tests mock this request, and the reset half of the flow is tested
 * elsewhere (concurrent-writes.test.ts) from a link the test plants itself, so nothing else follows
 * a link from the mail the Worker actually sends.
 *
 * RESEND_API_KEY is set and the call to Resend is caught here, so the mail can be read.
 *
 * On an account whose address was never confirmed, the link also removes every way in that was set
 * up before; a confirmed account keeps them.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';
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

const UID = 9300;
const EMAIL = 'forgetful@example.com';
/** An account with every kind of access set up on it (helpers/account-access.ts). */
const SEEDED = 6620;
const SEEDED_ADDRESS = 'household-reset@example.com';

const realFetch = globalThis.fetch;
let sent: Array<Record<string, unknown>>;

/** Each request comes back once the work its route does after the answer (the mail) is done. */
function post(path: string, body: unknown) {
  return fetchSettled(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** The reset token in a sent mail's link. */
function tokenIn(mail: Record<string, unknown>): string {
  const found = /#reset-password\?token=([A-Za-z0-9_-]+)/.exec(String(mail.text));
  expect(found, `a reset link in ${JSON.stringify(mail.text)}`).not.toBeNull();
  return found![1];
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function unusedLinks(): Promise<Array<{ token_hash: string; expires_at: string }>> {
  const { results } = await env.DB.prepare(
    'SELECT token_hash, expires_at FROM password_resets WHERE user_id = ? AND used_at IS NULL'
  )
    .bind(UID)
    .all<{ token_hash: string; expires_at: string }>();
  return results;
}

beforeEach(async () => {
  for (const table of ['password_resets', 'rate_limits', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare(
    "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 'password', 1, 1)"
  )
    .bind(UID, EMAIL, await hashPassword('the-old-password'))
    .run();

  (env as unknown as Record<string, string>).RESEND_API_KEY = 'rk_test';
  sent = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('api.resend.com')) {
      sent.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{"id":"re_1"}', { headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (env as unknown as Record<string, string>).RESEND_API_KEY;
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_reset_confirm').run();
  await removeAccounts(`SELECT ${SEEDED}`);
});

/** Ask for a reset link for `email`, and read its token from the mail. */
async function resetLinkFor(email: string): Promise<string> {
  const asked = await post('/api/auth/forgot-password', { email });
  expect(asked.status).toBe(200);
  return tokenIn(sent.at(-1)!);
}

/** The reset links as they were, each spent the way using one spends it. */
const spent = (links: AccessRows['password_resets']) =>
  links.map((row) => ({ ...row, used_at: expect.any(String) }));

describe('POST /api/auth/forgot-password', () => {
  it('mails a link to the address, and the link sets a new password', async () => {
    const asked = await post('/api/auth/forgot-password', { email: '  Forgetful@Example.com ' });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(EMAIL);
    const token = tokenIn(sent[0]);
    const links = await unusedLinks();
    expect(links.map((l) => l.token_hash)).toEqual([await sha256(token)]);
    // Good for two hours.
    const left = Date.parse(links[0].expires_at) - Date.now();
    expect(left).toBeGreaterThan(119 * 60_000);
    expect(left).toBeLessThanOrEqual(120 * 60_000);

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status, await reset.clone().text()).toBe(200);
    expect(await unusedLinks()).toEqual([]);
    const signIn = await post('/api/auth/login', { email: EMAIL, password: 'a-new-password' });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const old = await post('/api/auth/login', { email: EMAIL, password: 'the-old-password' });
    expect(old.status).toBe(401);
  });

  it('refuses a link once it has expired', async () => {
    await post('/api/auth/forgot-password', { email: EMAIL });
    const token = tokenIn(sent[0]);
    // An expiry that has passed, in the ISO 8601 shape the route writes. D1 keeps its own clock,
    // which vi.setSystemTime does not reach, so the expiry moves instead of the clock.
    await env.DB.prepare(
      "UPDATE password_resets SET expires_at = strftime('%Y-%m-%dT00:00:00.000Z', 'now') WHERE user_id = ?"
    )
      .bind(UID)
      .run();

    const checked = await SELF.fetch(`https://example.com/api/auth/reset-password?token=${token}`);
    expect(await checked.json()).toEqual({ valid: false });
    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status).toBe(400);
    const old = await post('/api/auth/login', { email: EMAIL, password: 'the-old-password' });
    expect(old.status).toBe(200);
  });

  it('a second request replaces the first link', async () => {
    await post('/api/auth/forgot-password', { email: EMAIL });
    await post('/api/auth/forgot-password', { email: EMAIL });
    expect(sent).toHaveLength(2);
    const [first, second] = sent.map(tokenIn);

    expect((await unusedLinks()).map((l) => l.token_hash)).toEqual([await sha256(second)]);
    const stale = await post('/api/auth/reset-password', {
      token: first,
      password: 'a-new-password',
    });
    expect(stale.status).toBe(400);
  });

  it('answers an address with no account the same, and mails nothing', async () => {
    const asked = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });
    expect(asked.status).toBe(200);
    expect(await asked.json()).toEqual({ ok: true });
    expect(sent).toEqual([]);
    const { results } = await env.DB.prepare('SELECT id FROM password_resets').all();
    expect(results).toEqual([]);
  });

  it('refuses something that is not an address', async () => {
    const asked = await post('/api/auth/forgot-password', { email: 'forgetful' });
    expect(asked.status).toBe(400);
    expect(sent).toEqual([]);
    expect(await unusedLinks()).toEqual([]);
  });
});

describe('a reset link for an account whose address was never confirmed', () => {
  it('removes every way in that was set up before, then sets the new password', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 0);
    // Each of them gets in beforehand.
    expect(await (await signIn(SEEDED_ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
    const token = await resetLinkFor(SEEDED_ADDRESS);

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status, await reset.clone().text()).toBe(200);
    // The answer says that something a reset would have kept was cleared, so the app can say what.
    expect(await reset.json()).toEqual({ ok: true, cleared: true });
    expect(await accountRow(SEEDED)).toMatchObject({
      password_hash: expect.any(String),
      email_verified: 1,
    });

    // Nothing set up before gets in any more.
    expect((await signIn(SEEDED_ADDRESS)).status).toBe(401);
    expect((await me(session)).status).toBe(401);
    expect((await callMcp(apiToken)).status).toBe(401);
    const rows = await accessRows(SEEDED);
    // The link just used stays, spent.
    expect(rows.password_resets).toEqual([
      expect.objectContaining({ token_hash: await sha256(token), used_at: expect.any(String) }),
    ]);
    for (const table of ACCESS_TABLES.filter((t) => t !== 'password_resets')) {
      expect(rows[table], table).toEqual([]);
    }

    // The new password signs in, with no second-factor step: the TOTP went with the rest.
    const signedIn = await signIn(SEEDED_ADDRESS, 'a-new-password');
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ id: SEEDED, email: SEEDED_ADDRESS });

    // The data stays.
    expect(await dataRows(SEEDED)).toEqual(seededData(SEEDED));
  });

  it('leaves the account as it was when any part of the change fails', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 0);
    const token = await resetLinkFor(SEEDED_ADDRESS);
    const before = await accountRow(SEEDED);
    const rowsBefore = await accessRows(SEEDED);
    // Confirming the address is the last write that touches it, so everything before has run when
    // it fails.
    await env.DB.prepare(
      `CREATE TRIGGER fail_reset_confirm BEFORE UPDATE OF email_verified ON users
       WHEN NEW.id = ${SEEDED}
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
    ).run();

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status).toBe(500);

    expect(await accountRow(SEEDED)).toEqual(before);
    // Only the link is spent: it is claimed before anything else is written.
    expect(await accessRows(SEEDED)).toEqual({
      ...rowsBefore,
      password_resets: spent(rowsBefore.password_resets),
    });
    expect(await (await signIn(SEEDED_ADDRESS)).json()).toEqual({ twofaRequired: true });
    expect((await me(session)).status).toBe(200);
    expect((await callMcp(apiToken)).status).toBe(200);
  });
});

describe('a reset link for an unconfirmed account with only a password and a session', () => {
  it('says nothing was cleared: a reset replaces the password and ends sessions anyway', async () => {
    await env.DB.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').bind(UID).run();
    const { sessionCookie } = await import('./helpers/session');
    await sessionCookie(UID, 'password', env);
    const token = await resetLinkFor(EMAIL);

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });

    expect(await reset.json()).toEqual({ ok: true });
    // The clearing ran all the same: the session is gone and the address is confirmed.
    expect(await accessRows(UID)).toMatchObject({ auth_sessions: [] });
    expect(await accountRow(UID)).toMatchObject({ email_verified: 1 });
  });
});

describe('a reset link for a confirmed account', () => {
  it('sets the new password and leaves every other way in as it was', async () => {
    const { session, apiToken } = await seedAccount(SEEDED, SEEDED_ADDRESS, 1);
    const token = await resetLinkFor(SEEDED_ADDRESS);
    const before = await accountRow(SEEDED);
    const rowsBefore = await accessRows(SEEDED);

    const reset = await post('/api/auth/reset-password', { token, password: 'a-new-password' });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ ok: true });

    const after = await accountRow(SEEDED);
    expect(after).toEqual({
      ...before,
      password_hash: expect.any(String),
      token_version: before!.token_version + 1,
    });
    expect(after!.password_hash).not.toBe(before!.password_hash);
    expect(await accessRows(SEEDED)).toEqual({
      ...rowsBefore,
      password_resets: spent(rowsBefore.password_resets),
    });
    // The new password signs in, and the account's own second factor still applies. Sessions end
    // with the reset, as they do on any account; the API token is not a session and keeps working.
    expect(await (await signIn(SEEDED_ADDRESS, 'a-new-password')).json()).toEqual({
      twofaRequired: true,
    });
    expect((await signIn(SEEDED_ADDRESS)).status).toBe(401);
    expect((await me(session)).status).toBe(401);
    expect((await callMcp(apiToken)).status).toBe(200);
  });
});
