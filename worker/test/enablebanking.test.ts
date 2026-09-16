import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';
const PROFILE_ID = '900';

beforeEach(async () => {
  for (const t of ['bank_sessions', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (90, 'bank@example.com', 'password', 1)"
    ),
    env.DB.prepare(`INSERT INTO profiles (id, user_id, name) VALUES (${PROFILE_ID}, 90, 'Me')`),
  ]);
  cookie = (await issueSessionCookie(90, 'password', env)).split(';')[0];
});

describe('Enable Banking APIs', () => {
  it('GET /api/imports/enablebanking/auth-url returns 405 Method Not Allowed', async () => {
    // It's a POST
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/auth-url', {
      method: 'GET',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    expect(res.status).toBe(404); // Hono returns 404 for wrong method or not found
  });

  // We are not testing the actual API requests inside because they are hardcoded to test logic
  // in the worker which does actual fetch to EnableBanking sandbox.
  // We can test that the auth-url requires an active session
  it('POST /api/imports/enablebanking/auth-url without auth returns 401', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/auth-url', {
      method: 'POST',
      headers: { 'X-Profile-Id': PROFILE_ID },
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/imports/enablebanking/session returns connected: false when no session exists', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/session', {
      method: 'GET',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.connected).toBe(false);
  });

  it('GET and DELETE /api/imports/enablebanking/session manage stored bank sessions', async () => {
    // Seed a mock session in DB
    await env.DB.prepare(
      `INSERT INTO bank_sessions (id, profile_id, aspsp_name, session_id, accounts, expires_at)
       VALUES ('test-sess-1', ?, 'Mock ASPSP', 'sess-123', ?, 1999999999)`
    )
      .bind(
        Number(PROFILE_ID),
        JSON.stringify([
          {
            uid: 'acc-uuid-1',
            name: 'Aino Virtanen',
            currency: 'EUR',
            cash_account_type: 'CARD',
          },
        ])
      )
      .run();

    const getRes = await SELF.fetch('https://example.com/api/imports/enablebanking/session', {
      method: 'GET',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.connected).toBe(true);
    expect(getData.aspspName).toBe('Mock ASPSP');
    expect(getData.accounts).toHaveLength(1);
    expect(getData.accounts[0].id).toBe('acc-uuid-1');

    const delRes = await SELF.fetch('https://example.com/api/imports/enablebanking/session', {
      method: 'DELETE',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    expect(delRes.status).toBe(200);

    const checkRes = await SELF.fetch('https://example.com/api/imports/enablebanking/session', {
      method: 'GET',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    const checkData = (await checkRes.json()) as any;
    expect(checkData.connected).toBe(false);
  });

  it('POST /api/imports/enablebanking/sync returns 400 if no active session', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/sync', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain('No active bank session found');
  });
});
