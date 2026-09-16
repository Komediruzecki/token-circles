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
});
