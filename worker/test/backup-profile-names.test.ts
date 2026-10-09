/**
 * Profile names are unique without regard to case, and this Worker took names that differ only
 * in case before the rule. A backup must restore: the later of two such names comes back as
 * "Name (2)", as it does in local-first (shared/profileSchema.ts).
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER_ID = 6540;
const CURRENT = 65400;
let cookie = '';

beforeEach(async () => {
  for (const t of ['settings', 'accounts', 'rate_limits', 'profiles']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'profile-names-backup@example.com', 'password', 1, 'advanced')"
    ).bind(USER_ID),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Current')").bind(
      CURRENT,
      USER_ID
    ),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function restore(profiles: { id: number; name: string }[]): Promise<Response> {
  return SELF.fetch('https://example.com/api/import', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(CURRENT),
    },
    body: JSON.stringify({
      version: '3.0.0',
      profiles: profiles.map((p) => ({ ...p, created_at: '2026-01-01' })),
      accounts: [{ id: 5, profile_id: 2, name: 'Joint', type: 'checking', currency: 'EUR' }],
    }),
  });
}

describe('profile names that differ only in case', () => {
  it('restore, the later one as "Name (2)", with its own data', async () => {
    const res = await restore([
      { id: 1, name: 'Me' },
      { id: 2, name: 'ME' },
      { id: 3, name: 'Me (2)' },
    ]);
    expect(res.status).toBe(200);
    const { results } = await env.DB.prepare(
      'SELECT id, name FROM profiles WHERE user_id = ? ORDER BY id'
    )
      .bind(USER_ID)
      .all<{ id: number; name: string }>();
    expect(results.map((p) => p.name)).toEqual(['Me', 'ME (3)', 'Me (2)']);
    const account = await env.DB.prepare(
      "SELECT profile_id FROM accounts WHERE name = 'Joint'"
    ).first<{ profile_id: number }>();
    expect(account?.profile_id).toBe(results[1]!.id);
  });

  it('still refuse a profile with no name', async () => {
    const res = await restore([
      { id: 1, name: 'Me' },
      { id: 2, name: ' ' },
    ]);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'profiles[1].name is required' });
  });
});
