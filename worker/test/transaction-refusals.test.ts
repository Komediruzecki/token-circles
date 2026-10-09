/**
 * What the transactions routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }`: `fields` names each body field that is wrong
 * with a sentence for people, and `error` joins them for a client that cannot place them
 * (shared/refusal.ts). The rules are shared/transactionSchema.ts, the same ones local-first and
 * the Transactions form run, so the runtimes agree on what a transaction may be:
 *
 * - The route answered zod's issue list ("Invalid transaction: amount: must have at most 2 decimal
 *   places"), or an invariant's sentence, with no field to put it under.
 * - A description is optional in both runtimes. Here a body without one answered a 500 with D1's
 *   type error, since `undefined` cannot be bound.
 * - A date that is given has to be a real date written YYYY-MM-DD. The route stored anything.
 * - An account or a category of another profile is a 400 at its field. It was a 403.
 * - An edit never refuses a value the row already holds, and never writes it either. Rows saved
 *   under older rules (three decimals, an odd date, a transfer without a destination, a link to
 *   another profile's account) stay editable, though the Transactions form sends every field on
 *   every save. That form edit also no longer clears a foreign-currency row's local amount, which
 *   moved its account's balance on a description change.
 * - An edit that changes nothing answers 200. It answered 400 "No valid fields provided for
 *   update", which a save that changed only the tags would hit once unchanged fields are dropped.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionCookie } from './helpers/session';
import { TRANSACTION_MESSAGES as M } from '../../shared/transactionSchema';

const USER = 9831;
const PROFILE = 98310;
const OTHER_PROFILE = 98311;
const EVERYDAY = 983101;
const SAVINGS = 983102;
const ELSEWHERE_ACCOUNT = 983103; // another profile's
const GROCERIES = 983104;
const ELSEWHERE_CATEGORY = 983105; // another profile's
const RENT = 983106;

const PLAIN = 983110;
// Rows saved under older rules, or by the other runtime, which a create now refuses.
const CENTS = 983111; // an amount with three decimals
const DATED = 983112; // a date that is not YYYY-MM-DD
const EURO = 983113; // a currency that is not a code
const NO_DESTINATION = 983114; // a transfer with no account to go to
const CROSS_LINKED = 983115; // an account of another profile
// Rows the rules accept, whose edits used to go wrong.
const FX = 983116; // 100 USD, 92 in the base currency
const TRANSFER = 983117;

let cookie = '';

const TX_COLUMNS =
  'id, profile_id, type, description, amount, amount_local, currency, exchange_rate, date, category_id, account_id, transfer_account_id, notes, beneficiary, payor, means_of_payment';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)').bind(
      PROFILE,
      OTHER_PROFILE
    ),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(PROFILE, OTHER_PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const account = (id: number, profile: number, name: string, balance: number) =>
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, ?, 'giro', 'EUR', ?, ?)"
    ).bind(id, profile, name, balance, balance);
  const category = (id: number, profile: number, name: string) =>
    env.DB.prepare(
      "INSERT INTO categories (id, profile_id, name, type, color) VALUES (?, ?, ?, 'expense', '#6e9bff')"
    ).bind(id, profile, name);
  const row = (values: Record<string, unknown>) => {
    const full: Record<string, unknown> = {
      profile_id: PROFILE,
      type: 'expense',
      description: 'Row',
      amount: 10,
      amount_local: 10,
      currency: 'EUR',
      exchange_rate: 1,
      date: '2026-10-01',
      category_id: null,
      account_id: EVERYDAY,
      transfer_account_id: null,
      notes: '',
      beneficiary: '',
      payor: '',
      means_of_payment: '',
      ...values,
    };
    const columns = Object.keys(full);
    return env.DB.prepare(
      `INSERT INTO transactions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => full[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'transaction-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Refusals')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Elsewhere')").bind(
      OTHER_PROFILE,
      USER
    ),
    account(EVERYDAY, PROFILE, 'Everyday', 1000),
    account(SAVINGS, PROFILE, 'Savings', 500),
    account(ELSEWHERE_ACCOUNT, OTHER_PROFILE, 'Elsewhere', 300),
    category(GROCERIES, PROFILE, 'Groceries'),
    category(RENT, PROFILE, 'Rent'),
    category(ELSEWHERE_CATEGORY, OTHER_PROFILE, 'Elsewhere'),
    row({
      id: PLAIN,
      description: 'Weekly groceries',
      amount: 82.4,
      amount_local: 82.4,
      category_id: GROCERIES,
      notes: 'From the market',
    }),
    row({ id: CENTS, description: 'Old cents', amount: 12.345, amount_local: 12.345 }),
    row({ id: DATED, description: 'Old date', date: '2026-1-5' }),
    row({ id: EURO, description: 'Old currency', currency: 'euro' }),
    row({ id: NO_DESTINATION, description: 'Half a transfer', type: 'transfer', amount: 50 }),
    row({ id: CROSS_LINKED, description: 'Cross-linked', account_id: ELSEWHERE_ACCOUNT }),
    row({
      id: FX,
      description: 'Hotel',
      amount: 100,
      amount_local: 92,
      currency: 'USD',
      exchange_rate: 0.92,
    }),
    row({
      id: TRANSFER,
      description: 'To savings',
      type: 'transfer',
      amount: 40,
      amount_local: 40,
      transfer_account_id: SAVINGS,
    }),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

function call(method: string, path: string, body?: unknown): Promise<Response> {
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

const create = (body: unknown) => call('POST', '/api/transactions', body);
const edit = (id: number, body: unknown) => call('PUT', `/api/transactions/${id}`, body);

type Row = Record<string, unknown>;

async function stored(id: number): Promise<Row> {
  const row = await env.DB.prepare(`SELECT ${TX_COLUMNS} FROM transactions WHERE id = ?`)
    .bind(id)
    .first<Row>();
  if (!row) throw new Error(`no transaction ${id}`);
  return row;
}

async function storedBy(description: string): Promise<Row[]> {
  const rows = await env.DB.prepare(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE profile_id = ? AND description = ?`
  )
    .bind(PROFILE, description)
    .all<Row>();
  return rows.results;
}

async function balances(): Promise<Record<number, number>> {
  const rows = await env.DB.prepare('SELECT id, balance FROM accounts WHERE profile_id IN (?, ?)')
    .bind(PROFILE, OTHER_PROFILE)
    .all<{ id: number; balance: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.id, r.balance]));
}

/**
 * Each account's balance, to the cent. An edit reverses a row and applies it again, so a balance
 * it leaves alone can come back as 1000.0000000000001.
 */
