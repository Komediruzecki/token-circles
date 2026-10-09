import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

// POST /api/budgets/allocate is an upsert: re-allocating a category for the same month must
// UPDATE the existing amount, not 400. Previously it errored ("Budget already exists…"), so a
// user could never change an allocation.

let cookie = '';

beforeEach(async () => {
  for (const t of ['budgets', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (80, 'alloc@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (800, 80, 'Me')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (81, 800, 'Food', 'expense', '#F97316')"
    ),
  ]);
  cookie = (await sessionCookie(80, 'password', env)).split(';')[0];
});

function allocate(amount: number, month = '2026-05'): Promise<Response> {
  return SELF.fetch(`https://example.com/api/budgets/allocate?month=${month}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '800' },
    body: JSON.stringify({ category_id: 81, amount, period: 'monthly' }),
  });
}

async function rowsFor(): Promise<Array<{ amount: number }>> {
  const res = await env.DB.prepare(
    "SELECT amount FROM budgets WHERE category_id = 81 AND profile_id = 800 AND start_date = '2026-05-01'"
  ).all<{ amount: number }>();
  return res.results ?? [];
}

describe('POST /api/budgets/allocate (upsert)', () => {
  it('re-allocating the same category+month updates the amount instead of 400', async () => {
    expect((await allocate(1000)).status).toBe(200);

    const second = await allocate(1500);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { amount: number }).amount).toBe(1500);

    // Exactly one row, carrying the updated amount (no duplicate, no error).
    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1500);
  });

  // A budget can start mid-month: one an API client, an import or an MCP agent set. Allocate found
  // the month's budget by its first day only, so it added a second budget for the category that
  // month, and the month counted both.
  it('changes a budget that starts mid-month instead of adding a second', async () => {
    const mid = await env.DB.prepare(
      "INSERT INTO budgets (category_id, profile_id, amount, period, start_date) VALUES (81, 800, 200, 'monthly', '2026-05-15')"
    ).run();
    const id = mid.meta.last_row_id;

    const res = await allocate(300);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      amount: 300,
      start_date: '2026-05-15',
      message: 'Budget updated successfully',
    });
    const may = await env.DB.prepare(
      "SELECT id, amount FROM budgets WHERE category_id = 81 AND profile_id = 800 AND start_date >= '2026-05-01' AND start_date < '2026-06-01'"
    ).all<{ id: number; amount: number }>();
    expect(may.results).toEqual([{ id, amount: 300 }]);
  });

  it('allows lowering an existing allocation', async () => {
    await allocate(1000);
    const res = await allocate(500);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { amount: number }).amount).toBe(500);
    expect((await rowsFor())[0].amount).toBe(500);
  });
});
