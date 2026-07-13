import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

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
  cookie = (await issueSessionCookie(80, 'password', env)).split(';')[0];
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

  it('allows lowering an existing allocation', async () => {
    await allocate(1000);
    const res = await allocate(500);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { amount: number }).amount).toBe(500);
    expect((await rowsFor())[0].amount).toBe(500);
  });
});
