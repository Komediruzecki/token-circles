import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { issueSessionCookie } from '../src/auth';

const USER = 91;
const CURRENT = 910;
const HOUSEHOLD = 920;
let cookie = '';

beforeEach(async () => {
  for (const table of [
    'category_mappings',
    'recurring_transactions',
    'bills',
    'budgets',
    'savings_goals',
    'transactions',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'owner@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?), (?, ?, ?)').bind(
      CURRENT,
      USER,
      'Current',
      HOUSEHOLD,
      USER,
      'Household'
    ),
    env.DB.prepare(
      `INSERT INTO accounts
         (id, profile_id, name, type, currency, balance, starting_balance)
       VALUES (911, ?, 'Current account', 'giro', 'EUR', 1000, 1000),
              (922, ?, 'Household account', 'giro', 'EUR', 500, 500)`
    ).bind(CURRENT, HOUSEHOLD),
    env.DB.prepare(
      `INSERT INTO categories (id, profile_id, name, type)
       VALUES (9111, ?, 'Current category', 'expense'),
              (9222, ?, 'Household category', 'expense')`
    ).bind(CURRENT, HOUSEHOLD),
    env.DB.prepare(
      `INSERT INTO transactions
         (id, profile_id, description, amount, type, account_id, category_id, date)
       VALUES (91001, ?, 'Current row', 10, 'expense', 911, 9111, '2026-01-01'),
              (92002, ?, 'Household row', 20, 'expense', 922, 9222, '2026-01-01')`
    ).bind(CURRENT, HOUSEHOLD),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(CURRENT),
      'X-Profile-Ids': JSON.stringify([CURRENT, HOUSEHOLD]),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

const post = (path: string, body: unknown) =>
  api(path, { method: 'POST', body: JSON.stringify(body) });

describe('Worker profile-link integrity', () => {
  it('rejects cross-profile transaction links and leaves both balances untouched', async () => {
    const foreignAccount = await post('/api/transactions', {
      description: 'Cross account',
      amount: 100,
      type: 'expense',
      account_id: 922,
      category_id: 9111,
    });
    expect(foreignAccount.status).toBe(403);
    const foreignCategory = await post('/api/transactions', {
      description: 'Cross category',
      amount: 100,
      type: 'expense',
      account_id: 911,
      category_id: 9222,
    });
    expect(foreignCategory.status).toBe(403);
    const balances = await env.DB.prepare(
      'SELECT id, balance FROM accounts WHERE id IN (911, 922) ORDER BY id'
    ).all<{ id: number; balance: number }>();
    expect(balances.results).toEqual([
      { id: 911, balance: 1000 },
      { id: 922, balance: 500 },
    ]);
  });

  it('does not resolve a household account name into a current-profile transaction or import', async () => {
    const direct = await post('/api/transactions', {
      description: 'Stale name',
      amount: 20,
      type: 'expense',
      means_of_payment: 'Household account',
      category_id: 9111,
    });
    expect(direct.status).toBe(200);
    const directRow = await env.DB.prepare(
      "SELECT account_id FROM transactions WHERE description = 'Stale name'"
    ).first<{ account_id: number | null }>();
    expect(directRow?.account_id).toBeNull();

    const imported = await post('/api/import/execute', {
      rows: [['Imported stale name', '20', 'Household account', 'expense']],
      mapping: { description: 0, amount: 1, means_of_payment: 2, type: 3 },
    });
    expect(imported.status).toBe(200);
    const importRow = await env.DB.prepare(
      "SELECT profile_id, account_id FROM transactions WHERE description = 'Imported stale name'"
    ).first<{ profile_id: number; account_id: number | null }>();
    expect(importRow).toEqual({ profile_id: CURRENT, account_id: null });
    const foreignBalance = await env.DB.prepare(
      'SELECT balance FROM accounts WHERE id = 922'
    ).first<{ balance: number }>();
    expect(foreignBalance?.balance).toBe(500);
  });

  it('limits bulk mutation to the active write profile even when household reads are selected', async () => {
    const result = await api('/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({
        ids: [91001, 92002],
        action: 'update',
        data: { description: 'Bulk changed' },
      }),
    });
    expect(result.status).toBe(200);
    expect((await result.json()) as { updated: number }).toEqual({ ok: true, updated: 1 });
    const rows = await env.DB.prepare(
      'SELECT id, description FROM transactions WHERE id IN (91001, 92002) ORDER BY id'
    ).all<{ id: number; description: string }>();
    expect(rows.results).toEqual([
      { id: 91001, description: 'Bulk changed' },
      { id: 92002, description: 'Household row' },
    ]);
  });

  it('rejects foreign category/account links in dependent resources', async () => {
    expect(
      (
        await post('/api/bills', {
          name: 'Bill',
          amount: 10,
          dueDate: '2026-02-01',
          category_id: 9222,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post('/api/recurring', {
          description: 'Recurring',
          amount: 10,
          type: 'expense',
          account_id: 922,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post('/api/budgets', {
          amount: 100,
          category_id: 9222,
          period: 'monthly',
          start_date: '2026-01-01',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post('/api/savings-goals', {
          name: 'Goal',
          target_amount: 100,
          category_id: 9222,
        })
      ).status
    ).toBe(403);
    expect(
      (
        await post('/api/categories/mappings', {
          pattern: 'merchant',
          category_id: 9222,
        })
      ).status
    ).toBe(403);
  });
});
