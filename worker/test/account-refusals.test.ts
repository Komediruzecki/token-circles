/**
 * What the accounts routes refuse, and how they say it.
 *
 * A refused body answers 400 `{ error, fields }` (shared/refusal.ts), by the rules in
 * shared/accountSchema.ts, which local-first and the Accounts form run too. Before:
 *
 * - A create without a name answered "Name is required" and no field. A name over 100
 *   characters, which local-first refused, was stored.
 * - A type the route did not know became a giro account, without a word.
 * - A balance was read with parseFloat: "12abc" was 12, "abc" was zero.
 * - A starting date was stored as sent, in any format.
 * - An edit with a blank name, an unknown type or a balance that is not a number answered
 *   "Account updated" and dropped that field.
 *
 * An edit checks and writes only what it changes, so a row stored under older rules (a name over
 * 100 characters, a type v4 renamed, a starting date in another format) stays editable. A
 * base currency other than the profile's is still the 409 it was, in its own words.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { issueSessionCookie } from '../src/auth';
import { ACCOUNT_MESSAGES as M } from '../../shared/accountSchema';

const USER = 9851;
const PROFILE = 98510;
const EVERYDAY = 985101;
// Rows an import or an older version stored, which a create now refuses.
const LONG_NAMED = 985102; // a name over 100 characters
const CHECKING = 985103; // a type v4 renamed
const ODD_DATE = 985104; // a starting date that is not YYYY-MM-DD

const LONG_NAME = 'Joint account '.repeat(8).trim();
const CONFLICT =
  'Account balances use EUR. Change the base currency in Settings before adding financial data.';

let cookie = '';

const COLUMNS =
  'id, profile_id, name, type, bank_name, currency, balance, starting_balance, starting_date, notes';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM settings WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  const account = (id: number, values: Record<string, unknown> = {}) => {
    const full: Record<string, unknown> = {
      id,
      profile_id: PROFILE,
      name: 'Everyday',
      type: 'giro',
      bank_name: 'Credit Union',
      currency: 'EUR',
      balance: 920,
      starting_balance: 1000,
      starting_date: '2026-01-01',
      notes: '',
      ...values,
    };
    const columns = Object.keys(full);
    return env.DB.prepare(
      `INSERT INTO accounts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...columns.map((c) => full[c]));
  };
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'account-refusals@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Refusals')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', ?)"
    ).bind(PROFILE),
    account(EVERYDAY),
    account(LONG_NAMED, { name: LONG_NAME }),
    account(CHECKING, { name: 'Old checking', type: 'checking' }),
    account(ODD_DATE, { name: 'Old date', starting_date: '01/01/2026' }),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
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

const create = (body: unknown) => call('POST', '/api/accounts', body);
const edit = (id: number, body: unknown) => call('PUT', `/api/accounts/${id}`, body);

type Row = Record<string, unknown>;

async function stored(id: number): Promise<Row> {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM accounts WHERE id = ?`)
    .bind(id)
    .first<Row>();
  if (!row) throw new Error(`no account ${id}`);
  return row;
}

async function storedBy(name: string): Promise<Row[]> {
  const rows = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM accounts WHERE profile_id = ? AND name = ?`
  )
    .bind(PROFILE, name)
    .all<Row>();
  return rows.results;
}

async function count(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts WHERE profile_id = ?')
    .bind(PROFILE)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function refusal(res: Response): Promise<{ error: string; fields?: Record<string, string> }> {
  expect(res.status).toBe(400);
  return (await res.json()) as { error: string; fields?: Record<string, string> };
}

/** What the Accounts form sends on an edit that changes nothing: the fields it shows. */
function formBody(row: Row, change: Row = {}): Row {
  return {
    name: row.name,
    type: row.type === 'checking' ? 'giro' : row.type,
    bank_name: row.bank_name,
    currency: 'EUR',
    starting_date: row.starting_date,
    ...change,
  };
}

