import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Base-currency reporting: a foreign-currency transaction carries its base-currency value
// in amount_local (e.g. 19 HRK stored with amount_local = 2.47 EUR). Every aggregate must
// report the base-currency value — COALESCE(amount_local, amount) — not the raw amount.

let cookie = '';

beforeEach(async () => {
  for (const t of ['transactions', 'accounts', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (30, 'cur@example.com', 'password', 1, 'basic')"
    ),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name) VALUES (300, 30, 'Main'), (301, 30, 'Partner')"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (9, 300, 'Travel', 'expense', '#F97316')"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (10, 300, 'Salary', 'income', '#22C55E')"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, balance, starting_balance, currency) VALUES (30, 300, 'Current', 'giro', 0, 0, 'EUR')"
    ),
    // 19 HRK ≈ 2.47 EUR, and 9329 HRK ≈ 1212.77 EUR — base currency is EUR.
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id, account_id, beneficiary, reconciled) VALUES (300, 'Toll', 19, 2.47, 'HRK', 'expense', '2026-03-10', 9, 30, 'Road Co', 0)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id, account_id, payor, reconciled) VALUES (300, 'Paycheck', 9329, 1212.77, 'HRK', 'income', '2026-03-01', 10, 30, 'Employer', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (301, 'Partner groceries', 8, NULL, 'EUR', 'expense', '2026-03-11', NULL)"
    ),
  ]);
  cookie = (await issueSessionCookie(30, 'password', env)).split(';')[0];
});

async function get(path: string): Promise<any> {
  const res = await SELF.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': '300' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe('base-currency reporting (amount_local)', () => {
  it('dashboard totals use amount_local, not the raw foreign amount', async () => {
    const d = await get('/api/dashboard?year=2026&month=3');
    // EUR values, not the 19 / 9329 HRK raw amounts
    expect(d.totalExpenses).toBeCloseTo(2.47, 2);
    expect(d.totalIncome).toBeCloseTo(1212.77, 2);
    expect(d.totalExpenses).not.toBeCloseTo(19, 0);
  });

  it('analytics monthly stats use amount_local', async () => {
    const rows = (await get('/api/stats/monthly?months=12')) as Array<{
      month: string;
      income: number;
      expense: number;
    }>;
    const march = rows.find((r) => r.month === '2026-03');
    expect(march).toBeDefined();
    expect(march!.expense).toBeCloseTo(2.47, 2);
    expect(march!.income).toBeCloseTo(1212.77, 2);
  });

  it('analytics monthly stats include every selected household profile', async () => {
    const res = await SELF.fetch('https://example.com/api/stats/monthly?months=12', {
      headers: {
        Cookie: cookie,
        'X-Profile-Id': '300',
        'X-Profile-Ids': '[300,301]',
      },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ month: string; expense: number }>;
    expect(rows.find((r) => r.month === '2026-03')?.expense).toBeCloseTo(10.47, 2);
  });

  it('daily heatmap uses amount_local', async () => {
    const h = (await get('/api/analytics/daily-heatmap?year=2026&type=expense')) as {
      dates?: Record<string, number>;
    };
    const dates = h.dates ?? {};
    // The 2026-03-10 toll should register as 2.47 EUR, not 19 HRK
    expect(Math.abs(dates['2026-03-10'])).toBeCloseTo(2.47, 2);
  });

  it('transaction and reconciliation summaries use amount_local', async () => {
    const summary = await get('/api/transactions/summary');
    expect(summary.total_expense).toBeCloseTo(2.47, 2);
    expect(summary.total_income).toBeCloseTo(1212.77, 2);

    const reconciliation = await get('/api/transactions/reconcile/summary');
    expect(reconciliation.unreconciled_total).toBeCloseTo(2.47, 2);

    const account = await get('/api/accounts/30/reconciliation-summary');
    expect(account.unreconciled_total).toBeCloseTo(2.47, 2);
  });

  it('counterparty totals use amount_local', async () => {
    const rows = (await get('/api/counterparties')) as Array<{
      name: string;
      incoming: number;
      outgoing: number;
    }>;
    expect(rows.find((row) => row.name === 'Road Co')?.outgoing).toBeCloseTo(2.47, 2);
    expect(rows.find((row) => row.name === 'Employer')?.incoming).toBeCloseTo(1212.77, 2);
  });

  it('emergency-fund spending uses amount_local', async () => {
    const result = await get('/api/calculator/emergency-fund');
    expect(result.avgMonthlyExpenses).toBe(2);
    expect(result.coverage[0].required).toBe(7);
  });

  it('tax and profit/loss reports use amount_local', async () => {
    await env.DB.prepare('UPDATE categories SET tax_deductible = 1 WHERE id = 9').run();
    const tax = await get('/api/reports/tax-summary?year=2026');
    expect(tax.taxDeductibleTotal).toBeCloseTo(2.47, 2);
    expect(tax.totalExpenses).toBeCloseTo(2.47, 2);

    const profitLoss = await get('/api/reports/pl-summary?year=2026');
    expect(profitLoss.income.total).toBeCloseTo(1212.77, 2);
    expect(profitLoss.expenses.total).toBeCloseTo(2.47, 2);
  });
});
