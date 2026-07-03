import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Backfill-from-spending sets each historical month's budget to that month's actual
// spending (base-currency value), so budget-vs-spent charts aren't empty after an import.

let cookie = '';

beforeEach(async () => {
  for (const t of ['budgets', 'transactions', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (50, 'bf@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (500, 50, 'Main')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (11, 500, 'Food', 'expense', '#F97316')"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (12, 500, 'Car', 'expense', '#3B82F6')"
    ),
    // March: Food 120 (100+20), Car 50. April: Food 60.
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'a', 100, 'expense', '2026-03-05', 11)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'b', 20, 'expense', '2026-03-20', 11)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'c', 50, 'expense', '2026-03-10', 12)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'd', 60, 'expense', '2026-04-15', 11)"
    ),
    // An income row must be ignored.
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (500, 'pay', 3000, 'income', '2026-03-01', NULL)"
    ),
  ]);
  cookie = (await issueSessionCookie(50, 'password', env)).split(';')[0];
});

async function budgetsByMonthCat(): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    'SELECT substr(start_date,1,7) ym, category_id, amount FROM budgets WHERE profile_id = 500'
  ).all<{ ym: string; category_id: number; amount: number }>();
  const out: Record<string, number> = {};
  for (const r of rows.results) out[`${r.ym}:${r.category_id}`] = r.amount;
  return out;
}

function post(body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com/api/budgets/backfill-from-spending', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '500' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/budgets/backfill-from-spending', () => {
  it('sets each month/category budget to that month exact spending (full range)', async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; count: number; months: number };
    expect(data.ok).toBe(true);
    expect(data.count).toBe(3); // March Food, March Car, April Food
    expect(data.months).toBe(2);

    const b = await budgetsByMonthCat();
    expect(b['2026-03:11']).toBeCloseTo(120, 2);
    expect(b['2026-03:12']).toBeCloseTo(50, 2);
    expect(b['2026-04:11']).toBeCloseTo(60, 2);
    // income didn't create a budget
    expect(Object.keys(b)).toHaveLength(3);
  });

  it('honors an explicit month range', async () => {
    const res = await post({ from_month: '2026-04', to_month: '2026-04' });
    const data = (await res.json()) as { ok: boolean; count: number; months: number };
    expect(data.count).toBe(1);
    expect(data.months).toBe(1);
    const b = await budgetsByMonthCat();
    expect(b['2026-04:11']).toBeCloseTo(60, 2);
    expect(b['2026-03:11']).toBeUndefined();
  });

  it('overwrites existing budgets in the range and is idempotent', async () => {
    await env.DB.prepare(
      "INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (11, 999, 'monthly', '2026-03-01', 500)"
    ).run();
    await post({});
    await post({});
    const b = await budgetsByMonthCat();
    expect(b['2026-03:11']).toBeCloseTo(120, 2); // replaced the 999, not doubled
    expect(Object.keys(b)).toHaveLength(3);
  });

  it('returns ok:false when there are no expenses', async () => {
    await env.DB.prepare("DELETE FROM transactions WHERE type = 'expense'").run();
    const res = await post({});
    const data = (await res.json()) as { ok: boolean; message?: string };
    expect(data.ok).toBe(false);
  });
});
