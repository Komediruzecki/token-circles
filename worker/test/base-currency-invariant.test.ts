import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of [
    'transactions',
    'account_balance_history',
    'accounts',
    'settings',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (90, 'currency@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (900, 90, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(90, 'password', env)).split(';')[0];
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '900',
      ...((init.headers as Record<string, string>) || {}),
    },
  });
}

async function putSettings(currency: string): Promise<Response> {
  return api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ currency }),
  });
}

async function createAccount(name: string, currency: string, balance: number): Promise<Response> {
  return api('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({
      name,
      type: 'giro',
      currency,
      balance,
      starting_balance: balance,
    }),
  });
}

describe('Worker account balance currency invariant', () => {
  it('rejects mismatched account units and locks the profile base after data exists', async () => {
    expect((await putSettings('EUR')).status).toBe(200);
    expect((await createAccount('Dollar account', 'USD', 100)).status).toBe(409);
    expect((await createAccount('Current', 'EUR', 100)).status).toBe(200);
    expect((await putSettings('USD')).status).toBe(409);

    const rows = await env.DB.prepare(
      'SELECT currency, balance, starting_balance FROM accounts WHERE profile_id = 900'
    ).all<{ currency: string; balance: number; starting_balance: number }>();
    expect(rows.results).toEqual([{ currency: 'EUR', balance: 100, starting_balance: 100 }]);
  });

  it('keeps both legs of a transfer in the same base-currency unit', async () => {
    expect((await putSettings('EUR')).status).toBe(200);
    const source = (await (await createAccount('Current', 'EUR', 100)).json()) as {
      id: number;
    };
    const destination = (await (await createAccount('Savings', 'EUR', 0)).json()) as {
      id: number;
    };

    const transfer = await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Move funds',
        amount: 750,
        amount_local: 100,
        currency: 'HRK',
        type: 'transfer',
        date: '2026-01-02',
        account_id: source.id,
        transfer_account_id: destination.id,
      }),
    });
    expect(transfer.status).toBe(200);

    const balances = await env.DB.prepare(
      'SELECT name, balance, currency FROM accounts WHERE profile_id = 900 ORDER BY name'
    ).all<{ name: string; balance: number; currency: string }>();
    expect(balances.results).toEqual([
      { name: 'Current', balance: 0, currency: 'EUR' },
      { name: 'Savings', balance: 100, currency: 'EUR' },
    ]);
  });

  it('uses the first explicit setting to adopt legacy balance labels', async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO accounts (name, type, currency, balance, starting_balance, profile_id) VALUES ('One', 'giro', 'EUR', 100, 100, 900)"
      ),
      env.DB.prepare(
        "INSERT INTO accounts (name, type, currency, balance, starting_balance, profile_id) VALUES ('Two', 'giro', 'USD', 200, 200, 900)"
      ),
    ]);

    expect((await putSettings('CHF')).status).toBe(200);
    const rows = await env.DB.prepare(
      'SELECT DISTINCT currency FROM accounts WHERE profile_id = 900'
    ).all<{ currency: string }>();
    expect(rows.results).toEqual([{ currency: 'CHF' }]);
  });

  it('returns the profile base currency instead of a global fallback', async () => {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'USD', NULL)"
    ).run();
    expect((await putSettings('EUR')).status).toBe(200);

    const response = await api('/api/settings');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { currency: string }).currency).toBe('EUR');
  });

  it('does not mutate settings during an import preview', async () => {
    const preview = await api('/api/import/execute', {
      method: 'POST',
      body: JSON.stringify({
        rows: [['2026-01-01', 'Opening', '100', 'Savings']],
        mapping: { date: 0, description: 1, amount: 2, category: 3 },
        categoryTypes: { Savings: 'account' },
        defaultCurrency: 'CHF',
        dry_run: true,
      }),
    });
    expect(preview.status).toBe(200);
    const setting = await env.DB.prepare(
      "SELECT value FROM settings WHERE profile_id = 900 AND key = 'currency'"
    ).first();
    expect(setting).toBeNull();
  });
});
