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
    cookie = await seed();
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
