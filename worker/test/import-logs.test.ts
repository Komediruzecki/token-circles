import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

// Import session log (migration 0014): the Import page records one row per successful
// import and lists past sessions. Rows are profile-scoped.

let cookie = '';

beforeEach(async () => {
  for (const t of ['import_logs', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (80, 'importlog@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (800, 80, 'Main')"),
  ]);
  cookie = (await sessionCookie(80, 'password', env)).split(';')[0];
});

describe('import logs', () => {
  it('records a session and lists it back', async () => {
    const post = await SELF.fetch('https://example.com/api/import-logs', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '800' },
      body: JSON.stringify({
        import_id: 'abc-123',
        source: 'statement.csv',
        imported: 42,
        duplicates_skipped: 3,
        accounts_created: 1,
        categories_created: 2,
        details: JSON.stringify({ created_accounts: ['Revolut'] }),
      }),
    });
    expect(post.status).toBe(201);

    const list = await SELF.fetch('https://example.com/api/import-logs', {
      headers: { Cookie: cookie, 'X-Profile-Id': '800' },
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('statement.csv');
    expect(rows[0].imported).toBe(42);
    expect(rows[0].duplicates_skipped).toBe(3);
    expect(JSON.parse(rows[0].details as string).created_accounts).toEqual(['Revolut']);
  });

  it('does not leak sessions across users', async () => {
    await SELF.fetch('https://example.com/api/import-logs', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '800' },
      body: JSON.stringify({ source: 'private.csv', imported: 1 }),
    });
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (81, 'other-import@example.com', 'password', 1)"
      ),
      env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (801, 81, 'Main')"),
    ]);
    const otherCookie = (await sessionCookie(81, 'password', env)).split(';')[0];
    const list = await SELF.fetch('https://example.com/api/import-logs', {
      headers: { Cookie: otherCookie, 'X-Profile-Id': '801' },
    });
    expect(await list.json()).toEqual([]);
  });
});
