import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { mintApiToken } from '../src/apitoken';

/*
 * The gates added with the tiered plans (docs/plans/billing-tiers.md). Before this, api-tokens,
 * the MCP server and scheduled imports carried no plan check at all, so a Free account could
 * drive the whole product from a script.
 */

const COOKIES: Record<string, string> = {};

const PROFILE: Record<string, number> = {};

beforeEach(async () => {
  // Children first: profiles hold a FK to users, so deleting users alone trips the constraint.
  await env.DB.prepare('DELETE FROM import_sources').run();
  await env.DB.prepare('DELETE FROM api_tokens').run();
  await env.DB.prepare('DELETE FROM profiles').run();
  await env.DB.prepare('DELETE FROM users').run();
  const users: Array<[number, string]> = [
    [91, 'free'],
    [92, 'basic'],
    [93, 'advanced'],
    [94, 'ultimate'],
  ];
  for (const [id, plan] of users) {
    await env.DB.prepare(
      'INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, ?, ?, 1, ?)'
    )
      .bind(id, `${plan}@example.com`, 'password', plan)
      .run();
    await env.DB.prepare('INSERT INTO profiles (id, name, user_id) VALUES (?, ?, ?)')
      .bind(id, `${plan} household`, id)
      .run();
    PROFILE[plan] = id;
    COOKIES[plan] = (await issueSessionCookie(id, 'password', env)).split(';')[0];
  }
});

const mint = (plan: string, name = 'test') =>
  SELF.fetch('https://example.com/api/account/api-tokens', {
    method: 'POST',
    headers: { Cookie: COOKIES[plan], 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, scopes: ['read'] }),
  });

describe('API access is a paid feature', () => {
  it('Free cannot mint a token', async () => {
    const res = await mint('free');
    expect(res.status).toBe(402);
  });

  it('Basic can', async () => {
    expect((await mint('basic')).status).toBe(201);
  });

  it('Basic is capped at two live tokens', async () => {
    expect((await mint('basic', 'one')).status).toBe(201);
    expect((await mint('basic', 'two')).status).toBe(201);
    const third = await mint('basic', 'three');
    expect(third.status).toBe(402);
    expect(await third.text()).toContain('2 API tokens');
  });

  it('a revoked token frees its slot, so rotating never needs an upgrade', async () => {
    const first = await mint('basic', 'one');
    const { id } = (await first.json()) as { id: string };
    expect((await mint('basic', 'two')).status).toBe(201);
    await SELF.fetch(`https://example.com/api/account/api-tokens/${id}`, {
      method: 'DELETE',
      headers: { Cookie: COOKIES.basic },
    });
    expect((await mint('basic', 'three')).status).toBe(201);
  });

  it('Ultimate is uncapped', async () => {
    for (let i = 0; i < 12; i++) expect((await mint('ultimate', `t${i}`)).status).toBe(201);
  });
});

describe('an existing token stops working when the plan lapses', () => {
  it('a token minted on Advanced is refused after a downgrade to Free', async () => {
    const minted = await mintApiToken(env.DB, 93, {
      name: 'cli',
      scopes: ['read'],
      defaultProfileId: null,
      expiresAt: null,
    });
    // /mcp is the one route behind requireToken, so it is where a bearer credential is proved.
    const call = () =>
      SELF.fetch('https://example.com/mcp', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${minted.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await call()).status).not.toBe(401);

    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = 93").run();
    // Checked on the token's own verify, not only at mint time — otherwise whatever was minted
    // while paying keeps working forever.
    expect((await call()).status).toBe(401);
  });
});

describe('scheduled imports are an Advanced feature', () => {
  const create = (plan: string, schedule: string) =>
    SELF.fetch(`https://example.com/api/import-sources?profileId=${PROFILE[plan]}`, {
      method: 'POST',
      headers: { Cookie: COOKIES[plan], 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'google_sheet', label: 'Bank', config: {}, schedule }),
    });

  it('Basic may keep a manual source', async () => {
    expect((await create('basic', 'manual')).status).toBe(201);
  });

  it('Basic may not put one on a daily schedule', async () => {
    const res = await create('basic', 'daily');
    expect(res.status).toBe(402);
    expect(await res.text()).toContain('Advanced');
  });

  it('Advanced may', async () => {
    expect((await create('advanced', 'daily')).status).toBe(201);
  });
});
