/**
 * GET /api/budgets/alerts measures a month's spending against that month's budgets.
 *
 * A budget is one row per category per month (allocate, copy and "set from last month's spending"
 * each write the month's own row, with no end date). The alerts took every row without an end
 * date, so each earlier month's budget for a category, and each later one, was measured against
 * this month's spending: one category raised an alert per month, at amounts it no longer had. The
 * Dashboard's Budget Alerts card and its overview deck read them.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/budgetAlerts.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 6309;
const PROFILE = 63090;
const FOOD = 630901;
const RENT = 630902;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const budget = (category: number, start: string, amount: number) =>
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, 'monthly', ?)"
    ).bind(PROFILE, category, amount, start);
  const expense = (category: number, date: string, amount: number) =>
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'spent', ?, ?, 'EUR', 'expense', ?, ?)"
    ).bind(PROFILE, amount, amount, date, category);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'budget-alerts@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#F97316')"
    ).bind(FOOD, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Rent', 'expense', '#3B82F6')"
    ).bind(RENT, PROFILE),
    budget(FOOD, '2026-08-01', 100),
    budget(FOOD, '2026-09-01', 200),
    budget(FOOD, '2026-10-01', 300),
    budget(FOOD, '2026-11-01', 50),
    budget(RENT, '2026-09-01', 900),
    expense(FOOD, '2026-10-03', 120),
    expense(FOOD, '2026-10-12', 150),
    expense(RENT, '2026-10-01', 900),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
});

type Alert = { categoryName: string; budgetAmount: number; spent: number; percentage: number };

async function alerts(query: string): Promise<Alert[]> {
  const res = await SELF.fetch(`https://example.com/api/budgets/alerts?${query}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { alerts: Alert[] }).alerts.map((a) => ({
    categoryName: a.categoryName,
    budgetAmount: a.budgetAmount,
    spent: a.spent,
    percentage: a.percentage,
  }));
}

describe('GET /api/budgets/alerts', () => {
  it("measures the month's spending against the month's own budget, once per category", async () => {
    expect(await alerts('threshold=80&year=2026&month=10')).toEqual([
      { categoryName: 'Food', budgetAmount: 300, spent: 270, percentage: 90 },
    ]);
  });

  it('raises none for a category without a budget that month', async () => {
    // Rent has September's budget only: October's 900 is spent against no October budget.
    expect((await alerts('threshold=1&year=2026&month=10')).map((a) => a.categoryName)).toEqual([
      'Food',
    ]);
  });

  it('reads this month when none is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
    expect(await alerts('threshold=80')).toEqual([
      { categoryName: 'Food', budgetAmount: 300, spent: 270, percentage: 90 },
    ]);
  });
});
