/**
 * What DELETE /api/account removes beyond the profile data, checked against rows written the way
 * the app writes them.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth';

const PASSWORD = 'correct horse battery staple';
const OWNER = { id: 9400, email: 'leaving@example.com', profile: 94000 };
const OTHER = { id: 9401, email: 'staying@example.com', profile: 94010 };

const login = (email: string, password: string) =>
  SELF.fetch('https://api.example.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

/** Signs in through the real route and returns the session's `name=value` pair. */
async function signIn(email: string): Promise<string> {
  const res = await login(email, PASSWORD);
  expect(res.status).toBe(200);
  return res.headers.get('Set-Cookie')!.split(';')[0]!;
}

const deleteAccount = (cookie: string) =>
  SELF.fetch('https://api.example.com/api/account', {
    method: 'DELETE',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'delete' }),
  });

const count = async (sql: string, ...args: unknown[]) =>
  (await env.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n;

beforeEach(async () => {
  for (const t of ['auth_sessions', 'auth_logs', 'rate_limits', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  const hash = await hashPassword(PASSWORD);
  for (const u of [OWNER, OTHER]) {
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, auth_provider, email_verified, token_version) VALUES (?, ?, ?, 'password', 1, 1)"
    )
      .bind(u.id, u.email, hash)
      .run();
    await env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)')
      .bind(u.profile, u.id, 'Main')
      .run();
  }
});

describe('deleting an account', () => {
  it('deletes its sign-in history: its own rows and the attempts at its address', async () => {
    // A wrong password typed with stray case and spaces is stored the way authlog.ts keeps every
    // address: trimmed and lower case, with no user id.
    expect((await login('  Leaving@Example.com ', 'wrong')).status).toBe(401);
    const cookie = await signIn(OWNER.email);
    expect((await login(OTHER.email, 'wrong')).status).toBe(401);
    await signIn(OTHER.email);

    expect(
      await count(
        'SELECT COUNT(*) AS n FROM auth_logs WHERE user_id IS NULL AND email = ?',
        OWNER.email
      )
    ).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM auth_logs WHERE user_id = ?', OWNER.id)).toBe(1);
    const othersBefore = await count(
      'SELECT COUNT(*) AS n FROM auth_logs WHERE user_id = ? OR email = ?',
      OTHER.id,
      OTHER.email
    );
    expect(othersBefore).toBe(2);

    expect((await deleteAccount(cookie)).status).toBe(200);

    expect(
      await count(
        'SELECT COUNT(*) AS n FROM auth_logs WHERE user_id = ? OR email = ?',
        OWNER.id,
        OWNER.email
      )
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM auth_logs WHERE user_id = ? OR email = ?',
        OTHER.id,
        OTHER.email
      )
    ).toBe(othersBefore);
  });
});
