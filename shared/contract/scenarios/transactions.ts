import { balanceOf, expectMoney, idsOf, listTransactions } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect } from '../types';
import { account } from './accounts';

/** The body the Transactions form sends (features/Transactions.tsx, the Save handler). */
function entry(fields: Record<string, unknown>) {
  return {
    description: 'Groceries',
    amount: 10,
    date: '2026-03-10',
    type: 'expense',
    category_id: null,
    currency: 'EUR',
    ...fields,
  };
}

async function transaction(api: ContractApi, expect: Expect, fields: Record<string, unknown>) {
  return added(api, expect, '/api/transactions', entry(fields));
}

async function category(api: ContractApi, expect: Expect, name: string, type = 'expense') {
  return added(api, expect, '/api/categories', { name, type, color: '#aa5500', icon: 'tag' });
}

/** Five rows over two months, two accounts and two categories, and one of another profile. */
async function ledger(api: ContractApi, expect: Expect) {
  const everyday = await account(api, expect, 'Everyday', 0);
  const savings = await account(api, expect, 'Savings', 0);
  const food = await category(api, expect, 'Food');
  const pay = await category(api, expect, 'Pay', 'income');
  const market = await transaction(api, expect, {
    description: 'Market',
    amount: 10,
    date: '2026-02-27',
    category_id: food,
    account_id: everyday,
  });
  const bakery = await transaction(api, expect, {
    description: 'Bakery',
    amount: 20,
    date: '2026-03-05',
    category_id: food,
    account_id: everyday,
  });
  const bigBakery = await transaction(api, expect, {
    description: 'Big bakery order',
    amount: 30,
    date: '2026-03-05',
    category_id: food,
    account_id: savings,
  });
  const salary = await transaction(api, expect, {
    description: 'Salary',
    type: 'income',
    amount: 1000,
    date: '2026-03-01',
    category_id: pay,
    account_id: everyday,
  });
  const move = await transaction(api, expect, {
    description: 'To savings',
    type: 'transfer',
    amount: 50,
    date: '2026-03-15',
    account_id: everyday,
    transfer_account_id: savings,
  });
  await transaction(api.other, expect, { description: 'Theirs', date: '2026-03-05' });
  return { everyday, savings, food, pay, market, bakery, bigBakery, salary, move };
}

