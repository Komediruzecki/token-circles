/**
 * A transaction's local amount is its value in the base currency, and what its account's balance
 * moves by. When an edit changes the amount and not the local amount, the local amount moves with
 * it at the row's exchange rate, as local-first has done since audit D8
 * (frontend/src/core/storage/idb.ts, updateTransaction).
 *
 * The Worker cleared it instead, so balance math fell back to the raw amount: a 100 USD hotel
 * worth 92 EUR, edited to 110 USD, moved the account by 110 "EUR". The Transactions form hid the
 * difference by sending an exchange rate of 1 on every edit, which local-first then used; it now
 * sends the row's own rate, and the two runtimes have to agree on what it means.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { issueSessionCookie } from '../src/auth';

const USER = 9841;
const PROFILE = 98410;
const ACCOUNT = 984101;
const HOTEL = 984102; // 100 USD, 92 in the base currency
const LUNCH = 984103; // 20 in the base currency
const OLD = 984104; // a row from before local amounts were stored
let cookie = '';

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM accounts WHERE profile_id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(PROFILE),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'local-amount@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Travel')").bind(
      PROFILE,
      USER
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, 'Card', 'giro', 'EUR', 1000, 1000)"
    ).bind(ACCOUNT, PROFILE),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, type, amount, amount_local, currency, exchange_rate, date, account_id) VALUES (?, ?, 'Hotel', 'expense', 100, 92, 'USD', 0.92, '2026-10-01', ?)"
    ).bind(HOTEL, PROFILE, ACCOUNT),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, type, amount, amount_local, currency, exchange_rate, date, account_id) VALUES (?, ?, 'Lunch', 'expense', 20, 20, 'EUR', 1, '2026-10-02', ?)"
    ).bind(LUNCH, PROFILE, ACCOUNT),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, type, amount, amount_local, currency, exchange_rate, date, account_id) VALUES (?, ?, 'Old', 'expense', 30, NULL, 'EUR', 1, '2026-01-02', ?)"
    ).bind(OLD, PROFILE, ACCOUNT),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function edit(id: number, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com/api/transactions/${id}`, {
    method: 'PUT',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function row(id: number): Promise<{ amount: number; amount_local: number | null }> {
  const found = await env.DB.prepare('SELECT amount, amount_local FROM transactions WHERE id = ?')
    .bind(id)
    .first<{ amount: number; amount_local: number | null }>();
  if (!found) throw new Error(`no transaction ${id}`);
  return found;
}

async function balance(): Promise<number> {
  const found = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(ACCOUNT)
    .first<{ balance: number }>();
  return found?.balance ?? NaN;
}

describe('an edit of the amount alone', () => {
  it('moves a foreign-currency row by its exchange rate, and the balance by what it is worth', async () => {
    expect((await edit(HOTEL, { amount: 110 })).status).toBe(200);

    expect(await row(HOTEL)).toEqual({ amount: 110, amount_local: 101.2 });
    // 92 given back, 101.20 taken.
    expect(await balance()).toBeCloseTo(990.8, 6);
  });

  it('uses a new exchange rate the same edit sends', async () => {
    expect((await edit(HOTEL, { amount: 110, exchange_rate: 0.9 })).status).toBe(200);

    expect(await row(HOTEL)).toEqual({ amount: 110, amount_local: 99 });
  });

  it('keeps a local amount the edit sends, as before', async () => {
    expect((await edit(HOTEL, { amount: 110, amount_local: 100 })).status).toBe(200);

    expect(await row(HOTEL)).toEqual({ amount: 110, amount_local: 100 });
  });

  it('moves a base-currency row one for one', async () => {
    expect((await edit(LUNCH, { amount: 24.5 })).status).toBe(200);

    expect(await row(LUNCH)).toEqual({ amount: 24.5, amount_local: 24.5 });
    expect(await balance()).toBeCloseTo(995.5, 6);
  });

  it('leaves a row that never had a local amount without one', async () => {
    expect((await edit(OLD, { amount: 35 })).status).toBe(200);

    expect(await row(OLD)).toEqual({ amount: 35, amount_local: null });
    expect(await balance()).toBeCloseTo(995, 6);
  });
});

describe('a foreign-currency entry saved without a local amount', () => {
  // What the Transactions form sends for 100 USD at 0.92 with no local amount. Both runtimes move
  // the account by 100 at create, and the Worker stores 100 as the local amount.
  async function museum(): Promise<number> {
    const res = await SELF.fetch('https://example.com/api/transactions', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(PROFILE),
      },
      body: JSON.stringify({
        type: 'expense',
        description: 'Museum',
        amount: 100,
        currency: 'USD',
        exchange_rate: 0.92,
        date: '2026-10-03',
        account_id: ACCOUNT,
        category_id: null,
      }),
    });
    expect(res.status).toBeLessThan(300);
    return ((await res.json()) as { id: number }).id;
  }

  it('moves the balance by the new amount, as local-first does', async () => {
    const id = await museum();
    expect(await balance()).toBeCloseTo(900, 6);
    expect((await edit(id, { amount: 110 })).status).toBe(200);
    expect(await balance()).toBeCloseTo(890, 6);
    expect((await edit(id, { amount: 120, exchange_rate: 0.95 })).status).toBe(200);
    expect(await balance()).toBeCloseTo(880, 6);
  });
});
