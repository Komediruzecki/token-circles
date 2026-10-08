import { addCategory, balanceOf, expectMoney, isoDay, listTransactions } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

/** The body the Recurring section's form saves (components/RecurringSection.tsx, handleSave). */
function ruleForm(fields: Record<string, unknown> = {}) {
  return {
    description: 'Rent',
    amount: 850.5,
    type: 'expense',
    frequency: 'monthly',
    day_of_month: null,
    next_date: '2026-03-01',
    category_id: null,
    account_id: null,
    transfer_account_id: null,
    notes: null,
    ...fields,
  };
}

async function rule(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  return added(api, expect, '/api/recurring', ruleForm(fields));
}

async function rules(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/recurring');
  expectOk(expect, reply, 'GET /api/recurring');
  return reply.body as Json[];
}

async function populate(api: ContractApi, expect: Expect, id: number) {
  const reply = await api.post(`/api/recurring/${id}/populate`);
  expectOk(expect, reply, `POST /api/recurring/${id}/populate`);
  return reply.body;
}

/** `YYYY-MM-DD` a month after another, as both runtimes advance a monthly rule. */
function monthAfter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return isoDay(new Date(Date.UTC(y, m, d)));
}

export const recurring = [
  scenario('a recurring rule is added, read back, changed and removed', async (api, expect) => {
    const rent = await addCategory(api, expect, 'Rent');
    const id = await rule(api, expect, { category_id: rent });

    const one = await api.get(`/api/recurring/${id}`);
    expectOk(expect, one, 'GET the rule');
    expect(one.body).toMatchObject({
      id,
      description: 'Rent',
      type: 'expense',
      frequency: 'monthly',
      next_date: '2026-03-01',
      category_id: rent,
      notes: '',
    });
    expectMoney(expect, one.body.amount, 850.5);
    // DIFFERENCE day-of-month-default: the form sends null when the day is left empty.
    expect(one.body.day_of_month).toBe(api.runtime === 'worker' ? null : 1);
    expect(await rules(api, expect)).toContainEqual(
      expect.objectContaining({ id, description: 'Rent' })
    );

    expectOk(
      expect,
      await api.put(
        `/api/recurring/${id}`,
        ruleForm({
          description: 'Rent, new flat',
          amount: 900,
          frequency: 'weekly',
          day_of_month: 5,
          next_date: '2026-03-05',
          category_id: rent,
          notes: 'Flat 4',
        })
      ),
      'PUT the rule'
    );
    const changed = (await api.get(`/api/recurring/${id}`)).body;
    expect(changed).toMatchObject({
      description: 'Rent, new flat',
      frequency: 'weekly',
      day_of_month: 5,
      next_date: '2026-03-05',
      notes: 'Flat 4',
    });
    expectMoney(expect, changed.amount, 900);

    expectOk(expect, await api.delete(`/api/recurring/${id}`), 'DELETE the rule');
    expect((await api.get(`/api/recurring/${id}`)).status).toBe(404);
    expect(await rules(api, expect)).not.toContainEqual(expect.objectContaining({ id }));
  }),

  scenario(
    "another profile's recurring rule is not read, changed, run or removed",
    async (api, expect) => {
      const id = await rule(api, expect);
      const other = api.other;

      expect((await other.get(`/api/recurring/${id}`)).status).toBe(404);
      expect(await rules(other, expect)).toEqual([]);
      expect((await other.put(`/api/recurring/${id}`, ruleForm({ amount: 1 }))).status).toBe(404);
      expect((await other.post(`/api/recurring/${id}/populate`)).status).toBe(404);
      // DIFFERENCE delete-missing
      expect((await other.delete(`/api/recurring/${id}`)).status).toBe(
        api.runtime === 'worker' ? 200 : 404
      );

      const mine = (await api.get(`/api/recurring/${id}`)).body;
      expect(mine).toMatchObject({ id, next_date: '2026-03-01' });
      expectMoney(expect, mine.amount, 850.5);
      expect(await listTransactions(api, expect)).toEqual([]);
      expect(await listTransactions(other, expect)).toEqual([]);

      // DIFFERENCE foreign-link-status: a rule on another profile's category or account.
      const refused = api.runtime === 'worker' ? 403 : 400;
      const theirCategory = await addCategory(other, expect, 'Their rent');
      const theirAccount = await account(other, expect, 'Their account', 10);
      expect(
        (await api.post('/api/recurring', ruleForm({ category_id: theirCategory }))).status
      ).toBe(refused);
      expect(
        (await api.post('/api/recurring', ruleForm({ account_id: theirAccount }))).status
      ).toBe(refused);
      expect(
        (await api.put(`/api/recurring/${id}`, ruleForm({ account_id: theirAccount }))).status
      ).toBe(refused);
      expect(await rules(api, expect)).toHaveLength(1);
    }
  ),

  scenario(
    'running a rule adds its transaction and moves the next date, once a period',
    async (api, expect) => {
      const rent = await addCategory(api, expect, 'Rent');
      const everyday = await account(api, expect, 'Everyday', 1000);
      const savings = await account(api, expect, 'Savings', 0);
      const today = isoDay(new Date());
      const monthly = await rule(api, expect, {
        category_id: rent,
        account_id: everyday,
        next_date: today,
      });

      const ran = await populate(api, expect, monthly);
      expect(ran.ok).toBe(true);
      // DIFFERENCE recurring-populate-answer
      if (api.runtime === 'worker') {
        expect(ran).toMatchObject({
          transactionId: expect.any(Number),
          next_date: monthAfter(today),
        });
      } else {
        expect(ran).toEqual({ ok: true });
      }
      let rows = await listTransactions(api, expect);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        description: 'Rent',
        type: 'expense',
        date: today,
        category_id: rent,
        account_id: everyday,
        currency: 'EUR',
      });
      expectMoney(expect, rows[0].amount, 850.5);
      expectMoney(expect, await balanceOf(api, expect, everyday), 149.5, 'Everyday');
      expect((await api.get(`/api/recurring/${monthly}`)).body.next_date).toBe(monthAfter(today));

      // This period is done: running it again adds nothing.
      expect((await api.post(`/api/recurring/${monthly}/populate`)).status).toBe(409);
      expect(await listTransactions(api, expect)).toHaveLength(1);

      // A rule behind catches up a period at a time, and a transfer moves both accounts.
      const transfer = await rule(api, expect, {
        description: 'Savings',
        amount: 100,
        type: 'transfer',
        next_date: '2026-03-10',
        account_id: everyday,
        transfer_account_id: savings,
      });
      await populate(api, expect, transfer);
      await populate(api, expect, transfer);
      expect((await api.get(`/api/recurring/${transfer}`)).body.next_date).toBe('2026-05-10');
      rows = await listTransactions(api, expect, `?account_id=${savings}`);
      expect(rows.map((r) => r.date).sort()).toEqual(['2026-03-10', '2026-04-10']);
      expectMoney(expect, await balanceOf(api, expect, everyday), -50.5, 'Everyday');
      expectMoney(expect, await balanceOf(api, expect, savings), 200, 'Savings');
    }
  ),

  scenario('upcoming recurring transactions, and a paused rule', async (api, expect) => {
    const coffee = await addCategory(api, expect, 'Coffee');
    const today = isoDay(new Date());
    const weekly = await rule(api, expect, {
      description: 'Beans',
      amount: 20,
      frequency: 'weekly',
      next_date: today,
      category_id: coffee,
    });

    const reply = await api.get('/api/recurring/upcoming');
    expectOk(expect, reply, 'GET /api/recurring/upcoming');
    // DIFFERENCE recurring-upcoming
    if (api.runtime === 'worker') {
      // Every week of the next 30 days, today included.
      expect(reply.body.transactions.map((t: Json) => t.next_date)[0]).toBe(today);
      expect(reply.body.transactions).toHaveLength(5);
      expectMoney(expect, reply.body.totalMonthly, 100, 'the next 30 days');
      expect(reply.body.byCategory).toEqual([
        expect.objectContaining({ name: 'Coffee', total: 100 }),
      ]);
      expect(reply.body.currency).toBe('EUR');
    } else {
      expect(reply.body).toEqual([expect.objectContaining({ id: weekly, next_date: today })]);
    }

    // DIFFERENCE recurring-pause: the Worker's switch is `active`, and its list leaves a paused rule out.
    expectOk(expect, await api.put(`/api/recurring/${weekly}`, { active: 0 }), 'pause');
    expect((await rules(api, expect)).map((r) => r.id)).toEqual(
      api.runtime === 'worker' ? [] : [weekly]
    );
  }),
];
