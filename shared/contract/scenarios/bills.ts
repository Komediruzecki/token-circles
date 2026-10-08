import {
  addCategory,
  balanceOf,
  expectMoney,
  isoDay,
  listTransactions,
  monthStart,
} from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

/** The body the Bills form posts (features/billForm.ts, buildBillMutationPayload). */
export function billForm(fields: Record<string, unknown> = {}) {
  return {
    name: 'Water',
    amount: 40.25,
    dueDate: '2026-03-15',
    category_id: undefined,
    frequency: 'monthly',
    autopay: false,
    type: 'bill',
    ...fields,
  };
}

async function bill(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  return added(api, expect, '/api/bills', billForm(fields));
}

async function billsList(api: ContractApi, expect: Expect, query = ''): Promise<Json[]> {
  const reply = await api.get(`/api/bills${query}`);
  expectOk(expect, reply, `GET /api/bills${query}`);
  return reply.body as Json[];
}

/** Today as the runtime dates a payment: UTC on the Worker, the device's day in local-first. */
function paymentDays(): string[] {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  return [isoDay(now), local];
}

export const bills = [
  scenario('a bill is added, read back, changed, paused and removed', async (api, expect) => {
    const utilities = await addCategory(api, expect, 'Utilities');
    const id = await bill(api, expect, { category_id: utilities });

    const one = await api.get(`/api/bills/${id}`);
    expectOk(expect, one, 'GET the bill');
    expect(one.body).toMatchObject({
      id,
      name: 'Water',
      due_date: '2026-03-15',
      category_id: utilities,
      frequency: 'monthly',
      autopay: false,
      type: 'bill',
      is_active: 1,
      last_paid_date: null,
    });
    expectMoney(expect, one.body.amount, 40.25);
    // DIFFERENCE day-of-month-default: the form sends no day of the month.
    expect(one.body.day_of_month).toBe(api.runtime === 'worker' ? null : 1);
    expect(await billsList(api, expect)).toContainEqual(
      expect.objectContaining({ id, name: 'Water', paid: false })
    );

    expectOk(
      expect,
      await api.put(
        `/api/bills/${id}`,
        billForm({
          name: 'Water and sewage',
          amount: 52.1,
          dueDate: '2026-03-20',
          category_id: utilities,
          frequency: 'yearly',
          autopay: true,
        })
      ),
      'PUT the bill'
    );
    const changed = (await api.get(`/api/bills/${id}`)).body;
    expect(changed).toMatchObject({
      name: 'Water and sewage',
      due_date: '2026-03-20',
      frequency: 'yearly',
      autopay: true,
      category_id: utilities,
    });
    expectMoney(expect, changed.amount, 52.1);

    // The card menu's Pause and Resume send the switch alone.
    expectOk(expect, await api.put(`/api/bills/${id}`, { is_active: 0 }), 'pause');
    expect((await api.get(`/api/bills/${id}`)).body).toMatchObject({
      is_active: 0,
      name: 'Water and sewage',
      due_date: '2026-03-20',
    });
    expectOk(expect, await api.put(`/api/bills/${id}`, { is_active: 1 }), 'resume');
    expect((await api.get(`/api/bills/${id}`)).body.is_active).toBe(1);

    expectOk(expect, await api.delete(`/api/bills/${id}`), 'DELETE the bill');
    expect((await api.get(`/api/bills/${id}`)).status).toBe(404);
    expect(await billsList(api, expect)).not.toContainEqual(expect.objectContaining({ id }));
  }),

  scenario("another profile's bill is not read, changed, paid or removed", async (api, expect) => {
    const id = await bill(api, expect);
    const other = api.other;

    expect((await other.get(`/api/bills/${id}`)).status).toBe(404);
    expect(await billsList(other, expect)).toEqual([]);
    expect((await other.put(`/api/bills/${id}`, billForm({ name: 'Theirs' }))).status).toBe(404);
    expect((await other.post(`/api/bills/${id}/mark-paid`, {})).status).toBe(404);
    // DIFFERENCE delete-missing
    const removed = await other.delete(`/api/bills/${id}`);
    expect(removed.status).toBe(api.runtime === 'worker' ? 200 : 404);

    expect((await api.get(`/api/bills/${id}`)).body).toMatchObject({
      id,
      name: 'Water',
      last_paid_date: null,
    });
    expect(await listTransactions(api, expect)).toEqual([]);
    expect(await listTransactions(other, expect)).toEqual([]);

    // DIFFERENCE foreign-link-status: a bill on another profile's category.
    const theirs = await addCategory(other, expect, 'Their utilities');
    expect((await api.post('/api/bills', billForm({ category_id: theirs }))).status).toBe(
      api.runtime === 'worker' ? 403 : 400
    );
    expect(await billsList(api, expect)).toHaveLength(1);
  }),

  scenario(
    'paying a bill records the expense on its account, once a period',
    async (api, expect) => {
      const utilities = await addCategory(api, expect, 'Utilities');
      const everyday = await account(api, expect, 'Everyday', 1000);
      const water = await bill(api, expect, { category_id: utilities, account_id: everyday });
      const netflix = await bill(api, expect, {
        name: 'Netflix',
        amount: 12.99,
        dueDate: '2026-03-02',
        type: 'subscription',
      });
      expect((await api.get(`/api/bills/${water}`)).body.account_id).toBe(everyday);

      const paid = await api.post(`/api/bills/${water}/mark-paid`, {});
      expectOk(expect, paid, 'POST mark-paid');
      expect(paid.body).toMatchObject({ ok: true, transactionId: expect.any(Number) });

      const rows = await listTransactions(api, expect);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: paid.body.transactionId,
        description: 'Water',
        type: 'expense',
        category_id: utilities,
        account_id: everyday,
        currency: 'EUR',
      });
      expectMoney(expect, rows[0].amount, 40.25);
      expect(paymentDays()).toContain(rows[0].date);
      expectMoney(expect, await balanceOf(api, expect, everyday), 959.75, 'Everyday');

      const read = (await api.get(`/api/bills/${water}`)).body;
      expect(read.last_paid_date).toBe(rows[0].date);
      expect((await billsList(api, expect, '?paid=true')).map((b) => b.id)).toEqual([water]);
      expect((await billsList(api, expect, '?paid=false')).map((b) => b.id)).toEqual([netflix]);
      // Housing lists the subscriptions alone.
      expect((await billsList(api, expect, '?type=subscription')).map((b) => b.id)).toEqual([
        netflix,
      ]);

      // Paid for this period: a second tap records nothing more.
      expect((await api.post(`/api/bills/${water}/mark-paid`, {})).status).toBe(409);
      expect(await listTransactions(api, expect)).toHaveLength(1);
      expectMoney(expect, await balanceOf(api, expect, everyday), 959.75, 'Everyday');
    }
  ),

  scenario("the bill list and calendar carry each bill's category", async (api, expect) => {
    const utilities = await api.post('/api/categories', {
      name: 'Utilities',
      type: 'expense',
      color: '#2266aa',
      icon: 'bolt',
    });
    expectOk(expect, utilities, 'POST the category');
    const water = await bill(api, expect, { category_id: utilities.body.id });
    await bill(api, expect, {
      name: 'Gym',
      amount: 30,
      dueDate: '2026-01-31',
      type: 'subscription',
    });
    const paused = await bill(api, expect, { name: 'Paused', dueDate: '2026-03-15' });
    expectOk(expect, await api.put(`/api/bills/${paused}`, { is_active: 0 }), 'pause');
    await bill(api.other, expect, { name: 'Theirs', dueDate: '2026-03-15' });

    // The Bill Calendar shows the category's name and colour, Housing the subscription's colour.
    expect(await billsList(api, expect)).toContainEqual(
      expect.objectContaining({
        id: water,
        category_name: 'Utilities',
        category_color: '#2266aa',
      })
    );

    const march = await api.get('/api/bills/calendar?year=2026&month=3');
    expectOk(expect, march, 'GET /api/bills/calendar');
    expect(march.body).toMatchObject({
      year: 2026,
      month: 3,
      monthLabel: 'March 2026',
      firstDow: 0,
    });
    expect(Object.keys(march.body.days)).toHaveLength(31);
    expect(march.body.days['15']).toEqual([
      expect.objectContaining({
        id: water,
        name: 'Water',
        date: '2026-03-15',
        category_id: utilities.body.id,
        category_name: 'Utilities',
        category_color: '#2266aa',
        paid: false,
        type: 'bill',
        is_overdue: true,
      }),
    ]);
    expect(march.body.days['31']).toEqual([
      expect.objectContaining({ name: 'Gym', date: '2026-03-31', type: 'subscription' }),
    ]);
    expectMoney(expect, march.body.summary.totalAmount, 70.25, 'March total');
    expect(march.body.summary).toMatchObject({ paidAmount: 0, billCount: 2 });

    // February has no 31st: the Gym is not drawn.
    const february = await api.get('/api/bills/calendar?year=2026&month=2');
    expect(Object.keys(february.body.days)).toHaveLength(28);
    expect(february.body.summary).toMatchObject({ billCount: 1 });

    expect((await api.get('/api/bills/calendar?year=2026&month=13')).status).toBe(400);
    expect((await api.get('/api/bills/calendar?year=1800&month=3')).status).toBe(400);
  }),

  scenario('upcoming bills', async (api, expect) => {
    const today = isoDay(new Date());
    const day = Number(today.slice(8, 10));
    const dueToday = await bill(api, expect, {
      name: 'Due today',
      dueDate: today,
      day_of_month: day,
    });
    const later = await bill(api, expect, { name: 'Paused', dueDate: today });
    expectOk(expect, await api.put(`/api/bills/${later}`, { is_active: 0 }), 'pause');

    const reply = await api.get('/api/bills/upcoming');
    expectOk(expect, reply, 'GET /api/bills/upcoming');
    const rows = reply.body as Json[];
    expect(rows.map((b) => b.id)).toEqual([dueToday]);
    // DIFFERENCE bills-upcoming
    if (api.runtime === 'worker') {
      // Due today, and answered as due next month.
      expect(rows[0]).toMatchObject({ is_overdue: false, paid: false });
      expect(rows[0].next_due_date >= monthStart(1), rows[0].next_due_date).toBe(true);
      expect(rows[0].days_until).toBeGreaterThan(27);
    } else {
      expect(rows[0]).toMatchObject({ due_date: today, is_active: 1 });
      expect(rows[0].next_due_date).toBeNull();
    }
  }),
];
