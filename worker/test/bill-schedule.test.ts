/**
 * When a bill falls due next, and whether it is paid: one rule (shared/billSchedule.ts) for the
 * Bills list, GET /api/bills/upcoming, the Dashboard's Upcoming Bills and mark-paid.
 *
 * Before:
 *
 * - The Dashboard listed the bills whose stored due date fell in the next 30 days. That date is the
 *   one a bill was saved with, and marking it paid never moves it, so a monthly bill left the card
 *   for good once its first date had passed. It listed paused bills too.
 * - GET /api/bills/upcoming read `last_paid`, a column nothing writes, so a payment never moved a
 *   bill on; it went by the day of the month alone, the 1st for every bill the Bills form saves; it
 *   gave a biweekly bill no date; and a bill whose day had passed unpaid moved to next month
 *   instead of being overdue, as the calendar and the Bills page call it.
 * - The list answered the stored next_due_date, which is always NULL.
 * - A weekly bill paid a week ago could not be paid on the day it fell due again: the period
 *   counted 8 days back, so only once it was overdue.
 *
 * The local-first twin: frontend/src/core/storage/__tests__/localHandlers.billSchedule.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 6308;
const PROFILE = 63080;
const GIRO = 630801;
const UTILITIES = 630802;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM bills WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'bill-schedule@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Utilities', 'expense', '#F97316')"
    ).bind(UTILITIES, PROFILE),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Stop the clock at noon UTC on `date` and sign in at it. No X-Time-Zone: UTC's calendar. */
async function on(date: string): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${date}T12:00:00Z`));
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get<T>(path: string): Promise<T> {
  const res = await send('GET', path);
  expect(res.status, `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}

/** A bill as the Bills form saves it: no day of the month, its due date the first one. */
async function bill(name: string, fields: Record<string, unknown>): Promise<number> {
  const res = await send('POST', '/api/bills', {
    name,
    amount: 60,
    frequency: 'monthly',
    account_id: GIRO,
    category_id: UTILITIES,
    ...fields,
  });
  expect(res.status, `POST ${name}`).toBe(200);
  return ((await res.json()) as { id: number }).id;
}

type Due = {
  id: number;
  name: string;
  next_due_date: string;
  days_until: number;
  is_overdue: boolean;
  paid: boolean;
  last_paid: string | null;
};

const upcoming = () => get<Due[]>('/api/bills/upcoming');
const dashboard = async () =>
  (await get<{ upcomingBills: Due[] }>('/api/dashboard')).upcomingBills.map((b) => ({
    name: b.name,
    next_due_date: b.next_due_date,
    days_until: b.days_until,
  }));

