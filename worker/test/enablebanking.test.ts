import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { EnableBankingClient } from '../src/enableBankingClient';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Enable Banking APIs', () => {
  it('GET /api/imports/enablebanking/auth-url returns 404 (POST-only route)', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/auth-url', {
      method: 'GET',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID },
    });
    expect(res.status).toBe(404); // Hono returns 404 for wrong method or not found
  });

  it('POST /api/imports/enablebanking/auth-url without auth returns 401', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/auth-url', {
      method: 'POST',
      headers: { 'X-Profile-Id': PROFILE_ID },
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/imports/enablebanking/auth-url initiates authorization', async () => {
    const mockClient = {
      startAuthorization: vi.fn().mockResolvedValue({
        url: 'https://auth.enablebanking.com/something',
      }),
    };
    vi.spyOn(EnableBankingClient, 'create').mockResolvedValue(mockClient as any);

    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/auth-url', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aspspName: 'Mock ASPSP',
        redirectUri: 'https://app.example.com/callback',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.url).toBe('https://auth.enablebanking.com/something');
    expect(mockClient.startAuthorization).toHaveBeenCalledWith(
      'Mock ASPSP',
      'https://app.example.com/callback',
      PROFILE_ID
    );
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

  it('POST /api/imports/enablebanking/transactions returns 400 if no active session', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain('No active session found');
  });

  it('POST /api/imports/enablebanking/transactions syncs using active DB session', async () => {
    await env.DB.prepare(
      `INSERT INTO bank_sessions (id, profile_id, aspsp_name, session_id, accounts, expires_at)
       VALUES ('test-sess-1', ?, 'Mock ASPSP', 'sess-123', ?, 1999999999)`
    )
      .bind(
        Number(PROFILE_ID),
        JSON.stringify([{ resource_id: 'acc-uuid-1', name: 'Aino Virtanen' }])
      )
      .run();

    const mockClient = {
      getTransactions: vi.fn().mockResolvedValue({ transactions: [{ id: 'tx-1', amount: 10 }] }),
      getBalances: vi.fn().mockResolvedValue({ balances: [{ amount: 100 }] }),
    };
    vi.spyOn(EnableBankingClient, 'create').mockResolvedValue(mockClient as any);

    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0].transactions).toHaveLength(1);
    expect(data.accounts[0].balances).toHaveLength(1);
    expect(mockClient.getTransactions).toHaveBeenCalledWith('acc-uuid-1', undefined, undefined);
  });

  it('POST /api/imports/enablebanking/callback rejects missing or invalid state (CSRF protection)', async () => {
    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/callback', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'auth-code-123', state: 'wrong-state' }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toBe('Invalid state parameter');
  });

  it('POST /api/imports/enablebanking/callback handles ISO string valid_until and persists to DB', async () => {
    const isoDate = '2026-12-16T12:00:00.000Z';
    const expectedExpiresAt = Math.floor(Date.parse(isoDate) / 1000);

    const mockClient = {
      authorizeSession: vi.fn().mockResolvedValue({
        session_id: 'test-session-id-iso',
        valid_until: isoDate,
        accounts: [
          {
            resource_id: '587a6215-b30b-4d37-a344-1dda3ad11dc4',
            name: 'Aino Virtanen',
            currency: 'EUR',
            cash_account_type: 'CARD',
          },
        ],
      }),
    };
    vi.spyOn(EnableBankingClient, 'create').mockResolvedValue(mockClient as any);

    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/callback', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'auth-code-123', state: PROFILE_ID }),
    });

    const text = await res.text();
    if (res.status !== 200) console.error('CALLBACK ERROR:', text);
    expect(res.status).toBe(200);
    const data = JSON.parse(text) as any;
    expect(data.success).toBe(true);
    expect(data.session_id).toBe('test-session-id-iso');
    expect(data.accounts).toHaveLength(1);

    const row = await env.DB.prepare(
      'SELECT session_id, accounts, expires_at FROM bank_sessions WHERE profile_id = ?'
    )
      .bind(Number(PROFILE_ID))
      .first<{ session_id: string; accounts: string; expires_at: number }>();

    expect(row).not.toBeNull();
    expect(row?.session_id).toBe('test-session-id-iso');
    expect(row?.expires_at).toBe(expectedExpiresAt);
  });

  it('POST /api/imports/enablebanking/callback handles nested access.valid_until date', async () => {
    const mockClient = {
      authorizeSession: vi.fn().mockResolvedValue({
        session_id: 'test-session-nested',
        access: {
          valid_until: '2026-11-15T10:00:00.000Z',
        },
        accounts: [],
      }),
    };
    vi.spyOn(EnableBankingClient, 'create').mockResolvedValue(mockClient as any);

    const res = await SELF.fetch('https://example.com/api/imports/enablebanking/callback', {
      method: 'POST',
      headers: { Cookie: cookie, 'X-Profile-Id': PROFILE_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'auth-code-nested', state: PROFILE_ID }),
    });

    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT session_id, expires_at FROM bank_sessions WHERE profile_id = ?'
    )
      .bind(Number(PROFILE_ID))
      .first<{ session_id: string; expires_at: number }>();

    expect(row?.session_id).toBe('test-session-nested');
    expect(row?.expires_at).toBe(Math.floor(Date.parse('2026-11-15T10:00:00.000Z') / 1000));
  });
});
