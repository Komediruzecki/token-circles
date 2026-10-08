/**
 * "Set from last month's spending" fills the categories the month has no budget for, each with
 * what it cost the month before, and leaves the budgets the month already has alone.
 *
 * It deleted every budget of the month first and wrote last month's spending in their place,
 * without asking: a budget set by hand that morning went back to whatever was spent. It follows
 * the rule "Copy last month" follows now: never delete or overwrite a budget the month has, and
 * say how many were set and how many were already there.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/budgetsFromExpenses.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 6301;
const PROFILE = 63010;
const FOOD = 630101;
const CAR = 630102;
const GYM = 630103;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const category = (id: number, name: string) =>
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#F97316')"
    ).bind(id, PROFILE, name);
  const expense = (date: string, amount: number, categoryId: number | null) =>
    env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'spent', ?, ?, 'EUR', 'expense', ?, ?)"
    ).bind(PROFILE, amount, amount, date, categoryId);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'from-expenses@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    category(FOOD, 'Food'),
    category(CAR, 'Car'),
    category(GYM, 'Gym'),
    // March: Food 120.55 (100 + 20.55), Car 50. Nothing on Gym; one expense without a category.
    expense('2026-03-05', 100, FOOD),
    expense('2026-03-20', 20.55, FOOD),
    expense('2026-03-10', 50, CAR),
    expense('2026-03-12', 9, null),
    // April's own spending is not what April's budgets are set from.
    expense('2026-04-02', 75, CAR),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
});

function fromExpenses(body: unknown): Promise<Response> {
  return SELF.fetch('https://example.com/api/budgets/from-expenses', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function budget(categoryId: number, amount: number, startDate: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, ?, 'monthly', ?)"
  )
    .bind(PROFILE, categoryId, amount, startDate)
    .run();
}

/** Every budget of the profile, as "YYYY-MM:category" -> amount. */
async function budgets(): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    'SELECT substr(start_date, 1, 7) AS ym, category_id, amount FROM budgets WHERE profile_id = ?'
  )
    .bind(PROFILE)
    .all<{ ym: string; category_id: number; amount: number }>();
  const out: Record<string, number> = {};
  for (const row of rows.results) out[`${row.ym}:${row.category_id}`] = row.amount;
  return out;
}

describe('POST /api/budgets/from-expenses', () => {
  it('sets every category last month spent on, when the month has no budgets', async () => {
    const res = await fromExpenses({ year: 2026, month: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2, already_budgeted: 0 });
    expect(await budgets()).toEqual({ [`2026-04:${FOOD}`]: 120.55, [`2026-04:${CAR}`]: 50 });
  });

  it('keeps a budget the month already has, and sets only the categories without one', async () => {
    await budget(FOOD, 450, '2026-04-01');
    await budget(GYM, 30, '2026-04-01');

    const res = await fromExpenses({ year: 2026, month: 4 });
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(await budgets()).toEqual({
      [`2026-04:${FOOD}`]: 450,
      [`2026-04:${GYM}`]: 30,
      [`2026-04:${CAR}`]: 50,
    });
    expect(answer).toEqual({ ok: true, count: 1, already_budgeted: 1 });
  });

  it('sets nothing a second time, and says every category was already there', async () => {
    await fromExpenses({ year: 2026, month: 4 });
    await env.DB.prepare('UPDATE budgets SET amount = 400 WHERE profile_id = ? AND category_id = ?')
      .bind(PROFILE, FOOD)
      .run();
    const res = await fromExpenses({ year: 2026, month: 4 });
    const answer = await res.json();
    expect(await budgets()).toEqual({ [`2026-04:${FOOD}`]: 400, [`2026-04:${CAR}`]: 50 });
    expect(answer).toEqual({ ok: true, count: 0, already_budgeted: 2 });
  });

  it('leaves the budgets of other months alone', async () => {
    await budget(FOOD, 300, '2026-03-01');
    await budget(FOOD, 500, '2026-05-01');
    await fromExpenses({ year: 2026, month: 4 });
    const after = await budgets();
    expect(after[`2026-03:${FOOD}`]).toBe(300);
    expect(after[`2026-05:${FOOD}`]).toBe(500);
  });

  it('reads December for January', async () => {
    await env.DB.prepare(
      "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'gifts', 80, 80, 'EUR', 'expense', '2025-12-24', ?)"
    )
      .bind(PROFILE, FOOD)
      .run();
    const res = await fromExpenses({ year: 2026, month: 1 });
    expect(await res.json()).toEqual({ ok: true, count: 1, already_budgeted: 0 });
    expect(await budgets()).toEqual({ [`2026-01:${FOOD}`]: 80 });
  });

  it('sets a budget to the cent', async () => {
    for (const amount of [0.1, 0.2]) {
      await env.DB.prepare(
        "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'class', ?, ?, 'EUR', 'expense', '2026-03-15', ?)"
      )
        .bind(PROFILE, amount, amount, GYM)
        .run();
    }
    await fromExpenses({ year: 2026, month: 4 });
    expect((await budgets())[`2026-04:${GYM}`]).toBe(0.3);
  });

  it('answers ok: false when last month has no spending, and writes nothing', async () => {
    await budget(FOOD, 450, '2026-06-01');
    const res = await fromExpenses({ year: 2026, month: 6 });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; message?: string };
    expect(answer.ok).toBe(false);
    expect(await budgets()).toEqual({ [`2026-06:${FOOD}`]: 450 });
  });
});