async function expectBalances(expected: Record<number, number>): Promise<void> {
  const actual = await balances();
  for (const [id, balance] of Object.entries(expected)) {
    expect(actual[Number(id)], `account ${id}`).toBeCloseTo(balance, 6);
  }
}

/** What the Transactions form sends on every save: every field it shows, from the row. */
function formBody(row: Row, change: Row = {}): Row {
  return {
    type: row.type,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    date: row.date,
    category_id: row.category_id,
    transfer_account_id: row.type === 'transfer' ? row.transfer_account_id : null,
    account_id: row.account_id,
    beneficiary: row.beneficiary,
    payor: row.payor,
    exchange_rate: row.exchange_rate,
    notes: row.notes,
    means_of_payment: row.means_of_payment,
    ...change,
  };
}

async function refusal(res: Response): Promise<{ error: string; fields?: Record<string, string> }> {
  expect(res.status).toBe(400);
  return (await res.json()) as { error: string; fields?: Record<string, string> };
}

describe('a new transaction', () => {
  it('saves what the form sends, read the way the rules read it', async () => {
    const res = await create({
      type: 'expense',
      description: '  Market run ',
      amount: '23.50',
      date: '2026-10-07',
      category_id: String(GROCERIES),
      account_id: EVERYDAY,
      currency: 'eur',
      notes: '',
    });
    expect(res.status).toBe(200);

    const [row] = await storedBy('Market run');
    expect(row).toMatchObject({
      type: 'expense',
      amount: 23.5,
      amount_local: 23.5,
      currency: 'EUR',
      exchange_rate: 1,
      date: '2026-10-07',
      category_id: GROCERIES,
      account_id: EVERYDAY,
      notes: '',
    });
    await expectBalances({ [EVERYDAY]: 976.5 });
  });

  it('saves without a description, as an import or an API client sends it', async () => {
    const res = await create({ type: 'income', amount: 40, date: '2026-10-02' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).description).toBe('');
  });

  it('saves a deduction, which moves no balance', async () => {
    const res = await create({ type: 'deduction', amount: 15, account_id: EVERYDAY });
    expect(res.status).toBe(200);
    await expectBalances({ [EVERYDAY]: 1000 });
  });

  it('answers a refusal with each field and a summary of them all', async () => {
    const body = await refusal(
      await create({ type: 'transfer', amount: '', account_id: EVERYDAY })
    );
    expect(body).toEqual({
      error: `${M.amount} ${M.transferTo}`,
      fields: { amount: M.amount, transfer_account_id: M.transferTo },
    });
  });

  it.each([
    ['no type', { amount: 5 }, { type: M.type }],
    ['an unknown type', { type: 'refund', amount: 5 }, { type: M.type }],
    ['no amount', { type: 'expense' }, { amount: M.amount }],
    ['an amount of zero', { type: 'expense', amount: 0 }, { amount: M.amountPositive }],
    ['a negative income', { type: 'income', amount: -20 }, { amount: M.amountPositive }],
    ['three decimals', { type: 'expense', amount: 100.555 }, { amount: M.amountCents }],
    [
      'an amount that is not a number',
      { type: 'expense', amount: 'foo' },
      { amount: M.amountNumber },
    ],
    ['an amount out of range', { type: 'expense', amount: 1e308 }, { amount: M.amountMax }],
    [
      'a date that does not exist',
      { type: 'expense', amount: 5, date: '2026-02-30' },
      { date: M.date },
    ],
    [
      'a timestamp for a date',
      { type: 'expense', amount: 5, date: '2026-10-08T22:30:00.000Z' },
      { date: M.date },
    ],
    [
      'a currency that is not a code',
      { type: 'expense', amount: 5, currency: 'euro' },
      { currency: M.currency },
    ],
    [
      'an account id that is not one',
      { type: 'expense', amount: 5, account_id: 'abc' },
      { account_id: M.account },
    ],
    [
      'a category id that is not one',
      { type: 'expense', amount: 5, category_id: 1.5 },
      { category_id: M.category },
    ],
    [
      'a local amount of zero',
      { type: 'expense', amount: 5, amount_local: 0 },
      { amount_local: M.amountLocal },
    ],
    [
      'an exchange rate of zero',
      { type: 'expense', amount: 5, exchange_rate: 0 },
      { exchange_rate: M.exchangeRate },
    ],
  ])('refuses %s', async (_, body, fields) => {
    expect((await refusal(await create(body))).fields).toEqual(fields);
    expect(await storedBy('')).toEqual([]);
  });

  it('refuses a transfer without its accounts, or with the same one twice', async () => {
    expect((await refusal(await create({ type: 'transfer', amount: 5 }))).fields).toEqual({
      account_id: M.transferFrom,
      transfer_account_id: M.transferTo,
    });
    expect(
      (
        await refusal(
          await create({
            type: 'transfer',
            amount: 5,
            account_id: EVERYDAY,
            transfer_account_id: EVERYDAY,
          })
        )
      ).fields
    ).toEqual({ transfer_account_id: M.transferSame });
    await expectBalances({ [EVERYDAY]: 1000 });
  });

  it('takes the account the money leaves from its name, before it judges a transfer', async () => {
    const res = await create({
      type: 'transfer',
      description: 'By name',
      amount: 25,
      means_of_payment: 'everyday',
      transfer_account_id: SAVINGS,
    });
    expect(res.status).toBe(200);
    expect((await storedBy('By name'))[0]).toMatchObject({ account_id: EVERYDAY });
  });

  it("refuses another profile's account or category at its field, and moves no balance", async () => {
    expect(
      (
        await refusal(
          await create({
            type: 'transfer',
            amount: 5,
            account_id: EVERYDAY,
            transfer_account_id: ELSEWHERE_ACCOUNT,
            category_id: ELSEWHERE_CATEGORY,
          })
        )
      ).fields
    ).toEqual({ transfer_account_id: M.account, category_id: M.category });
    expect(await balances()).toEqual({
      [EVERYDAY]: 1000,
      [SAVINGS]: 500,
      [ELSEWHERE_ACCOUNT]: 300,
    });
  });
});

