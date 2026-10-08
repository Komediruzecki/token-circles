/**
 * What the budget routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/budgetSchema.ts, which local-first and the budget dialogs run too. Before:
 *
 * - A create stored any amount, negative or text included, and a budget without a start date
 *   answered D1's NOT NULL error as a 500.
 * - Another profile's category was a 403 with no field.
 * - An edit wrote every field, so one that left the amount or the start date out failed on D1's
 *   NOT NULL, and one that left rollover out turned it off.
 * - Allocating took any amount and any month; a rollover change took any value.
 *
 * An edit checks and writes only what it changes, so a row stored under older rules (three
 * decimals, a start date in another format, a period no screen offers) stays editable. The
 * local-first twin: frontend/src/core/storage/__tests__/budgetRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { BUDGET_MESSAGES as M } from '../../shared/budgetSchema';

const USER = 6302;
const PROFILE = 63020;
const OTHER_USER = 6303;
const OTHER_PROFILE = 63030;
const FOOD = 630201;
const RENT = 630202;
const ELSEWHERE = 630301; // another user's category
const PLAIN = 630210;
const OLD = 630211; // three decimals, a start date in another format, a period no screen offers

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM budgets WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const category = (id: number, profile: number, name: string) =>
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#F97316')"
    ).bind(id, profile, name);
  const budget = (id: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      category_id: FOOD,
      amount: 250,
      period: 'monthly',
      start_date: '2026-10-01',
      rollover_enabled: 0,
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO budgets (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => row[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'budget-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'budget-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    category(FOOD, PROFILE, 'Food'),
    category(RENT, PROFILE, 'Rent'),
    category(ELSEWHERE, OTHER_PROFILE, 'Elsewhere'),
    budget(PLAIN, {}),
    budget(OLD, {
      category_id: RENT,
      amount: 10.555,
      start_date: '01.10.2026',
      period: 'quarterly',
    }),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
});

afterEach(() => {
  vi.useRealTimers();
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
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

async function refusal(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

async function stored(id: number): Promise<Record<string, unknown> | null> {
  return env.DB.prepare('SELECT * FROM budgets WHERE id = ?').bind(id).first();
}

async function count(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM budgets WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  return Number(row?.n);
}

describe('POST /api/budgets', () => {
  it('refuses a body without a category or an amount, at each field', async () => {
    expect(await refusal(await call('POST', '/api/budgets', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.category} ${M.amount}`,
        fields: { category_id: M.category, amount: M.amount },
      },
    });
    expect(await count()).toBe(2);
  });

  it('refuses an amount that is text, below zero or past the cent', async () => {
    for (const [amount, message] of [
      ['12abc', M.amountNumber],
      [-5, M.amountNegative],
      [12.345, M.amountCents],
    ] as const) {
      const res = await call('POST', '/api/budgets', { category_id: FOOD, amount });
      expect(await refusal(res)).toEqual({
        status: 400,
        body: { error: message, fields: { amount: message } },
      });
    }
    expect(await count()).toBe(2);
  });

  it("refuses another profile's category at its field, as a 400", async () => {
    const res = await call('POST', '/api/budgets', { category_id: ELSEWHERE, amount: 10 });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
  });

  it("starts a budget sent without a start date on the first of the person's month", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
    cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0]!;
    const res = await call('POST', '/api/budgets', { category_id: RENT, amount: '900' });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toMatchObject({
      category_id: RENT,
      amount: 900,
      period: 'monthly',
      start_date: '2026-10-01',
      end_date: null,
      rollover_enabled: 0,
    });
  });

  it('refuses an end date before the start date', async () => {
    const res = await call('POST', '/api/budgets', {
      category_id: FOOD,
      amount: 10,
      start_date: '2026-10-01',
      end_date: '2026-09-30',
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.endDate, fields: { end_date: M.endDate } },
    });
  });
});

describe('PUT /api/budgets/:id', () => {
  it('changes only what it sends: the amount and the start date stay', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}`, { rollover_enabled: true });
    expect(res.status).toBe(200);
    expect(await stored(PLAIN)).toMatchObject({
      amount: 250,
      start_date: '2026-10-01',
      period: 'monthly',
      rollover_enabled: 1,
    });
  });

  it('keeps rollover on when an edit leaves it out', async () => {
    await env.DB.prepare('UPDATE budgets SET rollover_enabled = 1 WHERE id = ?').bind(PLAIN).run();
    expect((await call('PUT', `/api/budgets/${PLAIN}`, { amount: 300 })).status).toBe(200);
    expect(await stored(PLAIN)).toMatchObject({ amount: 300, rollover_enabled: 1 });
  });

  it('saves a row an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/budgets/${OLD}`, {
      category_id: RENT,
      amount: 10.555,
      period: 'quarterly',
      start_date: '01.10.2026',
      rollover_enabled: true,
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toMatchObject({
      amount: 10.555,
      start_date: '01.10.2026',
      period: 'quarterly',
      rollover_enabled: 1,
    });
  });

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/budgets/${OLD}`, { amount: 10.556, start_date: '' });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.amountCents} ${M.startDate}`,
        fields: { amount: M.amountCents, start_date: M.startDate },
      },
    });
    expect(await stored(OLD)).toMatchObject({ amount: 10.555, start_date: '01.10.2026' });
  });

  it("refuses another profile's category at its field, as a 400", async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}`, { category_id: ELSEWHERE });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
    expect(await stored(PLAIN)).toMatchObject({ category_id: FOOD });
  });

  it('answers 404 for a budget the profile does not have', async () => {
    expect((await call('PUT', '/api/budgets/999999', { amount: 1 })).status).toBe(404);
  });
});

describe('POST /api/budgets/allocate', () => {
  it('refuses a body without a category or with a bad amount, at each field', async () => {
    const res = await call('POST', '/api/budgets/allocate?month=2026-10', { amount: -1 });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.category} ${M.amountNegative}`,
        fields: { category_id: M.category, amount: M.amountNegative },
      },
    });
  });

  it('refuses a month it cannot read', async () => {
    const res = await call('POST', '/api/budgets/allocate?month=March', {
      category_id: FOOD,
      amount: 10,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.month, fields: { month: M.month } },
    });
  });

  it("refuses another profile's category at its field, as a 400", async () => {
    const res = await call('POST', '/api/budgets/allocate?month=2026-10', {
      category_id: ELSEWHERE,
      amount: 10,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
  });

  it("sets the month's budget, and changes it when allocated again", async () => {
    const first = await call('POST', '/api/budgets/allocate?month=2026-11', {
      category_id: FOOD,
      amount: '120.50',
    });
    expect(first.status).toBe(200);
    const { id } = (await first.json()) as { id: number };
    await call('POST', '/api/budgets/allocate?month=2026-11', { category_id: FOOD, amount: 99 });
    expect(await stored(id)).toMatchObject({ amount: 99, start_date: '2026-11-01' });
    expect(await count()).toBe(3);
  });
});

describe('PUT /api/budgets/:id/rollover', () => {
  it('refuses values it cannot store, at each field', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, {
      rollover_enabled: 'maybe',
      rollover_used: -1,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.rollover} ${M.rolloverUsed}`,
        fields: { rollover_enabled: M.rollover, rollover_used: M.rolloverUsed },
      },
    });
  });

  it('refuses a body that changes nothing', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, {});
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.rolloverNothing, fields: { rollover_enabled: M.rolloverNothing } },
    });
  });

  it('turns rollover on', async () => {
    const res = await call('PUT', `/api/budgets/${PLAIN}/rollover`, { rollover_enabled: true });
    expect(res.status).toBe(200);
    expect(await stored(PLAIN)).toMatchObject({ rollover_enabled: 1 });
  });
});
