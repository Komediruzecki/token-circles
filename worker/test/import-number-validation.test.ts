import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const table of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (96, 'numbers@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (960, 96, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(96, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': '960',
    },
    body: JSON.stringify(body),
  });
}

describe('Worker import numeric validation', () => {
  it('parses every financial field with the same strict locale rules', async () => {
    const response = await execute({
      rows: [
        {
          date: '2026-01-01',
          description: 'Opening',
          amount: '2.468,13',
          category: 'Savings',
          amount_local: '1 234,56',
          exchange_rate: '7,53',
        },
      ],
      mapping: {
        date: 'date',
        description: 'description',
        amount: 'amount',
        category: 'category',
        amount_local: 'amount_local',
        exchange_rate: 'exchange_rate',
      },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '2,468.13' },
    });
    expect(response.status).toBe(200);

    const transaction = await env.DB.prepare(
      'SELECT amount, amount_local, exchange_rate FROM transactions WHERE profile_id = 960'
    ).first<{ amount: number; amount_local: number; exchange_rate: number }>();
    const account = await env.DB.prepare(
      'SELECT starting_balance FROM accounts WHERE profile_id = 960'
    ).first<{ starting_balance: number }>();
    expect(transaction?.amount).toBeCloseTo(2468.13, 2);
    expect(transaction?.amount_local).toBeCloseTo(1234.56, 2);
    expect(transaction?.exchange_rate).toBeCloseTo(7.53, 2);
    expect(account?.starting_balance).toBeCloseTo(2468.13, 2);
  });

  it('reports invalid secondary fields with original row indices', async () => {
    const response = await execute({
      rows: [
        {
          date: '2026-01-01',
          description: 'Bad local',
          amount: '10.00',
          amount_local: '1,234',
          exchange_rate: '1.00',
        },
        {
          date: '2026-01-02',
          description: 'Bad rate',
          amount: '20.00',
          amount_local: '20.00',
          exchange_rate: 'abc',
        },
      ],
      mapping: {
        date: 'date',
        description: 'description',
        amount: 'amount',
        amount_local: 'amount_local',
        exchange_rate: 'exchange_rate',
      },
      dry_run: true,
    });
    const body = (await response.json()) as {
      imported: number;
      skipped_items: Array<{ index: number; reason: string; label?: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.imported).toBe(0);
    // Indices still identify the original rows; the reason no longer repeats the row number the
    // UI already prints, and each rejection now quotes the row's date and description.
    expect(body.skipped_items).toEqual([
      {
        index: 0,
        reason: 'Could not read amount_local — check the number format',
        label: '2026-01-01 · Bad local',
      },
      {
        index: 1,
        reason: 'Could not read exchange_rate — check the number format',
        label: '2026-01-02 · Bad rate',
      },
    ]);
  });

  it('rejects an ambiguous opening balance before any account write', async () => {
    const response = await execute({
      rows: [
        {
          date: '2026-01-01',
          description: 'Opening',
          amount: '10.00',
          category: 'Savings',
        },
      ],
      mapping: {
        date: 'date',
        description: 'description',
        amount: 'amount',
        category: 'category',
      },
      categoryTypes: { Savings: 'account' },
      accountBalances: { Savings: '1,234' },
    });
    expect(response.status).toBe(422);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM accounts WHERE profile_id = 960'
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});