describe('an edit', () => {
  it('writes only what it changes', async () => {
    const before = await stored(PLAIN);
    const res = await edit(PLAIN, formBody(before, { description: 'Groceries, week 40' }));
    expect(res.status).toBe(200);

    expect(await stored(PLAIN)).toEqual({ ...before, description: 'Groceries, week 40' });
    await expectBalances({ [EVERYDAY]: 1000 });
  });

  it('answers 200 when it changes nothing, a save that changed only the tags', async () => {
    const before = await stored(PLAIN);
    expect((await edit(PLAIN, formBody(before))).status).toBe(200);
    expect((await edit(PLAIN, {})).status).toBe(200);
    expect(await stored(PLAIN)).toEqual(before);
  });

  it('refuses a changed value the rules refuse, at its field', async () => {
    expect((await refusal(await edit(PLAIN, { amount: 12.345 }))).fields).toEqual({
      amount: M.amountCents,
    });
    expect((await refusal(await edit(PLAIN, { date: '2026-02-30', type: 'gift' }))).fields).toEqual(
      {
        type: M.type,
        date: M.date,
      }
    );
    expect((await refusal(await edit(PLAIN, { category_id: ELSEWHERE_CATEGORY }))).fields).toEqual({
      category_id: M.category,
    });
    expect((await stored(PLAIN)).amount).toBe(82.4);
  });

  it('clears what the form sends blank', async () => {
    const before = await stored(PLAIN);
    expect((await edit(PLAIN, formBody(before, { notes: '' }))).status).toBe(200);
    expect((await stored(PLAIN)).notes).toBe('');
  });

  it('makes a transfer into an expense without its destination, and moves the balances back', async () => {
    const before = await stored(TRANSFER);
    await expectBalances({ [EVERYDAY]: 1000, [SAVINGS]: 500 });
    const res = await edit(
      TRANSFER,
      formBody(before, { type: 'expense', transfer_account_id: null })
    );
    expect(res.status).toBe(200);

    expect(await stored(TRANSFER)).toMatchObject({ type: 'expense', transfer_account_id: null });
    // The transfer took 40 from Everyday and gave it to Savings; as an expense it takes the same
    // 40 from Everyday and gives Savings nothing.
    await expectBalances({ [EVERYDAY]: 1000, [SAVINGS]: 460 });
  });

  describe('of a row saved under older rules', () => {
    it.each([
      ['an amount with three decimals', CENTS],
      ['a date that is not YYYY-MM-DD', DATED],
      ['a currency that is not a code', EURO],
      ['a transfer without a destination', NO_DESTINATION],
      ["an account of another profile's", CROSS_LINKED],
    ])('saves a description change to one with %s', async (_, id) => {
      const before = await stored(id);
      const balancesBefore = await balances();

      const res = await edit(id, formBody(before, { description: 'Renamed' }));
      expect(res.status).toBe(200);

      expect(await stored(id)).toEqual({ ...before, description: 'Renamed' });
      await expectBalances(balancesBefore);
    });

    it('still refuses a change to how such a row moves money that leaves it broken', async () => {
      const before = await stored(NO_DESTINATION);
      expect(
        (await refusal(await edit(NO_DESTINATION, formBody(before, { amount: 60 })))).fields
      ).toEqual({ transfer_account_id: M.transferTo });

      const fixed = await edit(
        NO_DESTINATION,
        formBody(before, { amount: 60, transfer_account_id: SAVINGS })
      );
      expect(fixed.status).toBe(200);
      expect(await stored(NO_DESTINATION)).toMatchObject({
        amount: 60,
        transfer_account_id: SAVINGS,
      });
    });
  });

  it("keeps a foreign-currency row's local amount, and its account's balance, on a description change", async () => {
    const before = await stored(FX);
    const res = await edit(FX, formBody(before, { description: 'Hotel, two nights' }));
    expect(res.status).toBe(200);

    expect(await stored(FX)).toMatchObject({ amount: 100, amount_local: 92, exchange_rate: 0.92 });
    await expectBalances({ [EVERYDAY]: 1000 });
  });

  it('sets the reconciled flag', async () => {
    expect((await edit(PLAIN, { reconciled: true })).status).toBe(200);
    const row = await env.DB.prepare(
      'SELECT reconciled, reconciled_at FROM transactions WHERE id = ?'
    )
      .bind(PLAIN)
      .first<{ reconciled: number; reconciled_at: string | null }>();
    expect(row?.reconciled).toBe(1);
    expect(row?.reconciled_at).not.toBeNull();
  });
});
