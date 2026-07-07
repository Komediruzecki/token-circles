import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

// Account balances must move by the base-currency value (amount_local), not the raw
// foreign amount — otherwise a foreign-currency transaction shifts the balance by an
// HRK-sized number in a EUR account. Covers create and delete (reversal must match).

let cookie = '';

beforeEach(async () => {
  for (const t of ['transactions', 'accounts', 'profiles', 'users']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (40, 'bal@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (400, 40, 'Main')"),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (4000, 400, 'Giro', 'giro', 'EUR', 100, 100)"
    ),
  ]);
  cookie = (await issueSessionCookie(40, 'password', env)).split(';')[0];
});

async function balance(): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = 4000').first<{
    balance: number;
  }>();
  return row?.balance ?? NaN;
}

describe('account balances use the base-currency value', () => {
  it('a foreign expense moves the balance by amount_local, not amount', async () => {
    const res = await SELF.fetch('https://example.com/api/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '400' },
      body: JSON.stringify({
        description: 'Toll',
        amount: 19,
        amount_local: 2.47,
        currency: 'HRK',
        type: 'expense',
        date: '2026-03-10',
        account_id: 4000,
      }),
    });
    expect(res.status).toBe(200);
    // 100 EUR − 2.47 EUR = 97.53 (NOT 100 − 19 = 81)
    expect(await balance()).toBeCloseTo(97.53, 2);
  });

  it('deleting the foreign expense restores the balance exactly', async () => {
    const created = await SELF.fetch('https://example.com/api/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '400' },
      body: JSON.stringify({
        description: 'Toll',
        amount: 19,
        amount_local: 2.47,
        currency: 'HRK',
        type: 'expense',
        date: '2026-03-10',
        account_id: 4000,
      }),
    });
    const { id } = (await created.json()) as { id: number };
    expect(await balance()).toBeCloseTo(97.53, 2);

    const del = await SELF.fetch(`https://example.com/api/transactions/${id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, 'X-Profile-Id': '400' },
    });
    expect(del.status).toBe(200);
    expect(await balance()).toBeCloseTo(100, 2);
  });

  async function createFxExpense(amountLocal: number): Promise<number> {
    const res = await SELF.fetch('https://example.com/api/transactions', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '400' },
      body: JSON.stringify({
        description: 'Toll',
        amount: 19,
        amount_local: amountLocal,
        currency: 'HRK',
        type: 'expense',
        date: '2026-03-10',
        account_id: 4000,
      }),
    });
    return ((await res.json()) as { id: number }).id;
  }

  it('editing an unrelated field on a foreign row leaves the balance unchanged', async () => {
    await createFxExpense(2.47); // balance 97.53
    const id = await env.DB.prepare('SELECT id FROM transactions LIMIT 1').first<{ id: number }>();
    const res = await SELF.fetch(`https://example.com/api/transactions/${id!.id}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '400' },
      body: JSON.stringify({ description: 'Toll (edited)' }),
    });
    expect(res.status).toBe(200);
    // The PUT reverses the old row and re-applies it; because it reverses using
    // amount_local (baseAmount), not the raw 19 HRK, the net change is zero.
    expect(await balance()).toBeCloseTo(97.53, 2);
  });

  it('changing amount_local on a foreign row re-bases the balance exactly', async () => {
    const id = await createFxExpense(2.47); // balance 97.53
    const res = await SELF.fetch(`https://example.com/api/transactions/${id}`, {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Profile-Id': '400' },
      body: JSON.stringify({ amount: 19, amount_local: 3.53, currency: 'HRK' }),
    });
    expect(res.status).toBe(200);
    // Reverse old base (2.47) then apply new base (3.53): 100 − 3.53 = 96.47.
    // The pre-fix bug reversed the raw 19 HRK and would leave 100 − 19 − 3.53.
    expect(await balance()).toBeCloseTo(96.47, 2);
  });
});
