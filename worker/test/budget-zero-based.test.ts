/**
 * What the Budgets page reads for a month (GET /api/budgets/zero-based, its summary, the forecast's
 * history and GET /api/budgets/improvements), where the two runtimes answered differently. The
 * Worker's answers are the ones kept, except where both were wrong:
 *
 * - A category without a budget has none: an amount of 0 and nothing used. Local-first gave its
 *   spending as its budget, 100% used, so the page called it near its limit in that mode only
 *   (the contract's `budget-zero-based-unbudgeted`).
 * - "Over budget by" says what was spent past the allocation, from past 100%. It said "$-10.00"
 *   here, and "$0.00" at exactly 100% in local-first (`budget-allocation-alerts`).
 * - A month's trend and adherence measure the budgets against what their categories spent, not
 *   every expense of the month (`budget-trend-spending`); local-first counted every expense.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/budgetZeroBased.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 6311;
const PROFILE = 63110;
const FOOD = 631101;
const FUN = 631102;
const RENT = 631103;
const BOOKS = 631104;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const category = (id: number, name: string) =>
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#F97316')"
    ).bind(id, PROFILE, name);
  const budget = (category: number, amount: number) =>
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, 'monthly', '2026-10-01')"
    ).bind(PROFILE, category, amount);
  const expense = (category: number | null, date: string, amount: number) =>
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'spent', ?, ?, 'EUR', 'expense', ?, ?)"
    ).bind(PROFILE, amount, amount, date, category);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'budget-zero-based@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    category(FOOD, 'Food'),
    category(FUN, 'Fun'),
    category(RENT, 'Rent'),
    category(BOOKS, 'Books'),
    budget(FOOD, 300),
    budget(RENT, 900),
    budget(BOOKS, 0),
    expense(FOOD, '2026-10-04', 200),
    expense(RENT, '2026-10-01', 990),
    expense(BOOKS, '2026-10-06', 12),
    // Spending no budget covers: a category without one, and none at all.
    expense(FUN, '2026-10-09', 50),
    expense(null, '2026-10-12', 20),
  ]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
});

async function get<T>(path: string): Promise<T> {
  const res = await SELF.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
  });
  expect(res.status, `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}

type Row = Record<string, unknown> & { category_id: number };

describe('GET /api/budgets/zero-based', () => {
  it('gives a category without a budget none, however much it spent', async () => {
    const { allocations } = await get<{ allocations: Row[] }>(
      '/api/budgets/zero-based?month=2026-10'
    );
    const of = (id: number) => allocations.find((a) => a.category_id === id);
    expect(of(FUN)).toMatchObject({
      amount: 0,
      spent: 50,
      remaining_budget: 0,
      percent_used: 0,
      is_budgeted: false,
    });
    // A budget of zero is a budget: what it spent is past it.
    expect(of(BOOKS)).toMatchObject({
      amount: 0,
      spent: 12,
      remaining_budget: -12,
      percent_used: 0,
      is_budgeted: true,
    });
    expect(of(FOOD)).toMatchObject({ amount: 300, spent: 200, percent_used: 67 });
  });
});

describe('GET /api/budgets/zero-based/summary', () => {
  it('says how far over budget, from past 100%', async () => {
    const { allocations } = await get<{ allocations: (Row & { alerts: string[] })[] }>(
      '/api/budgets/zero-based/summary?month=2026-10'
    );
    const alertsOf = (id: number) => allocations.find((a) => a.category_id === id)?.alerts;
    expect(alertsOf(RENT)).toEqual(['Approaching limit: 110% used', 'Over budget by $90.00']);
    expect(alertsOf(FOOD)).toEqual([]);
  });

  it('is not over budget at exactly 100%', async () => {
    await env.DB.prepare('UPDATE budgets SET amount = 990 WHERE category_id = ?').bind(RENT).run();
    const { allocations } = await get<{ allocations: (Row & { alerts: string[] })[] }>(
      '/api/budgets/zero-based/summary?month=2026-10'
    );
    expect(allocations.find((a) => a.category_id === RENT)?.alerts).toEqual([
      'Approaching limit: 100% used',
    ]);
  });
});

describe("a month's trend", () => {
  // One budget a month here, each with one expense: what the trend counts, not how a month of
  // several budgets is summed.
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM budgets WHERE category_id IN (?, ?)').bind(RENT, BOOKS).run();
  });

  it('measures the budgets against what their categories spent (/api/budgets/improvements)', async () => {
    const [october] = await get<
      { month: string; total_budget: number; total_spent: number; adherence_pct: number }[]
    >('/api/budgets/improvements?months=6');
    expect(october).toMatchObject({ month: '2026-10', total_budget: 300, total_spent: 200 });
  });

  it("and so does the forecast's history (/api/budgets/forecast)", async () => {
    const { history } = await get<{
      history: { month: string; total_budget: number; total_spent: number }[];
    }>('/api/budgets/forecast?month=2026-10');
    expect(history[0]).toMatchObject({ month: '2026-10', total_budget: 300, total_spent: 200 });
  });
});
