/**
 * Minting is cookie-authed, never token-authed: a leaked API token must not be able to mint
 * more tokens. The secret is returned exactly once, and listings never contain it.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { mintApiToken } from '../src/apitoken';

const USER_ID = 9100;

async function seed(): Promise<string> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'tok@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  // issueSessionCookie returns the whole Set-Cookie header; the request wants just the pair.
  return (await issueSessionCookie(USER_ID, 'password', env as never)).split(';')[0]!;
}

describe('token management endpoints', () => {
  let cookie = '';
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM api_tokens WHERE user_id = ?').bind(USER_ID).run();
    await env.DB.prepare('DELETE FROM rate_limits').run();
    cookie = await seed();
  });

  const mint = (body: Record<string, unknown>) =>
    SELF.fetch('https://api.example.com/api/account/api-tokens', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('mints once, lists without the secret, and revokes', async () => {
    const created = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'drive routine', scopes: ['read', 'import'] }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; secret: string; hint: string };
    expect(body.secret).toMatch(/^tc_pat_/);

    const listed = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      headers: { Cookie: cookie },
    });
    const list = (await listed.json()) as { tokens: Record<string, unknown>[] };
    expect(list.tokens).toHaveLength(1);
    expect(JSON.stringify(list.tokens)).not.toContain(body.secret);
    expect(list.tokens[0]).toMatchObject({ id: body.id, name: 'drive routine', hint: body.hint });

    const revoked = await SELF.fetch(`https://api.example.com/api/account/api-tokens/${body.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(revoked.status).toBe(200);
    const after = await env.DB.prepare('SELECT revoked_at FROM api_tokens WHERE id = ?')
      .bind(body.id)
      .first<{ revoked_at: string | null }>();
    expect(after?.revoked_at).not.toBeNull();
  });

  it('lists scopes as an array, not a JSON-encoded string', async () => {
    // They are stored stringified (apitoken.ts), and passing that straight back would make the
    // client JSON.parse a field of an already-parsed response.
    await mintApiToken(env.DB, USER_ID, { name: 'three', scopes: ['read', 'write', 'import'] });
    const listed = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      headers: { Cookie: cookie },
    });
    const list = (await listed.json()) as { tokens: { scopes: unknown }[] };
    expect(list.tokens[0]!.scopes).toEqual(['read', 'write', 'import']);
  });

  it('refuses an expiry that is not a real future date', async () => {
    // verifyApiToken compares getTime() <= now, and NaN fails that comparison — an unparseable
    // expiry would otherwise mint a token that never expires while the listing shows one.
    expect((await mint({ name: 'n', scopes: ['read'], expiresAt: '30d' })).status).toBe(422);
    expect(
      (await mint({ name: 'n', scopes: ['read'], expiresAt: '2020-01-01T00:00:00Z' })).status
    ).toBe(422);

    const ok = await mint({ name: 'n', scopes: ['read'], expiresAt: '2033-01-01T00:00:00Z' });
    expect(ok.status).toBe(201);
    const listed = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      headers: { Cookie: cookie },
    });
    const list = (await listed.json()) as { tokens: { expires_at: string | null }[] };
    expect(list.tokens[0]!.expires_at).toContain('2033-01-01');
  });

  it('rate-limits minting like every other credential-issuing route', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await mint({ name: `t${i}`, scopes: ['read'] })).status).toBe(201);
    }
    expect((await mint({ name: 'one too many', scopes: ['read'] })).status).toBe(429);
  });

  it('degrades a non-JSON scopes row to no scopes instead of failing the listing', async () => {
    // A row written by hand (or by a future storage change) must not 500 the whole panel.
    await env.DB.prepare(
      "INSERT INTO api_tokens (id, user_id, name, token_hash, hint, scopes) VALUES ('raw-1', ?, 'legacy', 'hash-raw-1', 'aaaaaaaa', 'read,write')"
    )
      .bind(USER_ID)
      .run();
    const listed = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      headers: { Cookie: cookie },
    });
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as { tokens: { id: string; scopes: unknown }[] };
    expect(list.tokens.find((t) => t.id === 'raw-1')!.scopes).toEqual([]);
  });

  it('revoking twice succeeds both times and keeps the first timestamp', async () => {
    // Two tabs, or a retry after a flaky refresh: the second revoke of a dead token is not an
    // error worth alarming the user with — the token is in exactly the state they asked for.
    const created = (await (await mint({ name: 'd', scopes: ['read'] })).json()) as { id: string };
    const first = await SELF.fetch(`https://api.example.com/api/account/api-tokens/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(first.status).toBe(200);
    const stamp = (
      await env.DB.prepare('SELECT revoked_at FROM api_tokens WHERE id = ?')
        .bind(created.id)
        .first<{ revoked_at: string }>()
    )?.revoked_at;

    const second = await SELF.fetch(
      `https://api.example.com/api/account/api-tokens/${created.id}`,
      { method: 'DELETE', headers: { Cookie: cookie } }
    );
    expect(second.status).toBe(200);
    const after = await env.DB.prepare('SELECT revoked_at FROM api_tokens WHERE id = ?')
      .bind(created.id)
      .first<{ revoked_at: string }>();
    expect(after?.revoked_at).toBe(stamp);
  });

  it('account deletion removes the tokens explicitly, not via cascade', async () => {
    // account.ts states FK cascade is not relied on; api_tokens must be in the delete batch.
    await mintApiToken(env.DB, USER_ID, { name: 'doomed', scopes: ['read'] });
    const res = await SELF.fetch('https://api.example.com/api/account', {
      method: 'DELETE',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'tok@example.com' }),
    });
    expect(res.status).toBe(200);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ?')
      .bind(USER_ID)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('refuses to mint without a cookie, even with a valid bearer token', async () => {
    const minted = await mintApiToken(env.DB, USER_ID, { name: 'x', scopes: ['read', 'write'] });
    const res = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      method: 'POST',
      headers: { Authorization: `Bearer ${minted.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'escalated', scopes: ['write'] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown scope and will not revoke another user's token", async () => {
    const bad = await SELF.fetch('https://api.example.com/api/account/api-tokens', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'n', scopes: ['admin'] }),
    });
    expect(bad.status).toBe(422);

    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (9101, 'other@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    const theirs = await mintApiToken(env.DB, 9101, { name: 'theirs', scopes: ['read'] });
    const res = await SELF.fetch(`https://api.example.com/api/account/api-tokens/${theirs.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
    const still = await env.DB.prepare('SELECT revoked_at FROM api_tokens WHERE id = ?')
      .bind(theirs.id)
      .first<{ revoked_at: string | null }>();
    expect(still?.revoked_at).toBeNull();
  });
});
