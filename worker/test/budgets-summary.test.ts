import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Fix A7 (audit D12/D13): the budget summary must respect the same multi-profile
// (household) selection as GET /api/budgets, and must not stack a category's
// prior-month rows when querying a single month.

let cookie = '';

beforeEach(async () => {
  for (const t of ['budgets', 'transactions', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (70, 'sum@example.com', 'password', 1)"
    ),
    // Two profiles owned by the same user (household).
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (700, 70, 'Me')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (701, 70, 'Partner')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (71, 700, 'Food', 'expense', '#F97316')"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (72, 701, 'Rent', 'expense', '#3B82F6')"
    ),
    // Category 71 (profile 700) has budgets in BOTH April and May, both open-ended.
    env.DB.prepare(
      "INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (71, 100, 'monthly', '2026-04-01', 700)"
    ),
    env.DB.prepare(
      "INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (71, 200, 'monthly', '2026-05-01', 700)"
    ),
    // Category 72 (profile 701) budget in May only.
    env.DB.prepare(
      "INSERT INTO budgets (category_id, amount, period, start_date, profile_id) VALUES (72, 800, 'monthly', '2026-05-01', 701)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (700, 'groceries', 60, 'expense', '2026-05-10', 71)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (701, 'rent', 800, 'expense', '2026-05-02', 72)"
    ),
  ]);
  cookie = (await issueSessionCookie(70, 'password', env)).split(';')[0];
});

interface SummaryRow {
  category_id: number;
  amount: number;
  spent: number;
}

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie, ...headers },
  });
}

describe('GET /api/budgets/summary', () => {
  it('returns one row per category for the queried month (D13: no cross-month stacking)', async () => {
    const res = await get('/api/budgets/summary?year=2026&month=5', { 'X-Profile-Id': '700' });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as SummaryRow[];
    // Only the May row for category 71 — not April+May stacked.
    expect(rows).toHaveLength(1);
    expect(rows[0].category_id).toBe(71);
    expect(rows[0].amount).toBe(200);
    expect(rows[0].spent).toBe(60);
  });

  it('covers the same profiles as the list in a household selection (D12)', async () => {
    const ids = { 'X-Profile-Ids': JSON.stringify([700, 701]) };

    const listRes = await get('/api/budgets', ids);
    const list = (await listRes.json()) as Array<{ category_id: number }>;
    const listCats = new Set(list.map((b) => b.category_id));

    const sumRes = await get('/api/budgets/summary?year=2026&month=5', ids);
    const summary = (await sumRes.json()) as SummaryRow[];
    const summaryCats = new Set(summary.map((b) => b.category_id));

    // Summary spans both profiles' categories for May (71 and 72), matching the
    // month-scoped subset of the list — and not just profile 700's.
    expect(summaryCats).toEqual(new Set([71, 72]));
    expect(summaryCats.has(71)).toBe(true);
    expect(summaryCats.has(72)).toBe(true);
    // Every category the summary reports is one the list also reports.
    for (const c of summaryCats) expect(listCats.has(c)).toBe(true);
  });
});