describe('a new account', () => {
  it('stores the row the rules give, trimmed and with its defaults', async () => {
    const res = await create({ name: '  Holiday fund ', currency: 'EUR' });
    expect(res.status).toBe(200);

    const [row] = await storedBy('Holiday fund');
    expect(row).toMatchObject({
      type: 'giro',
      bank_name: '',
      currency: 'EUR',
      balance: 0,
      starting_balance: 0,
      starting_date: null,
      notes: '',
    });
  });

  it('opens at its starting balance, whatever current balance the body sends', async () => {
    await create({ name: 'Card', starting_balance: 1000, balance: 1200 });
    expect(await storedBy('Card')).toMatchObject([{ balance: 1000, starting_balance: 1000 }]);

    await create({ name: 'Wallet', balance: '35.5' });
    expect(await storedBy('Wallet')).toMatchObject([{ balance: 35.5, starting_balance: 35.5 }]);
  });

  it('stores a type v4 renamed as the type that replaced it', async () => {
    await create({ name: 'Brokerage', type: 'investment' });
    expect(await storedBy('Brokerage')).toMatchObject([{ type: 'ib' }]);
  });

  it('answers a refusal with each field and a summary of them all', async () => {
    expect(await refusal(await create({ name: ' ', type: 'credit' }))).toEqual({
      error: `${M.name} ${M.type}`,
      fields: { name: M.name, type: M.type },
    });
  });

  it.each([
    ['no name', { type: 'giro' }, { name: M.name }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, { name: M.nameLength }],
    ['a type it does not have', { name: 'A', type: 'credit' }, { type: M.type }],
    ['a balance that is not a number', { name: 'A', balance: '12abc' }, { balance: M.balance }],
    [
      'a starting balance that is not a number',
      { name: 'A', starting_balance: 'abc' },
      { starting_balance: M.startingBalance },
    ],
    [
      'a starting date that does not exist',
      { name: 'A', starting_date: '2026-02-30' },
      { starting_date: M.startingDate },
    ],
    ['a currency that is not a code', { name: 'A', currency: 'EURO' }, { currency: M.currency }],
  ])('refuses %s, and stores nothing', async (_, body, fields) => {
    const before = await count();
    expect((await refusal(await create(body))).fields).toEqual(fields);
    expect(await count()).toBe(before);
  });

  it('answers a currency other than the base currency with the 409 and its sentence', async () => {
    const res = await create({ name: 'Dollars', currency: 'USD' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONFLICT });
    expect(await storedBy('Dollars')).toEqual([]);
  });
});

describe('an edit of an account', () => {
  it('writes nothing for a save that changes nothing', async () => {
    const before = await stored(EVERYDAY);
    const res = await edit(EVERYDAY, formBody(before));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'No changes' });
    expect(await stored(EVERYDAY)).toEqual(before);
  });

  it('writes only what it changes', async () => {
    const before = await stored(EVERYDAY);
    const res = await edit(
      EVERYDAY,
      formBody(before, { name: 'Main', notes: 'Bills come out here' })
    );
    expect(res.status).toBe(200);
    expect(await stored(EVERYDAY)).toEqual({
      ...before,
      name: 'Main',
      notes: 'Bills come out here',
    });
  });

  it('keeps a balance correction: the starting balance and the balance together', async () => {
    const before = await stored(EVERYDAY);
    const res = await edit(EVERYDAY, formBody(before, { starting_balance: 1080, balance: 1000 }));
    expect(res.status).toBe(200);
    expect(await stored(EVERYDAY)).toMatchObject({ starting_balance: 1080, balance: 1000 });
  });

  it.each([
    ['a blank name', { name: '  ' }, { name: M.name }],
    ['a type it does not have', { type: 'credit' }, { type: M.type }],
    ['a balance that is not a number', { balance: 'abc' }, { balance: M.balance }],
    ['a blank balance', { balance: null }, { balance: M.balance }],
    [
      'a starting date that does not exist',
      { starting_date: '2026-13-01' },
      { starting_date: M.startingDate },
    ],
  ])('refuses %s at its field, and writes nothing', async (_, change, fields) => {
    const before = await stored(EVERYDAY);
    expect((await refusal(await edit(EVERYDAY, formBody(before, change)))).fields).toEqual(fields);
    expect(await stored(EVERYDAY)).toEqual(before);
  });

  it.each([
    ['a name over 100 characters', LONG_NAMED],
    ['a type v4 renamed', CHECKING],
    ['a starting date in another format', ODD_DATE],
  ])('saves a notes change to a row with %s', async (_, id) => {
    const before = await stored(id);
    const res = await edit(id, formBody(before, { notes: 'Checked' }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await stored(id)).toEqual({ ...before, notes: 'Checked' });
  });

  it('answers a currency other than the base currency with the 409 and its sentence', async () => {
    const before = await stored(EVERYDAY);
    const res = await edit(EVERYDAY, formBody(before, { name: 'Main', currency: 'USD' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: CONFLICT });
    expect(await stored(EVERYDAY)).toEqual(before);
  });
});