describe("the Dashboard's Upcoming Bills", () => {
  it('lists a monthly bill every month, by the day of its first due date', async () => {
    await on('2026-10-08');
    await bill('Power', { dueDate: '2026-08-20' });
    expect(await dashboard()).toEqual([
      { name: 'Power', next_due_date: '2026-10-20', days_until: 12 },
    ]);
  });

  it('moves a bill on once it is paid', async () => {
    await on('2026-10-25');
    const id = await bill('Water', { dueDate: '2026-09-28' });
    expect(await dashboard()).toEqual([
      { name: 'Water', next_due_date: '2026-10-28', days_until: 3 },
    ]);
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200);
    // November's is 34 days away: past the card's 30.
    expect(await dashboard()).toEqual([]);
    expect((await upcoming())[0]).toMatchObject({ next_due_date: '2026-11-28', paid: true });
  });

  it('lists no paused bill, and none that is overdue', async () => {
    await on('2026-10-08');
    const paused = await bill('Gym', { dueDate: '2026-10-10' });
    expect((await send('PUT', `/api/bills/${paused}`, { is_active: false })).status).toBe(200);
    await bill('Phone', { dueDate: '2026-09-05' });
    await bill('Rent', { dueDate: '2026-10-08' });
    expect((await dashboard()).map((b) => b.name)).toEqual(['Rent']);
  });

  it('lists the soonest five', async () => {
    await on('2026-10-01');
    for (const [name, day] of [
      ['F', '06'],
      ['B', '02'],
      ['E', '05'],
      ['A', '01'],
      ['D', '04'],
      ['C', '03'],
    ] as const) {
      await bill(name, { dueDate: `2026-10-${day}` });
    }
    expect((await dashboard()).map((b) => b.name)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('GET /api/bills/upcoming', () => {
  it('goes by the due date’s day, not the 1st, for a bill saved without a day of the month', async () => {
    await on('2026-10-08');
    await bill('Power', { dueDate: '2026-09-15' });
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-15',
      days_until: 7,
      is_overdue: false,
      paid: false,
    });
  });

  it('reads the payment from last_paid_date, and answers it as last_paid too', async () => {
    await on('2026-10-08');
    const id = await bill('Power', { dueDate: '2026-09-15' });
    await env.DB.prepare(
      "UPDATE bills SET last_paid_date = '2026-10-02', last_paid = NULL WHERE id = ?"
    )
      .bind(id)
      .run();
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-11-15',
      paid: true,
      last_paid: '2026-10-02',
    });
  });

  it('calls a bill whose day has passed unpaid overdue, the most overdue first', async () => {
    await on('2026-10-20');
    await bill('Power', { dueDate: '2026-09-15' });
    await bill('Phone', { dueDate: '2026-09-05' });
    await bill('Rent', { dueDate: '2026-09-25' });
    expect(
      (await upcoming()).map((b) => [b.name, b.next_due_date, b.days_until, b.is_overdue])
    ).toEqual([
      ['Phone', '2026-10-05', -15, true],
      ['Power', '2026-10-15', -5, true],
      ['Rent', '2026-10-25', 5, false],
    ]);
  });

  it('gives a biweekly bill its date, two weeks after it was paid', async () => {
    await on('2026-09-29');
    const id = await bill('Cleaner', { dueDate: '2026-09-29', frequency: 'biweekly' });
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200);
    await on('2026-10-08');
    expect((await upcoming())[0]).toMatchObject({
      next_due_date: '2026-10-13',
      days_until: 5,
      paid: true,
    });
  });
});

describe('GET /api/bills', () => {
  it('answers when each bill falls due next', async () => {
    await on('2026-10-08');
    await bill('Power', { dueDate: '2026-08-20' });
    const [power] = await get<{ next_due_date: string | null; due_date: string }[]>('/api/bills');
    expect(power).toMatchObject({ due_date: '2026-08-20', next_due_date: '2026-10-20' });
  });

  it("names each bill's category, as local-first's list does", async () => {
    await on('2026-10-08');
    await bill('Power', { dueDate: '2026-08-20' });
    await bill('Rent', { dueDate: '2026-08-01', category_id: null });
    const list =
      await get<{ name: string; category_name: unknown; category_color: unknown }[]>('/api/bills');
    expect(list.map((b) => [b.name, b.category_name, b.category_color])).toEqual([
      ['Power', 'Utilities', '#F97316'],
      ['Rent', null, null],
    ]);
  });
});

describe('a weekly bill', () => {
  it('can be paid on the day it falls due again, a week after the last payment', async () => {
    await on('2026-10-01');
    const id = await bill('Cleaner', { dueDate: '2026-10-01', frequency: 'weekly', amount: 25 });
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200);
    await on('2026-10-07');
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(409);
    await on('2026-10-08');
    expect((await upcoming())[0]).toMatchObject({ next_due_date: '2026-10-08', days_until: 0 });
    expect((await send('POST', `/api/bills/${id}/mark-paid`)).status).toBe(200);
    const balance = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
      .bind(GIRO)
      .first<{ balance: number }>();
    expect(balance?.balance).toBe(950);
  });
});
