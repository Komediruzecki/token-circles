/**
 * Audit B3: a write (POST/PUT/PATCH/DELETE) that names an X-Profile-Id the user does NOT own is
 * rejected with 403 instead of silently landing in the user's first profile; a read with the same
 * header still falls back gracefully. Real worker in workerd via Miniflare.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (1, 'me@example.com', 'password', 1), (2, 'other@example.com', 'password', 1)"
    ),
    // Profile 10 belongs to the caller (user 1); profile 20 belongs to user 2.
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id) VALUES (10, 'Mine', 1), (20, 'Theirs', 2)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (100, 'Checking', 'giro', 1000, 1000, 10)"
    ),
  ]);
  cookie = (await issueSessionCookie(1, 'password', env)).split(';')[0];
});

function req(path: string, profileId: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': profileId,
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

const newTx = () =>
  JSON.stringify({ description: 'x', amount: 5, type: 'expense', account_id: 100 });

describe('profile-fallback hard-error on writes (audit B3)', () => {
  it('rejects a write with an unowned X-Profile-Id (403)', async () => {
    const res = await req('/api/transactions', '20', { method: 'POST', body: newTx() });
    expect(res.status).toBe(403);
  });

  it('rejects a write with a malformed X-Profile-Id (403)', async () => {
    const res = await req('/api/transactions', 'not-a-number', { method: 'POST', body: newTx() });
    expect(res.status).toBe(403);
  });

  it('allows a write with an owned X-Profile-Id', async () => {
    const res = await req('/api/transactions', '10', { method: 'POST', body: newTx() });
    expect(res.status).toBe(200);
  });

  it('still falls back gracefully on a READ with an unowned X-Profile-Id', async () => {
    const res = await req('/api/transactions', '20', { method: 'GET' });
    expect(res.status).toBe(200); // falls back to the user's own profile, not a 403
  });
});
