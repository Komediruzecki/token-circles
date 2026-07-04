import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Category-linked goals now count only the linked category's transactions dated on/after
// the goal's tracking_start_date (base-currency value), so pre-existing history doesn't
// overfill a freshly-linked goal — and the user can move the start date to include history.

let cookie = '';

beforeEach(async () => {
  for (const t of ['savings_goals', 'transactions', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (70, 'trk@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (700, 70, 'Main')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (9, 700, 'Car', 'expense', '#3B82F6')"
    ),
    // Old history (before the goal) + newer activity, incl. a foreign-currency row.
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (700, 'old', 500, 'expense', '2024-01-10', 9)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (700, 'new1', 100, 'expense', '2026-08-01', 9)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (700, 'new2 HRK', 190, 25, 'HRK', 'expense', '2026-08-05', 9)"
    ),
  ]);
  cookie = (await issueSessionCookie(70, 'password', env)).split(';')[0];
});

function api(path: string, method: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '700' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function goalAmount(id: number): Promise<number> {
  const r = await env.DB.prepare('SELECT current_amount FROM savings_goals WHERE id = ?')
    .bind(id)
    .first<{ current_amount: number }>();
  return r?.current_amount ?? NaN;
}

describe('category goal tracking window', () => {
  it('on create, counts only category transactions on/after tracking_start_date (base currency)', async () => {
    const res = await api('/api/savings-goals', 'POST', {
      name: 'Car',
      target_amount: 1000,
      category_id: 9,
      tracking_start_date: '2026-07-01',
    });
    const { id } = (await res.json()) as { id: number };
    // 100 (new1) + 25 (new2 amount_local, not 190 HRK) = 125; the 2024 row is excluded.
    expect(await goalAmount(id)).toBeCloseTo(125, 2);
  });

  it('defaults tracking_start_date to today when omitted, excluding older history', async () => {
    const res = await api('/api/savings-goals', 'POST', {
      name: 'Car',
      target_amount: 1000,
      category_id: 9,
    });
    const { id } = (await res.json()) as { id: number };
    // The 2024 row is before today and excluded; the 2026-08 rows are on/after today: 100 + 25.
    expect(await goalAmount(id)).toBeCloseTo(125, 2);
  });

  it('moving the start date earlier includes prior history', async () => {
    const res = await api('/api/savings-goals', 'POST', {
      name: 'Car',
      target_amount: 1000,
      category_id: 9,
      tracking_start_date: '2026-07-01',
    });
    const { id } = (await res.json()) as { id: number };
    expect(await goalAmount(id)).toBeCloseTo(125, 2);
    await api(`/api/savings-goals/${id}`, 'PUT', { tracking_start_date: '2020-01-01' });
    // now includes the 500 from 2024 too: 500 + 100 + 25 = 625
    expect(await goalAmount(id)).toBeCloseTo(625, 2);
  });

  it('recomputes category progress on GET, even after a direct write that skipped recalc', async () => {
    const res = await api('/api/savings-goals', 'POST', {
      name: 'Car',
      target_amount: 1000,
      category_id: 9,
      tracking_start_date: '2026-07-01',
    });
    const { id } = (await res.json()) as { id: number };
    expect(await goalAmount(id)).toBeCloseTo(125, 2);
    // Simulate a mutation path that didn't run recalc (e.g. bulk import / older client):
    // insert straight into the table so the stored current_amount is now stale.
    await env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, type, date, category_id) VALUES (700, 'direct', 75, 'expense', '2026-08-20', 9)"
    ).run();
    expect(await goalAmount(id)).toBeCloseTo(125, 2); // still stale in the table
    // Loading the Goals page (GET) refreshes it: 125 + 75 = 200.
    const list = (await (await api('/api/savings-goals', 'GET')).json()) as Array<{
      id: number;
      current_amount: number;
    }>;
    expect(list.find((g) => g.id === id)?.current_amount).toBeCloseTo(200, 2);
    expect(await goalAmount(id)).toBeCloseTo(200, 2); // and persisted
  });

  it('a new transaction in the category updates the goal', async () => {
    const res = await api('/api/savings-goals', 'POST', {
      name: 'Car',
      target_amount: 1000,
      category_id: 9,
      tracking_start_date: '2026-07-01',
    });
    const { id } = (await res.json()) as { id: number };
    await api('/api/transactions', 'POST', {
      description: 'fuel',
      amount: 40,
      type: 'expense',
      date: '2026-08-10',
      category_id: 9,
    });
    expect(await goalAmount(id)).toBeCloseTo(165, 2); // 125 + 40
  });
});
