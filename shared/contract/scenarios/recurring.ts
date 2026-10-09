import { addCalendarMonths } from '../../calendarMonths';
import { RECURRING_MESSAGES as M } from '../../recurringSchema';
import { addCategory, balanceOf, expectMoney, isoDay, listTransactions } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

/** The body the Recurring section's form saves (components/RecurringSection.tsx, handleSave). */
export function ruleForm(fields: Record<string, unknown> = {}) {
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

/**
 * `YYYY-MM-DD` a month after another, as both runtimes advance a monthly rule: on the same day, or
 * on the last day of a shorter month (shared/calendarMonths.ts).
 */
function monthAfter(day: string): string {
  return addCalendarMonths(day, 1);
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
      active: 1,
    });
    expectMoney(expect, one.body.amount, 850.5);
    // The form sends null when the day is left empty: the rule has none, and its next date's day
    // is its day.
    expect(one.body.day_of_month).toBeNull();
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
      const gone = await other.delete(`/api/recurring/${id}`);
      expect({ status: gone.status, body: gone.body }).toEqual({
        status: 404,
        body: { error: M.notFound },
      });

      const mine = (await api.get(`/api/recurring/${id}`)).body;
      expect(mine).toMatchObject({ id, next_date: '2026-03-01' });
      expectMoney(expect, mine.amount, 850.5);
      expect(await listTransactions(api, expect)).toEqual([]);
      expect(await listTransactions(other, expect)).toEqual([]);

      // A rule on another profile's category or account is refused at that field.
      const theirCategory = await addCategory(other, expect, 'Their rent');
      const theirAccount = await account(other, expect, 'Their account', 10);
      const refusedAt = async (
        reply: Promise<{ status: number; body: Json }>,
        field: string,
        message: string
      ) => {
        const { status, body } = await reply;
        expect({ status, body }).toEqual({
          status: 400,
          body: { error: message, fields: { [field]: message } },
        });
      };
      await refusedAt(
        api.post('/api/recurring', ruleForm({ category_id: theirCategory })),
        'category_id',
        M.category
      );
      await refusedAt(
        api.post('/api/recurring', ruleForm({ account_id: theirAccount })),
        'account_id',
        M.account
      );
      await refusedAt(
        api.put(`/api/recurring/${id}`, ruleForm({ account_id: theirAccount })),
        'account_id',
        M.account
      );
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
      // The transaction it added, and the date the rule moved on to.
      expect(ran).toEqual({
        ok: true,
        transactionId: expect.any(Number),
        next_date: monthAfter(today),
      });
      let rows = await listTransactions(api, expect);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: ran.transactionId,
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

      // This period is done: running it again adds nothing, and says so.
      const again = await api.post(`/api/recurring/${monthly}/populate`);
      expect({ status: again.status, body: again.body }).toEqual({
        status: 409,
        body: { error: M.populated },
      });
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

  scenario('the recurring list comes soonest first', async (api, expect) => {
    const may = await rule(api, expect, { description: 'May', next_date: '2026-05-01' });
    const march = await rule(api, expect, { description: 'March', next_date: '2026-03-01' });
    const april = await rule(api, expect, { description: 'April', next_date: '2026-04-01' });
    expect((await rules(api, expect)).map((r) => r.id)).toEqual([march, april, may]);
  }),

  scenario("a recurring rule carries its category's name and colour", async (api, expect) => {
    const rent = await api.post('/api/categories', {
      name: 'Rent',
      type: 'expense',
      color: '#2266aa',
      icon: 'home',
    });
    expectOk(expect, rent, 'POST the category');
    const id = await rule(api, expect, { category_id: rent.body.id });
    // The Recurring section and the dashboard card colour each rule by its category.
    expect(await rules(api, expect)).toEqual([
      expect.objectContaining({
        id,
        category_name: 'Rent',
        category_color: '#2266aa',
        category_type: 'expense',
      }),
    ]);
  }),

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

    const upcoming = async () => {
      const reply = await api.get('/api/recurring/upcoming');
      expectOk(expect, reply, 'GET /api/recurring/upcoming');
      return reply.body;
    };
    // Every week of the next 30 days, today included.
    let next = await upcoming();
    expect(next.transactions.map((t: Json) => t.next_date)[0]).toBe(today);
    expect(next.transactions).toHaveLength(5);
    expect(next.transactions[0]).toMatchObject({ id: weekly, description: 'Beans' });
    expectMoney(expect, next.totalMonthly, 100, 'the next 30 days');
    expect(next.byCategory).toEqual([expect.objectContaining({ name: 'Coffee', total: 100 })]);
    expect(next.currency).toBe('EUR');

    // `active` pauses a rule, and so does `is_active`, local-first's name for it: the list and the
    // upcoming payments leave a paused rule out, and an active one comes back.
    const daily = await rule(api, expect, {
      description: 'Paper',
      frequency: 'daily',
      next_date: today,
    });
    expectOk(expect, await api.put(`/api/recurring/${weekly}`, { active: 0 }), 'pause');
    expectOk(expect, await api.put(`/api/recurring/${daily}`, { is_active: false }), 'pause');
    expect(await rules(api, expect)).toEqual([]);
    next = await upcoming();
    expect(next.transactions).toEqual([]);
    expect(next.totalMonthly).toBe(0);
    expectOk(expect, await api.put(`/api/recurring/${weekly}`, { active: 1 }), 'resume');
    expect((await rules(api, expect)).map((r) => r.id)).toEqual([weekly]);
    expect((await api.get(`/api/recurring/${daily}`)).body.active).toBe(0);
  }),
];
