import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';

// A month can hold two budget rows for one category: two POST /api/budgets, an API client, an
// import, a restore. Every reader takes the one saved last (the later created_at, then the higher
// id): the Budgets page (the last row of GET /api/budgets/summary and of /api/budgets/zero-based for
// a category), Allocate, and Progress's advice. The summary and zero-based had no ORDER BY, so the
// page showed whichever row D1 listed last, while Allocate changed the first (ORDER BY start_date,
// id), so a new allocation could leave the figure on screen as it was.

let cookie = '';
const headers = () => ({ Cookie: cookie, 'X-Profile-Id': '800' });

beforeEach(async () => {
  for (const t of ['budgets', 'categories', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (80, 'rows@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (800, 80, 'Me')"),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (81, 800, 'Food', 'expense', '#F97316')"
    ),
  ]);
  cookie = (await sessionCookie(80, 'password', env)).split(';')[0];
});

/** Inserts May's rows in the order given; returns their ids. */
async function seed(rows: Array<{ amount: number; created_at: string }>): Promise<number[]> {
  const ids: number[] = [];
  for (const r of rows) {
    const res = await env.DB.prepare(
      "INSERT INTO budgets (category_id, profile_id, amount, period, start_date, created_at) VALUES (81, 800, ?, 'monthly', '2026-05-01', ?)"
    )
      .bind(r.amount, r.created_at)
      .run();
    ids.push(Number(res.meta.last_row_id));
  }
  return ids;
}

/** The row each reader takes for Food in May. */
async function readers(): Promise<{ summary: number; zeroBased: number; allocate: number }> {
  const summary = (await (
    await SELF.fetch('https://example.com/api/budgets/summary?year=2026&month=5', {
      headers: headers(),
    })
  ).json()) as Array<{ id: number; category_id: number }>;
  const zeroBased = (await (
    await SELF.fetch('https://example.com/api/budgets/zero-based?month=2026-05', {
      headers: headers(),
    })
  ).json()) as { allocations: Array<{ budget_id: number | null; category_id: number }> };
  const allocate = (await (
    await SELF.fetch('https://example.com/api/budgets/allocate?month=2026-05', {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: 81, amount: 500, period: 'monthly' }),
    })
  ).json()) as { id: number };
  return {
    // The page keeps the last row it reads for a category.
    summary: summary.filter((b) => b.category_id === 81).at(-1)!.id,
    zeroBased: zeroBased.allocations.find((a) => a.category_id === 81)!.budget_id!,
    allocate: allocate.id,
  };
}

describe('two budget rows for one category and month', () => {
  it('every reader takes the row saved later, whichever has the higher id', async () => {
    const [later] = await seed([
      { amount: 400, created_at: '2026-05-20 10:00:00' },
      { amount: 250, created_at: '2026-05-02 10:00:00' },
    ]);
    expect(await readers()).toEqual({ summary: later, zeroBased: later, allocate: later });
  });

  it('every reader takes the higher id when both were saved in the same second', async () => {
    const [, last] = await seed([
      { amount: 400, created_at: '2026-05-02 10:00:00' },
      { amount: 250, created_at: '2026-05-02 10:00:00' },
    ]);
    expect(await readers()).toEqual({ summary: last, zeroBased: last, allocate: last });
  });

  // A restore copies created_at as the backup has it, so a local-first backup brings ISO times
  // ('...T08:00:00.000Z') next to D1's own ('... 18:00:00'). As text, the space sorts first.
  it('compares a restored ISO time with a D1 time by the time they name', async () => {
    const [later] = await seed([
      { amount: 400, created_at: '2026-05-02 18:00:00' },
      { amount: 250, created_at: '2026-05-02T08:00:00.000Z' },
    ]);
    expect(await readers()).toEqual({ summary: later, zeroBased: later, allocate: later });
  });

  it("carries last month's rollover from the row saved last", async () => {
    // April: two rows with rollover on, the one saved later budgets 300. Nothing spent, so all 300
    // carries into May, not the other row's 100.
    for (const [amount, created] of [
      [300, '2026-04-20 10:00:00'],
      [100, '2026-04-02 10:00:00'],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO budgets (category_id, profile_id, amount, period, start_date, created_at, rollover_enabled) VALUES (81, 800, ?, 'monthly', '2026-04-01', ?, 1)"
      )
        .bind(amount, created)
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO budgets (category_id, profile_id, amount, period, start_date, rollover_enabled) VALUES (81, 800, 50, 'monthly', '2026-05-01', 1)"
    ).run();
    const rows = (await (
      await SELF.fetch('https://example.com/api/budgets/summary?year=2026&month=5', {
        headers: headers(),
      })
    ).json()) as Array<{ auto_rollover: number; effective_budget: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ auto_rollover: 300, effective_budget: 350 });
  });

  // shared/budgetSavedOrder.ts compares D1's created_at with local-first's toISOString() (UTC) as
  // one clock, which holds only while D1's datetime('now') is UTC too.
  it("stores created_at as UTC, in D1's own format", async () => {
    const before = Date.now();
    const [id] = await seed([{ amount: 10, created_at: '' }]);
    await env.DB.prepare("UPDATE budgets SET created_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
    const row = await env.DB.prepare('SELECT created_at FROM budgets WHERE id = ?')
      .bind(id)
      .first<{ created_at: string }>();
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const at = Date.parse(`${row!.created_at.replace(' ', 'T')}Z`);
    expect(Math.abs(at - before)).toBeLessThan(60_000);
  });
});
