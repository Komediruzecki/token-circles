/**
 * The import balance recompute (worker/src/routes/imports.ts, POST /api/import/execute)
 * must mirror the serverless computeBalanceDeltas: an income row with BOTH an
 * account_id (from Means of Payment) and a transfer_account_id (from an
 * account-typed Category) is credited ONLY to account_id. The old recompute
 * credited transfer_account_id too (its inTransfer query matched
 * type IN ('income','transfer')), double-crediting the income across two accounts.
 *
 * Runs against the real worker in workerd via Miniflare (D1 from worker/migrations/).
 * Worker deps can't install in the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (90, 'imp@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (900, 90, 'Main')"),
  ]);
  cookie = (await issueSessionCookie(90, 'password', env)).split(';')[0];
});

async function balanceOf(name: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT balance FROM accounts WHERE name = ? AND profile_id = 900'
  )
    .bind(name)
    .first<{ balance: number }>();
  return row?.balance ?? NaN;
}

describe('import balance recompute — no double-credit', () => {
  it('an income row with account_id AND transfer_account_id credits only account_id', async () => {
    const res = await SELF.fetch('https://example.com/api/import/execute', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '900' },
      body: JSON.stringify({
        // Row columns: [means_of_payment, category, type, amount].
        // Both "Checking" and "Savings" are flagged account-typed, so they are
        // created as accounts and resolved to account_id / transfer_account_id.
        rows: [['Checking', 'Savings', 'income', '100']],
        mapping: { means_of_payment: 0, category: 1, type: 2, amount: 3 },
        categoryTypes: { Checking: 'account', Savings: 'account' },
        accountBalances: { Checking: '1000', Savings: '500' },
      }),
    });
    expect(res.status).toBe(200);

    // The income lands in the Means-of-Payment account (account_id): 1000 + 100.
    expect(await balanceOf('Checking')).toBeCloseTo(1100, 2);
    // The Category account (transfer_account_id) must be UNTOUCHED — the double-credit
    // bug produced 600 here.
    expect(await balanceOf('Savings')).toBeCloseTo(500, 2);
  });

  it('a genuine transfer still credits transfer_account_id (the fix is scoped to income)', async () => {
    const res = await SELF.fetch('https://example.com/api/import/execute', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '900' },
      body: JSON.stringify({
        rows: [['Checking', 'Savings', 'transfer', '100']],
        mapping: { means_of_payment: 0, category: 1, type: 2, amount: 3 },
        categoryTypes: { Checking: 'account', Savings: 'account' },
        accountBalances: { Checking: '1000', Savings: '500' },
      }),
    });
    expect(res.status).toBe(200);
    // Transfer moves money: Checking (source) 1000 - 100, Savings (dest) 500 + 100.
    expect(await balanceOf('Checking')).toBeCloseTo(900, 2);
    expect(await balanceOf('Savings')).toBeCloseTo(600, 2);
  });

  it('reports and skips unresolved and self transfers without changing balances', async () => {
    const res = await SELF.fetch('https://example.com/api/import/execute', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '900' },
      body: JSON.stringify({
        rows: [
          ['Checking', 'Other', 'transfer', '100'],
          ['Checking', 'Checking', 'transfer', '50'],
        ],
        mapping: { means_of_payment: 0, category: 1, type: 2, amount: 3 },
        categoryTypes: { Checking: 'account' },
        accountBalances: { Checking: '1000' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      imported: number;
      skipped: number;
      skipped_items: Array<{ index: number; reason: string }>;
    };
    expect(body.imported).toBe(0);
    expect(body.skipped).toBe(2);
    expect(body.skipped_items.map((item) => item.index)).toEqual([0, 1]);
    expect(await balanceOf('Checking')).toBeCloseTo(1000, 2);
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM transactions WHERE profile_id = 900'
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});
