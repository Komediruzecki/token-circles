/**
 * Personal access tokens: the table, the mint/verify round trip, scope enforcement, and the
 * guard that keeps bearer auth off the cookie-authed routes.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { mintApiToken, verifyApiToken, TOKEN_PREFIX } from '../src/apitoken';

async function seedUser(id: number): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(id, `u${id}@example.com`)
    .run();
}

describe('api_tokens schema', () => {
  it('has the columns the token module needs', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(api_tokens)').all<{ name: string }>();
    const names = (cols.results ?? []).map((r) => r.name).sort();
    expect(names).toEqual(
      [
        'created_at',
        'default_profile_id',
        'expires_at',
        'hint',
        'id',
        'last_used_at',
        'name',
        'revoked_at',
        'scopes',
        'token_hash',
        'user_id',
      ].sort()
    );
  });

  it('rejects a duplicate token_hash', async () => {
    // The user FK is real, so a token row needs an owner before it can exist at all.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (1, 'dup@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    const row = (id: string) =>
      env.DB.prepare(
        "INSERT INTO api_tokens (id, user_id, name, token_hash, hint, scopes) VALUES (?, 1, 'n', 'samehash', 'abcd1234', '[\"read\"]')"
      )
        .bind(id)
        .run();
    await row('dup-a');
    await expect(row('dup-b')).rejects.toThrow();
  });
});

describe('mint and verify', () => {
  it('mints a prefixed secret and verifies it back to the user', async () => {
    await seedUser(9001);
    const minted = await mintApiToken(env.DB, 9001, {
      name: 'routine',
      scopes: ['read', 'import'],
    });
    expect(minted.secret.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(minted.hint).toHaveLength(8);

    const identity = await verifyApiToken(env.DB, minted.secret);
    expect(identity).toEqual({
      tokenId: minted.id,
      userId: 9001,
      scopes: ['read', 'import'],
      defaultProfileId: null,
    });
  });

  it('never stores the raw secret', async () => {
    await seedUser(9002);
    const minted = await mintApiToken(env.DB, 9002, { name: 'r', scopes: ['read'] });
    const row = await env.DB.prepare('SELECT * FROM api_tokens WHERE id = ?')
      .bind(minted.id)
      .first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(minted.secret.slice(TOKEN_PREFIX.length));
  });

  it('rejects an unknown, revoked or expired secret', async () => {
    await seedUser(9003);
    expect(await verifyApiToken(env.DB, `${TOKEN_PREFIX}not-a-real-token`)).toBeNull();

    const revoked = await mintApiToken(env.DB, 9003, { name: 'r', scopes: ['read'] });
    await env.DB.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?")
      .bind(revoked.id)
      .run();
    expect(await verifyApiToken(env.DB, revoked.secret)).toBeNull();

    const expired = await mintApiToken(env.DB, 9003, {
      name: 'e',
      scopes: ['read'],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await verifyApiToken(env.DB, expired.secret)).toBeNull();
  });

  it('survives a token_version bump, because signing out a laptop is not revoking a routine', async () => {
    await seedUser(9004);
    const minted = await mintApiToken(env.DB, 9004, { name: 'r', scopes: ['read'] });
    await env.DB.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
      .bind(9004)
      .run();
    expect(await verifyApiToken(env.DB, minted.secret)).not.toBeNull();
  });

  it('touches last_used_at at most once per window', async () => {
    await seedUser(9005);
    const minted = await mintApiToken(env.DB, 9005, { name: 'r', scopes: ['read'] });
    await verifyApiToken(env.DB, minted.secret);
    const first = await env.DB.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?')
      .bind(minted.id)
      .first<{ last_used_at: string | null }>();
    expect(first?.last_used_at).not.toBeNull();

    await verifyApiToken(env.DB, minted.secret);
    const second = await env.DB.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?')
      .bind(minted.id)
      .first<{ last_used_at: string | null }>();
    expect(second?.last_used_at).toBe(first?.last_used_at);
  });
});

const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

describe('requireToken', () => {
  it('401s /mcp without a token and 405s a GET', async () => {
    const anon = await SELF.fetch('https://api.example.com/mcp', { method: 'POST', body: '{}' });
    expect(anon.status).toBe(401);
    const get = await SELF.fetch('https://api.example.com/mcp');
    expect(get.status).toBe(405);
  });

  it('GUARD: a valid bearer token is NOT accepted on the cookie-authed routes', async () => {
    // authenticateRequest must stay cookie-only. If someone teaches it to read the Authorization
    // header, every route module -- billing, account deletion, /api/export wipe -- becomes
    // token-reachable at once, and so does every route added afterwards. This test is the tripwire.
    await seedUser(9010);
    const minted = await mintApiToken(env.DB, 9010, { name: 'r', scopes: ['read', 'write'] });
    for (const path of ['/api/transactions', '/api/accounts', '/api/billing/status']) {
      const res = await SELF.fetch(`https://api.example.com${path}`, {
        headers: bearer(minted.secret),
      });
      expect([401, 405], `${path} accepted a bearer token`).toContain(res.status);
    }
  });
});
