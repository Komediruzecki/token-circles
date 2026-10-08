/**
 * Money that budgets, goals and bills move, to the cent, on the Worker: the twin of
 * frontend/src/core/storage/__tests__/moneyParity.test.ts, with the same rows made the same way
 * (every one POSTed, as the app makes them) and the same figures expected.
 *
 * Paying a bill, adding to a goal, allocating, rolling a budget over, copying a month, setting a
 * month from last month's spending and backfilling months from spending each answer an amount that
 * a person reads as money: 739.65, not 739.6500000000001.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 6312;
const PROFILE = 63120;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch(
    ['transactions', 'bills', 'budgets', 'savings_goals', 'accounts', 'categories', 'settings'].map(
      (table) => env.DB.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).bind(PROFILE)
    )
  );
  await env.DB.batch([
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'money-parity@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', ?)"
    ).bind(PROFILE),
  ]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T12:00:00Z'));
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
});

async function send<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

const post = <T = Record<string, unknown>>(path: string, body: unknown) =>
  send<T>('POST', path, body);
const get = <T = Record<string, unknown>>(path: string) => send<T>('GET', path);

async function category(name: string): Promise<number> {
  return (
    await post<{ id: number }>('/api/categories', { name, type: 'expense', color: '#F97316' })
  ).id;
}

async function spend(categoryId: number, date: string, amount: number): Promise<void> {
  await post('/api/transactions', {
    description: 'spent',
    amount,
    type: 'expense',
    date,
    category_id: categoryId,
  });
}

describe('paying a bill', () => {
  it('takes each amount off the account, to the cent', async () => {
    const giro = (
      await post<{ id: number }>('/api/accounts', {
        name: 'Giro',
        type: 'giro',
        currency: 'EUR',
        balance: 10.3,
        starting_balance: 10.3,
      })
    ).id;
    for (const [name, amount] of [
      ['Power', 0.1],
      ['Water', 0.2],
    ] as const) {
      const bill = (
        await post<{ id: number }>('/api/bills', {
          name,
          amount,
          dueDate: '2026-07-15',
          account_id: giro,
        })
      ).id;
      await post(`/api/bills/${bill}/mark-paid`, {});
    }

    const accounts = await get<{ id: number; balance: number }[]>('/api/accounts');
    expect(accounts.find((a) => a.id === giro)).toMatchObject({ balance: 10 });
    // The Worker answers the list as `rows`; local-first answers the list itself.
    const spent = (await get<{ rows: { amount: number; type: string }[] }>('/api/transactions'))
      .rows;
    expect(spent.map((t) => [t.type, t.amount]).sort()).toEqual([
      ['expense', 0.1],
      ['expense', 0.2],
    ]);
  });
});

describe('adding to a goal', () => {
  it('adds to the cent', async () => {
    const goal = (
      await post<{ id: number }>('/api/savings-goals', { name: 'Bike', target_amount: 500 })
    ).id;

    await post(`/api/savings-goals/${goal}/contribute`, { amount: 0.1 });
    const answer = await post<{ current_amount: number }>(`/api/savings-goals/${goal}/contribute`, {
      amount: 0.2,
    });

    expect(answer).toMatchObject({ current_amount: 0.3 });
    const goals = await get<{ id: number; current_amount: number }[]>('/api/savings-goals');
    expect(goals.find((g) => g.id === goal)).toMatchObject({ current_amount: 0.3 });
  });
});

describe('allocating', () => {
  it("leaves the month's income less what is allocated, to the cent", async () => {
    const food = await category('Food');
    await post('/api/transactions', {
      description: 'pay',
      amount: 1000.1,
      type: 'income',
      date: '2026-07-01',
    });

    await post('/api/budgets/allocate?month=2026-07', { category_id: food, amount: 250.55 });
    await post('/api/budgets/allocate?month=2026-07', { category_id: food, amount: 260.45 });

    const summary = await get('/api/budgets/zero-based/summary?month=2026-07');
    expect(summary).toMatchObject({
      income: 1000.1,
      total_budget: 260.45,
      zero_based_remaining: 739.65,
      unassigned_budget: 739.65,
    });
    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets');
    expect(budgets.map((b) => [b.category_id, b.amount, b.start_date])).toEqual([
      [food, 260.45, '2026-07-01'],
    ]);
  });
});

describe('rolling a budget over', () => {
  it("adds what last month left unspent to this month's budget, to the cent", async () => {
    const food = await category('Food');
    const june = await post<{ id: number }>('/api/budgets/allocate?month=2026-06', {
      category_id: food,
      amount: 10.3,
    });
    const july = await post<{ id: number }>('/api/budgets/allocate?month=2026-07', {
      category_id: food,
      amount: 10.3,
    });
    await send('PUT', `/api/budgets/${june.id}/rollover`, { rollover_enabled: true });
    await send('PUT', `/api/budgets/${july.id}/rollover`, { rollover_enabled: true });
    await spend(food, '2026-06-10', 0.1);
    await spend(food, '2026-07-02', 0.2);

    const summary = await get<
      {
        category_id: number;
        auto_rollover: number;
        rollover_contribution: number;
        effective_budget: number;
        effective_remaining: number;
        spent: number;
        remaining: number;
      }[]
    >('/api/budgets/summary?year=2026&month=7');

    expect(summary.find((b) => b.category_id === food)).toMatchObject({
      auto_rollover: 10.2,
      rollover_contribution: 10.2,
      effective_budget: 20.5,
      effective_remaining: 20.3,
      spent: 0.2,
      remaining: 10.1,
    });
  });
});

describe('copying last month', () => {
  it('copies each budget to the cent', async () => {
    const food = await category('Food');
    const rent = await category('Rent');
    await post('/api/budgets/allocate?month=2026-06', { category_id: food, amount: 100.1 });
    await post('/api/budgets/allocate?month=2026-06', { category_id: rent, amount: 900.55 });

    await post('/api/budgets/duplicate-last', { year: 2026, month: 7 });

    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets');
    expect(
      budgets
        .filter((b) => b.start_date === '2026-07-01')
        .map((b) => [b.category_id, b.amount])
        .sort((a, b) => a[0]! - b[0]!)
    ).toEqual([
      [food, 100.1],
      [rent, 900.55],
    ]);
  });
});

describe("setting a month from last month's spending", () => {
  it('sets what was spent, to the cent', async () => {
    const food = await category('Food');
    await spend(food, '2026-06-03', 0.1);
    await spend(food, '2026-06-10', 0.2);
    await spend(food, '2026-06-20', 0.3);

    await post('/api/budgets/from-expenses', { year: 2026, month: 7 });

    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets');
    expect(budgets.map((b) => [b.category_id, b.amount, b.start_date])).toEqual([
      [food, 0.6, '2026-07-01'],
    ]);
  });
});

describe('backfilling budgets from spending', () => {
  it("sets each month's budget to what was spent, to the cent", async () => {
    const food = await category('Food');
    await spend(food, '2026-05-03', 0.1);
    await spend(food, '2026-05-10', 0.2);
    await spend(food, '2026-06-03', 0.1);
    await spend(food, '2026-06-10', 0.2);

    await post('/api/budgets/backfill-from-spending', {
      from_month: '2026-05',
      to_month: '2026-06',
    });

    const budgets =
      await get<{ category_id: number; amount: number; start_date: string }[]>('/api/budgets');
    expect(
      budgets
        .map((b) => [b.category_id, b.amount, b.start_date])
        .sort((a, b) => String(a[2]).localeCompare(String(b[2])))
    ).toEqual([
      [food, 0.3, '2026-05-01'],
      [food, 0.3, '2026-06-01'],
    ]);
  });
});
