import { ACCOUNT_MESSAGES } from '../../accountSchema';
import { balanceOf, expectMoney, isoDay, rowsOf, transactionForm } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Accounts dialog sends for a new account (features/accountForm.ts, createBody). */
export function accountBody(name: string, balance: number) {
  return {
    name,
    type: 'giro',
    bank_name: 'Erste',
    balance,
    currency: 'EUR',
    starting_balance: balance,
    starting_date: null,
  };
}

/** Adds an account as the Accounts form does and answers its id. */
export async function account(api: ContractApi, expect: Expect, name: string, balance: number) {
  return added(api, expect, '/api/accounts', accountBody(name, balance));
}

async function expense(
  api: ContractApi,
  expect: Expect,
  accountId: number,
  amount: number,
  date = '2026-03-10'
) {
  return added(
    api,
    expect,
    '/api/transactions',
    transactionForm({ amount, date, account_id: accountId })
  );
}

export const accounts = [
  scenario('an account is added, read back, changed and removed', async (api, expect) => {
    const id = await added(api, expect, '/api/accounts', {
      name: 'Everyday',
      type: 'giro',
      currency: 'EUR',
      balance: 250.5,
    });
    const one = await api.get(`/api/accounts/${id}`);
    expectOk(expect, one, 'GET the account');
    expect(one.body).toMatchObject({ id, name: 'Everyday', type: 'giro', currency: 'EUR' });
    expect(Number(one.body.balance)).toBeCloseTo(250.5, 2);
    expect((await api.get('/api/accounts')).body).toContainEqual(
      expect.objectContaining({ id, name: 'Everyday' })
    );

    expectOk(
      expect,
      await api.put(`/api/accounts/${id}`, { name: 'Bills', type: 'giro', currency: 'EUR' }),
      'PUT the account'
    );
    expect((await api.get(`/api/accounts/${id}`)).body).toMatchObject({ id, name: 'Bills' });

    expectOk(expect, await api.delete(`/api/accounts/${id}`), 'DELETE the account');
    expect((await api.get(`/api/accounts/${id}`)).status).toBe(404);
    expect(await rowsOf(api, expect, '/api/accounts')).not.toContainEqual(
      expect.objectContaining({ id })
    );
  }),

  scenario('the fields the Accounts form sends are stored and read back', async (api, expect) => {
    const id = await added(api, expect, '/api/accounts', {
      ...accountBody('Savings box', 1234.56),
      type: 'savings',
      starting_date: '2026-01-01',
    });
    const one = (await api.get(`/api/accounts/${id}`)).body;
    expect(one).toMatchObject({
      id,
      name: 'Savings box',
      type: 'savings',
      bank_name: 'Erste',
      currency: 'EUR',
      starting_date: '2026-01-01',
    });
    expectMoney(expect, one.balance, 1234.56, 'balance');
    expectMoney(expect, one.starting_balance, 1234.56, 'starting balance');

    // An edit that corrects the balance shifts the starting balance with it, as the form does.
    expectOk(
      expect,
      await api.put(`/api/accounts/${id}`, {
        name: 'Savings jar',
        type: 'savings',
        bank_name: 'PBZ',
        currency: 'EUR',
        starting_date: '2026-02-01',
        starting_balance: 1300,
        balance: 1300,
      }),
      'PUT the account'
    );
    const edited = (await api.get(`/api/accounts/${id}`)).body;
    expect(edited).toMatchObject({
      name: 'Savings jar',
      bank_name: 'PBZ',
      starting_date: '2026-02-01',
    });
    expectMoney(expect, edited.balance, 1300, 'balance');
    expectMoney(expect, edited.starting_balance, 1300, 'starting balance');
  }),

  scenario("another profile's account is not read, changed or removed", async (api, expect) => {
    const id = await added(api, expect, '/api/accounts', {
      name: 'Mine',
      type: 'giro',
      currency: 'EUR',
      balance: 10,
    });
    const other = api.other;
    expect((await other.get(`/api/accounts/${id}`)).status).toBe(404);
    expect(await rowsOf(other, expect, '/api/accounts')).not.toContainEqual(
      expect.objectContaining({ id })
    );
    expect(
      (await other.put(`/api/accounts/${id}`, { name: 'Theirs', type: 'giro', currency: 'EUR' }))
        .status
    ).toBe(404);
    expect((await other.delete(`/api/accounts/${id}`)).status).toBe(404);
    expect((await api.get(`/api/accounts/${id}`)).body).toMatchObject({ id, name: 'Mine' });
  }),

  scenario(
    'an account with transactions is kept until they go, then leaves with its history',
    async (api, expect) => {
      const id = await account(api, expect, 'Everyday', 500);
      const tx = await expense(api, expect, id, 20);
      expectOk(
        expect,
        await api.post(`/api/accounts/${id}/history`, { balance: 480 }),
        'record a balance'
      );

      const refused = await api.delete(`/api/accounts/${id}`);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect((await api.get(`/api/accounts/${id}`)).body).toMatchObject({ id, name: 'Everyday' });
      expectMoney(expect, await balanceOf(api, expect, id), 480, 'balance');

      expectOk(expect, await api.delete(`/api/transactions/${tx}`), 'DELETE the transaction');
      expectOk(expect, await api.delete(`/api/accounts/${id}`), 'DELETE the account');
      expect((await api.get(`/api/accounts/${id}`)).status).toBe(404);
      expect((await api.get(`/api/accounts/${id}/history`)).status).toBe(404);
    }
  ),

  scenario('a balance is recorded and read back in the history', async (api, expect) => {
    const id = await account(api, expect, 'Everyday', 100);
    const recorded = await api.post(`/api/accounts/${id}/history`, { balance: 321.45 });
    expectOk(expect, recorded, 'POST the history');
    expect(recorded.body).toMatchObject({ id: expect.any(Number) });
    expectMoney(expect, recorded.body.balance, 321.45, 'recorded balance');

    const history = await api.get(`/api/accounts/${id}/history`);
    expectOk(expect, history, 'GET the history');
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ id: recorded.body.id, account_id: id });
    expectMoney(expect, history.body[0].balance, 321.45, 'history balance');
    // DIFFERENCE account-history-shape
    const when = api.runtime === 'worker' ? history.body[0].recorded_at : history.body[0].date;
    expect(String(when).slice(0, 10)).toBe(isoDay(new Date()));

    const other = api.other;
    expect((await other.get(`/api/accounts/${id}/history`)).status).toBe(404);
    expect((await other.post(`/api/accounts/${id}/history`, { balance: 1 })).status).toBe(404);
    expect((await api.get(`/api/accounts/${id}/history`)).body).toHaveLength(1);
  }),

  scenario(
    "the net worth timeline adds up each account's latest recorded balance",
    async (api, expect) => {
      const a = await account(api, expect, 'Everyday', 100);
      const b = await account(api, expect, 'Savings', 900);
      // Recorded balances that do not add up to the accounts' own (1000), so a timeline of the
      // accounts' balances fails here.
      expectOk(expect, await api.post(`/api/accounts/${a}/history`, { balance: 150.25 }), 'a');
      expectOk(expect, await api.post(`/api/accounts/${b}/history`, { balance: 700 }), 'b');
      // A second balance for Everyday the same day replaces its first: the day's figure is each
      // account's latest balance, not every balance recorded that day added up (1025.25).
      expectOk(expect, await api.post(`/api/accounts/${a}/history`, { balance: 175 }), 'a again');
      const theirs = await account(api.other, expect, 'Theirs', 5);
      expectOk(
        expect,
        await api.other.post(`/api/accounts/${theirs}/history`, { balance: 5000 }),
        'theirs'
      );

      const timeline = await api.get('/api/accounts/history/timeline');
      expectOk(expect, timeline, 'GET the timeline');
      expect(timeline.body).toHaveLength(1);
      expect(timeline.body[0].date).toBe(isoDay(new Date()));
      expectMoney(expect, timeline.body[0].net_worth, 875, 'net worth');
    }
  ),

  scenario(
    'recomputing the balances rebuilds each from its start and its transactions',
    async (api, expect) => {
      const id = await account(api, expect, 'Everyday', 1000);
      await expense(api, expect, id, 120.4);
      await added(
        api,
        expect,
        '/api/transactions',
        transactionForm({
          type: 'income',
          amount: 50.15,
          description: 'Refund',
          date: '2026-03-11',
          account_id: id,
        })
      );
      const theirs = await account(api.other, expect, 'Theirs', 70);

      const recomputed = await api.post('/api/accounts/recompute-balances');
      expectOk(expect, recomputed, 'POST /api/accounts/recompute-balances');
      expect(recomputed.body).toMatchObject({ ok: true });
      // DIFFERENCE account-recompute-answer
      if (api.runtime === 'worker') expect(recomputed.body.recomputed).toBe(1);
      else expect(recomputed.body.accounts).toHaveLength(1);

      expectMoney(expect, await balanceOf(api, expect, id), 929.75, 'balance');
      expectMoney(expect, await balanceOf(api.other, expect, theirs), 70, 'their balance');
    }
  ),

  scenario('an account reconciliation summary counts its own transactions', async (api, expect) => {
    const id = await account(api, expect, 'Everyday', 0);
    const elsewhere = await account(api, expect, 'Cash', 0);
    const first = await expense(api, expect, id, 10.1);
    await expense(api, expect, id, 20.2);
    await expense(api, expect, elsewhere, 99.99);
    const toggled = await api.patch(`/api/transactions/${first}/reconcile`);
    expectOk(expect, toggled, 'PATCH reconcile');

    const summary = await api.get(`/api/accounts/${id}/reconciliation-summary`);
    expectOk(expect, summary, 'GET the reconciliation summary');
    expect(summary.body).toMatchObject({
      account_id: id,
      account_name: 'Everyday',
      reconciled_count: 1,
      unreconciled_count: 1,
      total_transactions: 2,
    });
    expectMoney(expect, summary.body.unreconciled_total, 20.2, 'unreconciled total');
    expect((await api.other.get(`/api/accounts/${id}/reconciliation-summary`)).status).toBe(404);
  }),

  scenario(
    "a credit card keeps its limit and rate, a Giro account its overdraft's, and no other type takes either",
    async (api, expect) => {
      const read = async (id: number) => (await api.get(`/api/accounts/${id}`)).body as Json;
      const card = await added(api, expect, '/api/accounts', {
        name: 'Visa',
        type: 'credit',
        currency: 'EUR',
        balance: -350,
        credit_limit: 2000,
        credit_rate: '15.9',
      });
      expect(await read(card)).toMatchObject({
        type: 'credit',
        credit_limit: 2000,
        credit_rate: 15.9,
      });
      expectMoney(expect, await balanceOf(api, expect, card), -350, 'what is owed on the card');
      expect((await rowsOf(api, expect, '/api/accounts')).find((a) => a.id === card)).toMatchObject(
        {
          credit_limit: 2000,
          credit_rate: 15.9,
        }
      );

      const everyday = await added(api, expect, '/api/accounts', {
        name: 'Everyday',
        type: 'giro',
        currency: 'EUR',
        balance: 100,
        credit_limit: 500,
        credit_rate: 9.5,
      });
      expect(await read(everyday)).toMatchObject({ credit_limit: 500, credit_rate: 9.5 });

      // Another type takes neither, and a limit below zero or a rate over 100 is refused.
      const pot = await api.post('/api/accounts', {
        name: 'Pot',
        type: 'savings',
        currency: 'EUR',
        credit_limit: 100,
        credit_rate: 2,
      });
      expect(pot.status).toBe(400);
      expect(pot.body.fields).toEqual({
        credit_limit: ACCOUNT_MESSAGES.creditLimitType,
        credit_rate: ACCOUNT_MESSAGES.creditRateType,
      });
      const odd = await api.post('/api/accounts', {
        name: 'Store card',
        type: 'credit',
        currency: 'EUR',
        credit_limit: -5,
        credit_rate: 120,
      });
      expect(odd.status).toBe(400);
      expect(odd.body.fields).toEqual({
        credit_limit: ACCOUNT_MESSAGES.creditLimit,
        credit_rate: ACCOUNT_MESSAGES.creditRate,
      });

      // An edit that blanks one takes it away, and one that makes the account savings takes both;
      // setting one on it after that is refused.
      expectOk(expect, await api.put(`/api/accounts/${card}`, { credit_rate: '' }), 'PUT no rate');
      expect(await read(card)).toMatchObject({ credit_limit: 2000, credit_rate: null });
      expectOk(expect, await api.put(`/api/accounts/${everyday}`, { type: 'savings' }), 'PUT type');
      expect(await read(everyday)).toMatchObject({
        type: 'savings',
        credit_limit: null,
        credit_rate: null,
      });
      const later = await api.put(`/api/accounts/${everyday}`, { credit_limit: 300 });
      expect(later.status).toBe(400);
      expect(later.body.fields).toEqual({ credit_limit: ACCOUNT_MESSAGES.creditLimitType });

      // An account made without either has neither.
      const wallet = await added(api, expect, '/api/accounts', {
        name: 'Wallet',
        type: 'cash',
        currency: 'EUR',
      });
      expect(await read(wallet)).toMatchObject({ credit_limit: null, credit_rate: null });
    }
  ),
];
