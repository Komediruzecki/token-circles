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
import { sessionCookie } from './helpers/session';

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
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
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

describe('the emergency fund', () => {
  it('reaches back twelve months from 29 February to 28 February', async () => {
    // A year before 29 February 2028 is 28 February 2027. Date.setMonth() made it 29 February
    // 2027, which is 1 March, and left February 2027 out of the average.
    await at('2028-02-29T12:00:00Z');
    await expense('2027-02-28', 120);
    await expense('2028-02-10', 300);

    const fund = await get<{ avgMonthlyExpenses: number }>('/api/calculator/emergency-fund');
    expect(fund.avgMonthlyExpenses).toBe(210);
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

describe('a monthly rule on the 31st', () => {
  async function rule(fields: Record<string, unknown>): Promise<number> {
    const row = {
      profile_id: PROFILE,
      description: 'Rent',
      amount: 250,
      type: 'expense',
      account_id: GIRO,
      frequency: 'monthly',
      active: 1,
      ...fields,
    };
    const cols = Object.keys(row);
    const res = await env.DB.prepare(
      `INSERT INTO recurring_transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...Object.values(row))
      .run();
    return Number(res.meta.last_row_id);
  }

  async function nextDateOf(id: number): Promise<string> {
    const row = await env.DB.prepare('SELECT next_date FROM recurring_transactions WHERE id = ?')
      .bind(id)
      .first<{ next_date: string }>();
    return String(row?.next_date);
  }

  async function paidOn(): Promise<string[]> {
    const { results } = await env.DB.prepare(
      'SELECT date FROM transactions WHERE profile_id = ? ORDER BY date'
    )
      .bind(PROFILE)
      .all<{ date: string }>();
    return results.map((r) => r.date);
  }

  it('is paid at the end of February, and on the 31st again in March', async () => {
    const id = await rule({ next_date: '2027-01-31', day_of_month: 31 });
    await at('2027-01-31T12:00:00Z');
    expect((await send('POST', `/api/recurring/${id}/populate`)).status).toBe(200);
    expect(await nextDateOf(id)).toBe('2027-02-28');

    await at('2027-02-28T12:00:00Z');
    expect((await send('POST', `/api/recurring/${id}/populate`)).status).toBe(200);
    expect(await nextDateOf(id)).toBe('2027-03-31');
    expect(await paidOn()).toEqual(['2027-01-31', '2027-02-28']);
  });

  it('without a day of the month, stays on the 28th after February', async () => {
    const id = await rule({ next_date: '2027-01-31', day_of_month: null });
    await at('2027-02-28T12:00:00Z');
    await send('POST', `/api/recurring/${id}/populate`);
    expect(await nextDateOf(id)).toBe('2027-02-28');
    await send('POST', `/api/recurring/${id}/populate`);
    expect(await nextDateOf(id)).toBe('2027-03-28');
  });

  it('lists February among the next 30 days', async () => {
    const id = await rule({ next_date: '2027-01-31', day_of_month: 31 });
    await at('2027-01-30T12:00:00Z');
    const { transactions } = await get<{ transactions: { id: number; next_date: string }[] }>(
      '/api/recurring/upcoming'
    );
    expect(transactions.filter((t) => t.id === id).map((t) => t.next_date)).toEqual([
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('lists an overdue rule once today, then on its own day', async () => {
    // Populate writes 31 August and 30 September, and 31 October is the rule's next date.
    const id = await rule({ next_date: '2026-08-31', day_of_month: 31 });
    await at('2026-10-20T12:00:00Z');
    const { transactions } = await get<{ transactions: { id: number; next_date: string }[] }>(
      '/api/recurring/upcoming'
    );
    expect(transactions.filter((t) => t.id === id).map((t) => t.next_date)).toEqual([
      '2026-10-20',
      '2026-10-31',
    ]);
  });

  it('refuses a next date it cannot read, and writes nothing', async () => {
    // A date an API client wrote in its own format. It sorts before today, so it passes the
    // already-populated check and reaches the step.
    const id = await rule({ next_date: '05.01.2027' });
    await at('2027-01-10T12:00:00Z');
    const res = await send('POST', `/api/recurring/${id}/populate`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "This rule's next date can't be read. Edit the rule and set its date again."
    );
    expect(await paidOn()).toEqual([]);
    expect(await nextDateOf(id)).toBe('05.01.2027');
  });
});

describe('upcoming bills', () => {
  type Upcoming = {
    id: number;
    next_due_date: string | null;
    days_until: number | null;
    is_overdue: boolean;
  };

  async function bill(fields: Record<string, unknown>): Promise<number> {
    const row = { profile_id: PROFILE, name: 'Power', amount: 60, is_active: 1, ...fields };
    const cols = Object.keys(row);
    const res = await env.DB.prepare(
      `INSERT INTO bills (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...Object.values(row))
      .run();
    return Number(res.meta.last_row_id);
  }

  async function upcomingOf(id: number): Promise<Upcoming | undefined> {
    return (await get<Upcoming[]>('/api/bills/upcoming')).find((b) => b.id === id);
  }

  it('keep a monthly bill due today until the day is over', async () => {
    const monthly = await bill({ frequency: 'monthly', day_of_month: 8, due_date: '2026-10-08' });
    for (const instant of ['2026-10-08T00:30:00Z', '2026-10-08T23:30:00Z']) {
      await at(instant);
      expect(await upcomingOf(monthly), instant).toMatchObject({
        next_due_date: '2026-10-08',
        days_until: 0,
        is_overdue: false,
      });
    }
  });

  it('keep a yearly bill due today', async () => {
    const yearly = await bill({ frequency: 'yearly', day_of_month: 8, due_date: '2027-01-08' });
    await at('2027-01-08T09:00:00Z');
    expect(await upcomingOf(yearly)).toMatchObject({ next_due_date: '2027-01-08', days_until: 0 });
  });

  // A bill paid for this month falls due next month; one whose day has passed unpaid is overdue
  // (worker/test/bill-schedule.test.ts). Either way the month it lands in may be shorter.
  it('move a bill paid this month to the last day of a shorter month', async () => {
    const id = await bill({
      frequency: 'monthly',
      day_of_month: 30,
      due_date: '2027-01-30',
      last_paid_date: '2027-01-30',
    });
    await at('2027-01-31T12:00:00Z');
    expect(await upcomingOf(id)).toMatchObject({ next_due_date: '2027-02-28', days_until: 28 });
  });

  it('keep a bill on the 31st once February is paid, without staying on the 28th', async () => {
    const id = await bill({
      frequency: 'monthly',
      day_of_month: 31,
      due_date: '2027-01-31',
      last_paid_date: '2027-02-28',
    });
    await at('2027-02-28T12:00:00Z');
    expect(await upcomingOf(id)).toMatchObject({ next_due_date: '2027-03-31', days_until: 31 });
  });
});

describe('the bills calendar', () => {
  type Calendar = {
    days: Record<string, Array<{ id: number; date: string }>>;
    summary: { totalAmount: number; billCount: number };
  };

  async function bill(fields: Record<string, unknown>): Promise<number> {
    const row = { profile_id: PROFILE, name: 'Rent', amount: 600, is_active: 1, ...fields };
    const cols = Object.keys(row);
    const res = await env.DB.prepare(
      `INSERT INTO bills (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    )
      .bind(...Object.values(row))
      .run();
    return Number(res.meta.last_row_id);
  }

  /** The dates `id` is drawn on in that month's calendar. */
  async function drawnOn(id: number, year: number, month: number): Promise<string[]> {
    const calendar = await get<Calendar>(`/api/bills/calendar?year=${year}&month=${month}`);
    return Object.values(calendar.days)
      .flat()
      .filter((b) => b.id === id)
      .map((b) => b.date);
  }

  it('draws a monthly bill due on the 31st on the last day of a shorter month', async () => {
    await at('2027-01-10T12:00:00Z');
    const id = await bill({ frequency: 'monthly', day_of_month: 31, due_date: '2027-01-31' });
    expect(await drawnOn(id, 2027, 1)).toEqual(['2027-01-31']);
    expect(await drawnOn(id, 2027, 2)).toEqual(['2027-02-28']);
    expect(await drawnOn(id, 2027, 3)).toEqual(['2027-03-31']);
    expect(await drawnOn(id, 2027, 4)).toEqual(['2027-04-30']);
    expect(await drawnOn(id, 2028, 2)).toEqual(['2028-02-29']);
  });

  it('counts it in the month it is drawn in', async () => {
    await at('2027-02-10T12:00:00Z');
    await bill({ frequency: 'monthly', day_of_month: 30, due_date: '2027-01-30' });
    const february = await get<Calendar>('/api/bills/calendar?year=2027&month=2');
    expect(february.summary).toMatchObject({ totalAmount: 600, billCount: 1 });
    expect(february.days['28']?.map((b) => b.date)).toEqual(['2027-02-28']);
  });
});
