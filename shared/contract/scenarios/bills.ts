import { addCategory, expectMoney, isoDay, listTransactions, monthStart } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Bills form posts (features/billForm.ts, buildBillMutationPayload). */
function billForm(fields: Record<string, unknown> = {}) {
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
    // DIFFERENCE bill-day-of-month: the form sends no day of the month.
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
    // DIFFERENCE bill-delete-missing
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
