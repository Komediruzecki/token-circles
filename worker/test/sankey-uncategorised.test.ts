/**
 * The month's budget flow (GET /api/analytics/sankey, the Dashboard's and Analytics' Budget vs
 * Actual) counts spending without a category.
 *
 * It was left out on the Worker, so Total Actual was short of what the month cost by exactly the
 * uncategorised spending, and the Unused Budget node showed money that had been spent. Local-first
 * showed it as an Uncategorized category, budgeted at what was spent, as a category without a
 * budget is (the contract's `sankey-uncategorised`). Both do that now.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/sankeyUncategorised.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

const USER = 6310;
const PROFILE = 63100;
const FOOD = 631001;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const expense = (category: number | null, date: string, amount: number) =>
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'spent', ?, ?, 'EUR', 'expense', ?, ?)"
    ).bind(PROFILE, amount, amount, date, category);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sankey-uncategorised@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#F97316')"
    ).bind(FOOD, PROFILE),
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-10-01')"
    ).bind(PROFILE, FOOD),
    expense(FOOD, '2026-10-04', 200),
    expense(null, '2026-10-09', 30),
    expense(null, '2026-10-21', 20.5),
    // Another month's: in no October flow.
    expense(null, '2026-09-30', 99),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
});

type Flow = {
  nodes: { name: string; category: string }[];
  links: { source: string; target: string; value: number }[];
};

async function flow(query: string): Promise<Flow> {
  const res = await SELF.fetch(`https://example.com/api/analytics/sankey?${query}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Flow;
}

describe('GET /api/analytics/sankey', () => {
  it("counts the month's uncategorised spending in Total Actual, as Uncategorized", async () => {
    const { nodes, links } = await flow('year=2026&month=10');
    expect(nodes.map((n) => n.name)).toEqual([
      'Total Budget',
      'Food',
      'Uncategorized',
      'Total Actual',
      'Unused Budget',
    ]);
    expect(links.map((l) => [l.source, l.target, l.value])).toEqual([
      ['Total Budget', 'Food', 300],
      ['Food', 'Total Actual', 200],
      ['Total Budget', 'Uncategorized', 50.5],
      ['Uncategorized', 'Total Actual', 50.5],
      ['Total Budget', 'Unused Budget', 100],
    ]);
  });

  it('draws a month spent entirely without categories', async () => {
    await env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE).run();
    const { nodes } = await flow('year=2026&month=9');
    expect(nodes.map((n) => n.name)).toEqual(['Total Budget', 'Uncategorized', 'Total Actual']);
  });
});
