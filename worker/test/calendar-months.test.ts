/**
 * Months on the 29th to the 31st, and "today" as a date rather than an instant.
 *
 * Date.setMonth() overflows when the month it lands in is shorter: 31 October minus eleven months
 * is 31 November, which is 1 December. Twelve months of totals began on 1 December and left
 * November out; a monthly rule on the 31st went from January to 3 March. A due date compared with
 * the current instant was already in the past at 00:01 on the day it fell due.
 *
 * Only Date is faked, and the session is issued after the clock is set, so the cookie is valid at
 * the pinned instant. No X-Time-Zone, so the Worker's calendar is UTC's.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 82;
const PROFILE = 820;
const FOOD = 821;
const GIRO = 8210;

let cookie = '';

beforeEach(async () => {
  for (const table of [
    'transactions',
    'recurring_transactions',
    'bills',
    'budgets',
    'accounts',
    'categories',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).bind(PROFILE).run();
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE).run();
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'months@example.com', 'password', 1, 'advanced')"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Food', 'expense', '#F97316')"
    ).bind(FOOD, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stop the clock at `instant` and sign in at it. */
async function at(instant: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
}

async function send(method: string, path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE) },
  });
}

async function get<T>(path: string): Promise<T> {
  const res = await send('GET', path);
  expect(res.status, `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}

async function expense(date: string, amount: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO transactions (profile_id, description, amount, amount_local, currency, type, date, category_id) VALUES (?, 'groceries', ?, ?, 'EUR', 'expense', ?, ?)"
  )
    .bind(PROFILE, amount, amount, date, FOOD)
    .run();
}

type Month = { month: string; expense: number };

describe('twelve months of totals', () => {
  it('keep November on 31 October', async () => {
    await at('2026-10-31T12:00:00Z');
    await expense('2025-11-05', 40);
    await expense('2026-10-02', 10);

    const stats = await get<Month[]>('/api/stats/monthly?months=12');
    expect(stats.map((m) => m.month)[0]).toBe('2025-11');
    expect(stats.find((m) => m.month === '2025-11')?.expense).toBe(40);

    const { monthly } = await get<{ monthly: Month[] }>('/api/dashboard/charts?months=12');
    expect(monthly.find((m) => m.month === '2025-11')?.expense).toBe(40);
  });

  it("count their first month whole, not from today's day of it", async () => {
    await at('2026-10-15T12:00:00Z');
    await expense('2025-11-05', 40);
    await expense('2025-10-31', 500);

    const stats = await get<Month[]>('/api/stats/monthly?months=12');
    expect(stats.find((m) => m.month === '2025-11')?.expense).toBe(40);
    expect(stats.find((m) => m.month === '2025-10')).toBeUndefined();

    const { monthly } = await get<{ monthly: Month[] }>('/api/dashboard/charts?months=12');
    expect(monthly.find((m) => m.month === '2025-11')?.expense).toBe(40);
    expect(monthly.find((m) => m.month === '2025-10')).toBeUndefined();
  });
});

describe('the budget forecast', () => {
  it('counts the budgets that start in the month it is asked for', async () => {
    await at('2026-10-15T12:00:00Z');
    await env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, period, start_date) VALUES (?, ?, 300, 'monthly', '2026-10-01')"
    )
      .bind(PROFILE, FOOD)
      .run();

    for (const path of ['/api/budgets/forecast?month=2026-10', '/api/budgets/forecast']) {
      const forecast = await get<{ total_budget: number; forecast: unknown[] }>(path);
      expect(forecast.total_budget, path).toBe(300);
      expect(forecast.forecast, path).toHaveLength(6);
    }
  });
});
