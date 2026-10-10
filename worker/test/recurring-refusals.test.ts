/**
 * What the recurring routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/recurringSchema.ts, which local-first and the Recurring dialog run too. Before:
 *
 * - A rule without an amount answered the transaction rules' sentence at no field; one without a
 *   description or a next date was stored, and so was any type, frequency or day of the month.
 * - Another profile's category or account was a 403 with no field (`foreign-link-status`), and
 *   an edit was refused for a link the rule already held, whether it sent the link or not.
 * - An edit with a blank description stored it blank.
 * - `is_active`, local-first's switch, did nothing here (`recurring-pause`).
 * - Deleting a rule the profile does not have answered 200 (`delete-missing`).
 *
 * An edit checks and writes only what it changes, so a rule an older version stored stays
 * editable. The local-first twin: frontend/src/core/storage/__tests__/recurringRefusals.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie } from './helpers/session';
import { RECURRING_MESSAGES as M } from '../../shared/recurringSchema';

const USER = 6577;
const PROFILE = 65770;
const OTHER_USER = 6578;
const OTHER_PROFILE = 65780;
const HOME = 657701;
const GIRO = 657702;
const SAVINGS = 657703;
const ELSEWHERE_CATEGORY = 657801;
const ELSEWHERE_ACCOUNT = 657802;
const RENT = 657710;
const OLD = 657711; // no description, a type and a frequency no screen offers, another profile's account
const ELSEWHERE_RULE = 657810;

let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recurring_transactions WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM transactions WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(USER, OTHER_USER),
  ]);
  const rule = (id: number, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      description: 'Rent',
      amount: 850.5,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: 1,
      next_date: '2026-03-01',
      category_id: HOME,
      account_id: GIRO,
      notes: 'Flat 4',
      ...values,
    };
    const columns = Object.keys(row);
    return env.DB.prepare(
      `INSERT INTO recurring_transactions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => row[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'recurring-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'recurring-elsewhere@example.com', 'password', 1)"
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
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Home', 'expense', '#F97316')"
    ).bind(HOME, PROFILE),
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, 'Elsewhere', 'expense', '#F97316')"
    ).bind(ELSEWHERE_CATEGORY, OTHER_PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Giro', 'giro', 'EUR', 1000, 1000)"
    ).bind(GIRO, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Savings', 'savings', 'EUR', 0, 0)"
    ).bind(SAVINGS, PROFILE),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Elsewhere', 'giro', 'EUR', 1000, 1000)"
    ).bind(ELSEWHERE_ACCOUNT, OTHER_PROFILE),
    rule(RENT, {}),
    rule(OLD, {
      description: '',
      type: 'deduction',
      frequency: 'biweekly',
      account_id: ELSEWHERE_ACCOUNT,
      notes: '',
    }),
    rule(ELSEWHERE_RULE, {
      profile_id: OTHER_PROFILE,
      category_id: ELSEWHERE_CATEGORY,
      account_id: ELSEWHERE_ACCOUNT,
    }),
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
  return env.DB.prepare(
    `SELECT description, amount, type, frequency, day_of_month, next_date, category_id,
            account_id, transfer_account_id, notes, active
     FROM recurring_transactions WHERE id = ?`
  )
    .bind(id)
    .first();
}

async function count(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM recurring_transactions WHERE profile_id = ?'
  )
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** What the Recurring form posts. */
const FORM = {
  description: 'Gym',
  amount: 30,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: null,
  next_date: '2026-03-05',
  account_id: GIRO,
  transfer_account_id: null,
  category_id: HOME,
  notes: null,
};

const RENT_ROW = {
  description: 'Rent',
  amount: 850.5,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-03-01',
  category_id: HOME,
  account_id: GIRO,
  transfer_account_id: null,
  notes: 'Flat 4',
  active: 1,
};

describe('POST /api/recurring', () => {
  it('refuses a rule without a description, an amount or a next date, at each field', async () => {
    expect(await refusal(await call('POST', '/api/recurring', {}))).toEqual({
      status: 400,
      body: {
        error: `${M.description} ${M.amount} ${M.nextDate}`,
        fields: { description: M.description, amount: M.amount, next_date: M.nextDate },
      },
    });
    expect(await count()).toBe(2);
  });

  it('refuses a type, a frequency, a day of the month and a next date it cannot use', async () => {
    const res = await call('POST', '/api/recurring', {
      ...FORM,
      type: 'deduction',
      frequency: 'fortnightly',
      day_of_month: 32,
      next_date: 'soon',
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.type} ${M.frequency} ${M.dayOfMonth} ${M.nextDateReal}`,
        fields: {
          type: M.type,
          frequency: M.frequency,
          day_of_month: M.dayOfMonth,
          next_date: M.nextDateReal,
        },
      },
    });
    expect(await count()).toBe(2);
  });

  it("refuses another profile's category and accounts at their fields", async () => {
    const res = await call('POST', '/api/recurring', {
      ...FORM,
      account_id: ELSEWHERE_ACCOUNT,
      category_id: ELSEWHERE_CATEGORY,
    });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.account} ${M.category}`,
        fields: { account_id: M.account, category_id: M.category },
      },
    });
    const transfer = await call('POST', '/api/recurring', {
      ...FORM,
      type: 'transfer',
      transfer_account_id: ELSEWHERE_ACCOUNT,
    });
    expect(await refusal(transfer)).toEqual({
      status: 400,
      body: {
        error: M.transferAccount,
        fields: { transfer_account_id: M.transferAccount },
      },
    });
    expect(await count()).toBe(2);
  });

  it('stores what the Recurring form sends, with no day of the month when it has none', async () => {
    const res = await call('POST', '/api/recurring', FORM);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    expect(await stored(id)).toEqual({
      description: 'Gym',
      amount: 30,
      type: 'expense',
      frequency: 'monthly',
      day_of_month: null,
      next_date: '2026-03-05',
      category_id: HOME,
      account_id: GIRO,
      transfer_account_id: null,
      notes: '',
      active: 1,
    });
  });
});

