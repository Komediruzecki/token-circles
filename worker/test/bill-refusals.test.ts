/**
 * What the bill routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/billSchema.ts, which local-first and the Bills dialog run too. Before:
 *
 * - A bill without a name, an amount or a due date answered a sentence with no field.
 * - Any frequency was stored, text included, and an amount with any number of decimals.
 * - Another profile's category or account was a 403 with no field.
 * - An edit with a blank name was stored blank; one with a frequency no screen offers, stored.
 * - Deleting a bill the profile does not have answered 200 (the contract's `delete-missing`).
 *
 * An edit checks and writes only what it changes, so a bill an older version stored (an amount of
 * 0, three decimals, a frequency no screen offers) stays editable. The local-first twin:
 * frontend/src/core/storage/__tests__/billRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { BILL_MESSAGES as M } from '../../shared/billSchema';

const USER = 6306;
const PROFILE = 63060;
const OTHER_USER = 6307;
const OTHER_PROFILE = 63070;
const UTILITIES = 630601;
const GIRO = 630602;
const ELSEWHERE_CATEGORY = 630701;
const ELSEWHERE_ACCOUNT = 630702;
const PLAIN = 630610;
const OLD = 630611; // an amount of 0, three decimals of nothing, a frequency no screen offers
const ELSEWHERE_BILL = 630710;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bills WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const bill = (id: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      name: 'Power',
      amount: 60,
      frequency: 'monthly',
      due_date: '2026-10-15',
      category_id: UTILITIES,
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO bills (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => row[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'bill-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'bill-elsewhere@example.com', 'password', 1)"
    ).bind(OTHER_USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Else')").bind(
      OTHER_PROFILE,
      OTHER_USER
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Utilities', 'expense', '#F97316')"
    ).bind(UTILITIES, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Elsewhere', 'expense', '#F97316')"
    ).bind(ELSEWHERE_CATEGORY, OTHER_PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Elsewhere', 'giro', 'EUR', 1000, 1000)"
    ).bind(ELSEWHERE_ACCOUNT, OTHER_PROFILE),
    bill(PLAIN, {}),
    bill(OLD, { name: 'Old water', amount: 0, frequency: 'daily', day_of_month: 1 }),
    bill(ELSEWHERE_BILL, { profile_id: OTHER_PROFILE, category_id: ELSEWHERE_CATEGORY }),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0]!;
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
  return env.DB.prepare('SELECT * FROM bills WHERE id = ?').bind(id).first();
}

const BILL = { name: 'Internet', amount: 39.99, dueDate: '2026-10-20' };

describe('POST /api/bills', () => {
  it('refuses a bill without a name, an amount or a due date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/bills', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amount} ${M.dueDate}`,
        fields: { name: M.name, amount: M.amount, due_date: M.dueDate },
      },
    });
  });

  it('refuses an amount of zero or past the cent, a date that does not exist, and a frequency no screen offers', async () => {
    const res = await call('POST', '/api/bills', {
      ...BILL,
      amount: 0,
      dueDate: '2026-02-30',
      frequency: 'daily',
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.amountPositive} ${M.dueDateReal} ${M.frequency}`,
        fields: { amount: M.amountPositive, due_date: M.dueDateReal, frequency: M.frequency },
      },
    });
    const cents = await call('POST', '/api/bills', { ...BILL, amount: 9.999 });
    expect(await refusal(cents)).toEqual({
      status: 400,
      body: { error: M.amountCents, fields: { amount: M.amountCents } },
    });
  });

  it("refuses another profile's category or account at its field, as a 400", async () => {
    const category = await call('POST', '/api/bills', {
      ...BILL,
      category_id: ELSEWHERE_CATEGORY,
    });
    expect(await refusal(category)).toEqual({
      status: 400,
      body: { error: M.category, fields: { category_id: M.category } },
    });
    const account = await call('POST', '/api/bills', { ...BILL, account_id: ELSEWHERE_ACCOUNT });
    expect(await refusal(account)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    });
  });

  it('stores what the Bills form sends, and no day of the month it did not send', async () => {
    const res = await call('POST', '/api/bills', {
      ...BILL,
      category_id: UTILITIES,
      frequency: 'monthly',
      autopay: true,
      type: 'subscription',
    });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toMatchObject({
      name: 'Internet',
      amount: 39.99,
      due_date: '2026-10-20',
      frequency: 'monthly',
      day_of_month: null,
      category_id: UTILITIES,
      account_id: null,
      type: 'subscription',
      autopay: 1,
      is_active: 1,
    });
  });
});

describe('PUT /api/bills/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/bills/${PLAIN}`, { amount: '65.50' })).status).toBe(200);
    expect(await stored(PLAIN)).toMatchObject({
      name: 'Power',
      amount: 65.5,
      due_date: '2026-10-15',
      category_id: UTILITIES,
    });
  });

  it('saves a bill an older version stored, when its values come back unchanged', async () => {
    const res = await call('PUT', `/api/bills/${OLD}`, {
      name: 'Water',
      amount: 0,
      dueDate: '2026-10-15',
      category_id: UTILITIES,
      frequency: 'daily',
      autopay: false,
      type: 'bill',
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toMatchObject({ name: 'Water', amount: 0, frequency: 'daily' });
  });

  it('refuses what an edit changes to a value the rules do not take', async () => {
    const res = await call('PUT', `/api/bills/${OLD}`, { name: ' ', amount: -1 });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.name} ${M.amountPositive}`,
        fields: { name: M.name, amount: M.amountPositive },
      },
    });
    expect(await stored(OLD)).toMatchObject({ name: 'Old water', amount: 0 });
  });

  it("refuses another profile's category or account at its field, as a 400", async () => {
    const res = await call('PUT', `/api/bills/${PLAIN}`, { account_id: ELSEWHERE_ACCOUNT });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    });
  });

  it('pauses a bill', async () => {
    expect((await call('PUT', `/api/bills/${PLAIN}`, { is_active: false })).status).toBe(200);
    expect(await stored(PLAIN)).toMatchObject({ is_active: 0 });
  });

  it("answers 404 for a bill the profile does not have, another profile's included", async () => {
    expect((await call('PUT', '/api/bills/999999', { name: 'x' })).status).toBe(404);
    expect((await call('PUT', `/api/bills/${ELSEWHERE_BILL}`, { name: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/bills/:id', () => {
  it("answers 404 for a bill the profile does not have, another profile's included, and deletes nothing", async () => {
    expect((await call('DELETE', '/api/bills/999999')).status).toBe(404);
    expect((await call('DELETE', `/api/bills/${ELSEWHERE_BILL}`)).status).toBe(404);
    expect(await stored(ELSEWHERE_BILL)).not.toBeNull();
  });

  it('deletes a bill the profile has', async () => {
    expect((await call('DELETE', `/api/bills/${PLAIN}`)).status).toBe(200);
    expect(await stored(PLAIN)).toBeNull();
  });
});