export const transactions = [
  scenario(
    'a transaction is added, read back, changed and removed, and moves its account',
    async (api, expect) => {
      const acct = await account(api, expect, 'Everyday', 1000);
      const food = await category(api, expect, 'Food');
      const body = entry({
        description: 'Coffee beans',
        amount: 12.34,
        date: '2026-03-14',
        category_id: food,
        account_id: acct,
        means_of_payment: 'Card',
        notes: 'two bags',
        beneficiary: 'Roastery',
      });
      const id = await added(api, expect, '/api/transactions', body);

      const one = await api.get(`/api/transactions/${id}`);
      expectOk(expect, one, 'GET the transaction');
      expect(one.body).toMatchObject({
        id,
        description: 'Coffee beans',
        date: '2026-03-14',
        type: 'expense',
        category_id: food,
        account_id: acct,
        currency: 'EUR',
        means_of_payment: 'Card',
        notes: 'two bags',
        beneficiary: 'Roastery',
      });
      expectMoney(expect, one.body.amount, 12.34);
      const listed = (await listTransactions(api, expect)).find((t) => t.id === id);
      expect(listed).toMatchObject({ id, category_name: 'Food', category_color: '#aa5500' });
      expectMoney(expect, await balanceOf(api, expect, acct), 987.66, 'balance');

      // An edit sends the form's whole body again.
      expectOk(
        expect,
        await api.put(`/api/transactions/${id}`, {
          ...body,
          description: 'Coffee',
          amount: 20.5,
          notes: 'one bag',
        }),
        'PUT the transaction'
      );
      const edited = (await api.get(`/api/transactions/${id}`)).body;
      expect(edited).toMatchObject({ id, description: 'Coffee', notes: 'one bag' });
      expectMoney(expect, edited.amount, 20.5);
      expectMoney(expect, await balanceOf(api, expect, acct), 979.5, 'balance');

      expectOk(expect, await api.delete(`/api/transactions/${id}`), 'DELETE the transaction');
      expect((await api.get(`/api/transactions/${id}`)).status).toBe(404);
      expect(idsOf(await listTransactions(api, expect))).not.toContain(id);
      expectMoney(expect, await balanceOf(api, expect, acct), 1000, 'balance');
    }
  ),

  scenario(
    "another profile's transaction is not read, changed, removed or drawn on",
    async (api, expect) => {
      const acct = await account(api, expect, 'Everyday', 100);
      const id = await transaction(api, expect, { amount: 40, account_id: acct });
      const other = api.other;

      expect((await other.get(`/api/transactions/${id}`)).status).toBe(404);
      expect(idsOf(await listTransactions(other, expect))).not.toContain(id);
      expect(
        (await other.put(`/api/transactions/${id}`, entry({ amount: 1, account_id: acct }))).status
      ).toBe(404);
      expect((await other.delete(`/api/transactions/${id}`)).status).toBe(404);
      expect((await other.patch(`/api/transactions/${id}/reconcile`)).status).toBe(404);

      // A row of their own cannot be filed against my account either.
      const drawn = await other.post('/api/transactions', entry({ amount: 5, account_id: acct }));
      // DIFFERENCE foreign-link-status
      expect(drawn.status).toBe(api.runtime === 'worker' ? 403 : 400);
      expect(await listTransactions(other, expect)).toHaveLength(0);

      const mine = (await api.get(`/api/transactions/${id}`)).body;
      expect(mine).toMatchObject({ id, description: 'Groceries' });
      expect(Boolean(mine.reconciled)).toBe(false);
      expectMoney(expect, mine.amount, 40);
      expectMoney(expect, await balanceOf(api, expect, acct), 60, 'balance');
    }
  ),

  scenario(
    'a transfer moves money between two accounts, and back when removed',
    async (api, expect) => {
      const from = await account(api, expect, 'Everyday', 1000);
      const to = await account(api, expect, 'Savings', 200);
      const body = entry({
        description: 'To savings',
        type: 'transfer',
        amount: 300,
        account_id: from,
        transfer_account_id: to,
      });
      const id = await added(api, expect, '/api/transactions', body);
      expect((await api.get(`/api/transactions/${id}`)).body).toMatchObject({
        type: 'transfer',
        account_id: from,
        transfer_account_id: to,
      });
      expectMoney(expect, await balanceOf(api, expect, from), 700, 'from');
      expectMoney(expect, await balanceOf(api, expect, to), 500, 'to');

      expectOk(
        expect,
        await api.put(`/api/transactions/${id}`, { ...body, amount: 250.25 }),
        'PUT the transfer'
      );
      expectMoney(expect, await balanceOf(api, expect, from), 749.75, 'from');
      expectMoney(expect, await balanceOf(api, expect, to), 450.25, 'to');

      expectOk(expect, await api.delete(`/api/transactions/${id}`), 'DELETE the transfer');
      expectMoney(expect, await balanceOf(api, expect, from), 1000, 'from');
      expectMoney(expect, await balanceOf(api, expect, to), 200, 'to');
    }
  ),

  scenario(
    'a bulk edit recategorises and retypes rows, and a bulk delete removes them',
    async (api, expect) => {
      const acct = await account(api, expect, 'Everyday', 1000);
      const food = await category(api, expect, 'Food');
      const treats = await category(api, expect, 'Treats');
      const a = await transaction(api, expect, {
        amount: 10.5,
        category_id: food,
        account_id: acct,
      });
      const b = await transaction(api, expect, {
        amount: 20.25,
        category_id: food,
        account_id: acct,
      });
      const kept = await transaction(api, expect, {
        amount: 5,
        category_id: food,
        account_id: acct,
      });
      expectMoney(expect, await balanceOf(api, expect, acct), 964.25, 'balance');

      const moved = await api.put('/api/transactions/bulk', {
        ids: [a, b],
        action: 'update',
        data: { category_id: treats },
      });
      expectOk(expect, moved, 'bulk category');
      expect(moved.body).toMatchObject({ ok: true, updated: 2 });
      expect((await api.get(`/api/transactions/${a}`)).body).toMatchObject({ category_id: treats });
      expect((await api.get(`/api/transactions/${kept}`)).body).toMatchObject({
        category_id: food,
      });

      const retyped = await api.put('/api/transactions/bulk', {
        ids: [a, b],
        action: 'update',
        data: { type: 'income' },
      });
      expectOk(expect, retyped, 'bulk type');
      expect((await api.get(`/api/transactions/${b}`)).body).toMatchObject({ type: 'income' });
      expectMoney(expect, await balanceOf(api, expect, acct), 1025.75, 'balance');

      // Another profile's ids in the list are left alone.
      const theirs = await transaction(api.other, expect, { amount: 7 });
      const removed = await api.put('/api/transactions/bulk', {
        ids: [a, b, theirs],
        action: 'delete',
      });
      expectOk(expect, removed, 'bulk delete');
      expect(removed.body).toMatchObject({ ok: true, deleted: 2 });
      expect(idsOf(await listTransactions(api, expect))).toEqual([kept]);
      expect(idsOf(await listTransactions(api.other, expect))).toEqual([theirs]);
      expectMoney(expect, await balanceOf(api, expect, acct), 995, 'balance');
    }
  ),

  scenario(
    "removing every transaction resets the balances and leaves the other profile's",
    async (api, expect) => {
      const acct = await account(api, expect, 'Everyday', 300);
      await transaction(api, expect, { amount: 100, account_id: acct });
      await transaction(api, expect, { type: 'income', amount: 25, account_id: acct });
      const theirs = await transaction(api.other, expect, { amount: 7 });
      expectMoney(expect, await balanceOf(api, expect, acct), 225, 'balance');

      expectOk(expect, await api.delete('/api/transactions'), 'DELETE /api/transactions');
      expect(await listTransactions(api, expect)).toHaveLength(0);
      expectMoney(expect, await balanceOf(api, expect, acct), 300, 'balance');
      expect(idsOf(await listTransactions(api.other, expect))).toEqual([theirs]);
    }
  ),

  scenario('the transaction summary totals income and expense', async (api, expect) => {
    await transaction(api, expect, { amount: 12.5 });
    await transaction(api, expect, { amount: 7.25, date: '2026-04-02' });
    await transaction(api, expect, { type: 'income', amount: 100 });
    await transaction(api.other, expect, { amount: 999 });

    const summary = await api.get('/api/transactions/summary');
    expectOk(expect, summary, 'GET /api/transactions/summary');
    expect(summary.body).toMatchObject({ count: 3 });
    // DIFFERENCE transactions-summary-shape
    if (api.runtime === 'worker') {
      expectMoney(expect, summary.body.total_income, 100, 'income');
      expectMoney(expect, summary.body.total_expense, 19.75, 'expense');
      expectMoney(expect, summary.body.net_balance, 80.25, 'net');
    } else {
      expectMoney(expect, summary.body.totalIncome, 100, 'income');
      expectMoney(expect, summary.body.totalExpenses, 19.75, 'expense');
    }
  }),

  scenario(
    'a category named like an account links the account on the Worker only',
    async (api, expect) => {
      const everyday = await account(api, expect, 'Everyday', 500);
      const revolut = await account(api, expect, 'Revolut', 0);
      const sameName = await category(api, expect, 'Revolut');
      const id = await transaction(api, expect, {
        amount: 15,
        category_id: sameName,
        account_id: everyday,
      });
      const row = (await api.get(`/api/transactions/${id}`)).body;
      expectMoney(expect, await balanceOf(api, expect, everyday), 485, 'balance');
      expectMoney(expect, await balanceOf(api, expect, revolut), 0, 'Revolut balance');
      // DIFFERENCE transaction-account-from-names
      if (api.runtime === 'worker') {
        expect(row.transfer_account_id).toBe(revolut);
        expect((await api.delete(`/api/accounts/${revolut}`)).status).toBe(409);
      } else {
        expect(row.transfer_account_id ?? null).toBeNull();
        expectOk(expect, await api.delete(`/api/accounts/${revolut}`), 'DELETE Revolut');
      }
    }
  ),
];