describe('PUT /api/recurring/:id', () => {
  it('changes only what it sends', async () => {
    expect((await call('PUT', `/api/recurring/${RENT}`, { notes: 'Flat 5' })).status).toBe(200);
    expect((await call('PUT', `/api/recurring/${RENT}`, { amount: 900 })).status).toBe(200);
    expect(await stored(RENT)).toEqual({ ...RENT_ROW, amount: 900, notes: 'Flat 5' });
  });

  it('refuses a blank description and an amount of zero at their fields, and stores nothing', async () => {
    const res = await call('PUT', `/api/recurring/${RENT}`, { description: ' ', amount: 0 });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: {
        error: `${M.description} ${M.amountPositive}`,
        fields: { description: M.description, amount: M.amountPositive },
      },
    });
    expect(await stored(RENT)).toEqual(RENT_ROW);
  });

  it("refuses another profile's account when the edit sets it, at its field", async () => {
    const res = await call('PUT', `/api/recurring/${RENT}`, { account_id: ELSEWHERE_ACCOUNT });
    expect(await refusal(res)).toEqual({
      status: 400,
      body: { error: M.account, fields: { account_id: M.account } },
    });
    expect(await stored(RENT)).toEqual(RENT_ROW);
  });

  it('takes back what an older version stored, and changes what the edit changes', async () => {
    const res = await call('PUT', `/api/recurring/${OLD}`, {
      ...FORM,
      description: '',
      amount: 850.5,
      type: 'deduction',
      frequency: 'biweekly',
      day_of_month: 1,
      next_date: '2026-03-01',
      account_id: ELSEWHERE_ACCOUNT,
      notes: 'Still here',
    });
    expect(res.status).toBe(200);
    expect(await stored(OLD)).toMatchObject({
      description: '',
      type: 'deduction',
      frequency: 'biweekly',
      account_id: ELSEWHERE_ACCOUNT,
      notes: 'Still here',
    });
  });

  it('pauses a rule with active or is_active, and the list and upcoming leave it out', async () => {
    expect((await call('PUT', `/api/recurring/${RENT}`, { is_active: false })).status).toBe(200);
    expect((await stored(RENT))?.active).toBe(0);
    const list = (await (await call('GET', '/api/recurring')).json()) as { id: number }[];
    expect(list.map((r) => r.id)).toEqual([OLD]);
    const upcoming = (await (await call('GET', '/api/recurring/upcoming')).json()) as {
      transactions: { id: number }[];
    };
    expect(upcoming.transactions.map((t) => t.id)).not.toContain(RENT);

    expect((await call('PUT', `/api/recurring/${RENT}`, { active: true })).status).toBe(200);
    expect((await stored(RENT))?.active).toBe(1);
  });

  it("answers 404 for another profile's rule, and changes nothing", async () => {
    const res = await call('PUT', `/api/recurring/${ELSEWHERE_RULE}`, { notes: 'Mine now' });
    expect(await refusal(res)).toEqual({ status: 404, body: { error: M.notFound } });
    expect(await refusal(await call('POST', `/api/recurring/${ELSEWHERE_RULE}/populate`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    });
    expect((await stored(ELSEWHERE_RULE))?.notes).toBe('Flat 4');
  });
});

describe('DELETE /api/recurring/:id', () => {
  it("answers 404 for a rule the profile does not have, another profile's included", async () => {
    expect(await refusal(await call('DELETE', `/api/recurring/${ELSEWHERE_RULE}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    });
    expect(await stored(ELSEWHERE_RULE)).not.toBeNull();
    expect((await call('DELETE', `/api/recurring/${RENT}`)).status).toBe(200);
    expect(await refusal(await call('DELETE', `/api/recurring/${RENT}`))).toEqual({
      status: 404,
      body: { error: M.notFound },
    });
  });
});

describe('POST /api/recurring/:id/populate', () => {
  it('says a period already added in plain words', async () => {
    await env.DB.prepare('UPDATE recurring_transactions SET next_date = ? WHERE id = ?')
      .bind('2099-01-01', RENT)
      .run();
    expect(await refusal(await call('POST', `/api/recurring/${RENT}/populate`))).toEqual({
      status: 409,
      body: { error: M.populated },
    });
  });
});
