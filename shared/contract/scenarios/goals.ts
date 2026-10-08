import { addCategory, addTransaction, expectMoney, isoDay } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Goals form saves (features/goalForm.ts, goalBody), for a goal with no category. */
export function goalForm(fields: Record<string, unknown> = {}) {
  return {
    name: 'Holiday',
    target_amount: 2500.5,
    target_date: '2026-12-01',
    monthly_contribution: 150,
    category_id: null,
    ...fields,
  };
}

async function goal(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  return added(api, expect, '/api/savings-goals', goalForm(fields));
}

async function goals(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/savings-goals');
  expectOk(expect, reply, 'GET /api/savings-goals');
  return reply.body as Json[];
}

async function goalRow(api: ContractApi, expect: Expect, id: number): Promise<Json> {
  return (await goals(api, expect)).find((g) => g.id === id);
}

export const goalScenarios = [
  scenario(
    'a savings goal is added, read back, changed, paid into and removed',
    async (api, expect) => {
      const id = await goal(api, expect);
      let row = await goalRow(api, expect, id);
      expect(row).toMatchObject({ id, name: 'Holiday', deadline: '2026-12-01', category_id: null });
      expectMoney(expect, row.target_amount, 2500.5, 'target');
      expectMoney(expect, row.current_amount, 0, 'saved');
      expectMoney(expect, row.monthly_contribution, 150, 'monthly');

      // The Goals page's contribute action.
      const paid = await api.post(`/api/savings-goals/${id}/contribute`, { amount: 100.25 });
      expectOk(expect, paid, 'POST contribute');
      expect(paid.body.ok).toBe(true);
      expectMoney(expect, paid.body.current_amount, 100.25, 'saved');

      // The form's edit sends no current_amount: what was paid in stays.
      expectOk(
        expect,
        await api.put(
          `/api/savings-goals/${id}`,
          goalForm({ name: 'Summer holiday', target_amount: 3000, target_date: '2027-06-30' })
        ),
        'PUT the goal'
      );
      row = await goalRow(api, expect, id);
      expect(row).toMatchObject({ name: 'Summer holiday', deadline: '2027-06-30' });
      expectMoney(expect, row.target_amount, 3000, 'target');
      expectMoney(expect, row.current_amount, 100.25, 'saved');

      expectOk(expect, await api.delete(`/api/savings-goals/${id}`), 'DELETE the goal');
      expect(await goalRow(api, expect, id)).toBeUndefined();
      expect((await api.delete(`/api/savings-goals/${id}`)).status).toBe(404);
    }
  ),

  scenario('a goal saved without a monthly amount', async (api, expect) => {
    // The form sends null when the monthly field is empty, and no tracking date without a category.
    const id = await goal(api, expect, { monthly_contribution: null });
    const row = await goalRow(api, expect, id);
    // Stored as no monthly amount, and counted from the day it was saved.
    expect(row).toMatchObject({
      monthly_contribution: 0,
      tracking_start_date: isoDay(new Date()),
    });
  }),

  scenario("another profile's goal is not changed, paid into or removed", async (api, expect) => {
    const id = await goal(api, expect);
    const other = api.other;

    expect(await goals(other, expect)).toEqual([]);
    expect((await other.put(`/api/savings-goals/${id}`, goalForm({ name: 'Theirs' }))).status).toBe(
      404
    );
    expect((await other.post(`/api/savings-goals/${id}/contribute`, { amount: 5 })).status).toBe(
      404
    );
    expect((await other.delete(`/api/savings-goals/${id}`)).status).toBe(404);

    const row = await goalRow(api, expect, id);
    expect(row).toMatchObject({ name: 'Holiday' });
    expectMoney(expect, row.current_amount, 0, 'saved');

    // A goal on another profile's category is refused at the category, added or changed.
    const theirs = await addCategory(other, expect, 'Their travel');
    const atCategory = { category_id: 'Choose a category from the list, or leave it blank.' };
    const onAdd = await api.post('/api/savings-goals', goalForm({ category_id: theirs }));
    expect(onAdd.status).toBe(400);
    expect(onAdd.body.fields).toEqual(atCategory);
    const onEdit = await api.put(`/api/savings-goals/${id}`, goalForm({ category_id: theirs }));
    expect(onEdit.status).toBe(400);
    expect(onEdit.body.fields).toEqual(atCategory);
    expect(await goals(api, expect)).toHaveLength(1);
  }),

  scenario(
    "a category goal counts the category's spending from its tracking date",
    async (api, expect) => {
      const travel = await addCategory(api, expect, 'Travel');
      await addTransaction(api, expect, { amount: 300, date: '2026-02-20', category_id: travel });
      await addTransaction(api, expect, { amount: 120.4, date: '2026-03-05', category_id: travel });
      await addTransaction(api, expect, { amount: 79.6, date: '2026-04-01', category_id: travel });
      await addTransaction(api, expect, { amount: 55, date: '2026-03-06' });
      const theirTravel = await addCategory(api.other, expect, 'Travel');
      await addTransaction(api.other, expect, {
        amount: 999,
        date: '2026-03-07',
        category_id: theirTravel,
      });

      // The form sends the category and its tracking date.
      const id = await goal(api, expect, {
        category_id: travel,
        tracking_start_date: '2026-03-01',
      });
      let row = await goalRow(api, expect, id);
      expect(row).toMatchObject({ category_id: travel, tracking_start_date: '2026-03-01' });
      expectMoney(expect, row.current_amount, 200, 'saved since March');

      expectOk(
        expect,
        await api.put(
          `/api/savings-goals/${id}`,
          goalForm({ category_id: travel, tracking_start_date: '2026-04-01' })
        ),
        'PUT a later tracking date'
      );
      expectMoney(
        expect,
        (await goalRow(api, expect, id)).current_amount,
        79.6,
        'saved since April'
      );

      // A transaction added afterwards counts on the next read of the list.
      await addTransaction(api, expect, { amount: 20.4, date: '2026-05-02', category_id: travel });
      row = await goalRow(api, expect, id);
      expectMoney(expect, row.current_amount, 100, 'saved since April');
    }
  ),
];
