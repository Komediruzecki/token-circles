import { HOUSING_ANSWER_KEYS } from '../../housingSchema';
import { expectMoney } from '../helpers';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** The body the Housing form posts (features/Housing.tsx, handleSubmit). */
export function housingForm(fields: Record<string, unknown> = {}) {
  return {
    property_name: 'Flat rent',
    monthly_amount: 850.5,
    due_day: 5,
    due_month: 3,
    autopay: true,
    notes: 'Paid to the landlord',
    ...fields,
  };
}

async function addHousing(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  const reply = await api.post('/api/housing', housingForm(fields));
  expectOk(expect, reply, 'POST /api/housing');
  expect(reply.body.id).toEqual(expect.any(Number));
  expect(reply.status).toBe(201);
  return reply.body.id as number;
}

async function housingList(api: ContractApi, expect: Expect): Promise<Json> {
  const reply = await api.get('/api/housing');
  expectOk(expect, reply, 'GET /api/housing');
  return reply.body;
}

/** What the Housing page reads off a row (getPropertyName, getMonthlyAmount, the autopay badge). */
function asShown(row: Json) {
  return {
    name: row.property_name || row.name,
    amount: Math.abs(parseFloat(String(row.monthly_amount))),
    autopay: row.autopay === true || row.autopay === 1,
    due: row.due_date,
    notes: row.notes,
  };
}

export const housing = [
  scenario('a housing expense is added, read back, changed and removed', async (api, expect) => {
    const id = await addHousing(api, expect);
    let listed = await housingList(api, expect);
    expect(listed.total_monthly).toBe(851);
    const row = listed.housings.find((h: Json) => h.id === id);
    expect(row).toMatchObject({ id, name: 'Flat rent', type: 'other', due_date: '03-05' });
    expectMoney(expect, row.monthly_amount, 850.5);
    expect(asShown(row)).toEqual({
      name: 'Flat rent',
      amount: 850.5,
      autopay: true,
      due: '03-05',
      notes: 'Paid to the landlord',
    });
    // The stored columns, autopay as true or false, and nothing else.
    expect(row.autopay).toBe(true);
    expect(Object.keys(row).sort()).toEqual([...HOUSING_ANSWER_KEYS].sort());

    // Nothing in the app edits one; a client would send the form's body again.
    expectOk(
      expect,
      await api.put(
        `/api/housing/${id}`,
        housingForm({
          property_name: 'Flat rent, new lease',
          monthly_amount: 900,
          due_day: 1,
          due_month: 4,
          autopay: false,
          notes: '',
        })
      ),
      'PUT the housing expense'
    );
    listed = await housingList(api, expect);
    expect(asShown(listed.housings.find((h: Json) => h.id === id))).toEqual({
      name: 'Flat rent, new lease',
      amount: 900,
      autopay: false,
      due: '04-01',
      notes: '',
    });
    expect(listed.total_monthly).toBe(900);

    expectOk(expect, await api.delete(`/api/housing/${id}`), 'DELETE the housing expense');
    expect(await housingList(api, expect)).toEqual({ housings: [], total_monthly: 0 });
    expect((await api.delete(`/api/housing/${id}`)).status).toBe(404);
  }),

  scenario("another profile's housing expense is not changed or removed", async (api, expect) => {
    const id = await addHousing(api, expect);
    const other = api.other;
    expect(await housingList(other, expect)).toEqual({ housings: [], total_monthly: 0 });
    expect(
      (await other.put(`/api/housing/${id}`, housingForm({ property_name: 'Theirs' }))).status
    ).toBe(404);
    expect((await other.delete(`/api/housing/${id}`)).status).toBe(404);
    expect((await housingList(api, expect)).housings).toEqual([
      expect.objectContaining({ id, name: 'Flat rent', due_date: '03-05' }),
    ]);
  }),

  scenario(
    'housing expenses are listed by due date, with their monthly total',
    async (api, expect) => {
      const december = await addHousing(api, expect, {
        property_name: 'Insurance',
        monthly_amount: 30.25,
        due_month: 12,
        due_day: 1,
      });
      const march = await addHousing(api, expect, {
        property_name: 'Rent',
        due_month: 3,
        due_day: 5,
      });
      const january = await addHousing(api, expect, {
        property_name: 'Parking',
        monthly_amount: 60,
        due_month: 1,
        due_day: 20,
      });
      const listed = await housingList(api, expect);
      expect(listed.housings.map((h: Json) => h.id)).toEqual([january, march, december]);
      // 850.50 + 30.25 + 60, rounded to the unit.
      expect(listed.total_monthly).toBe(941);
    }
  ),

  scenario(
    'a housing expense sent without a due month falls due this month',
    async (api, expect) => {
      const id = await addHousing(api, expect, { due_month: undefined, due_day: 15 });
      const row = (await housingList(api, expect)).housings.find((h: Json) => h.id === id);
      const thisMonth = String(new Date().getUTCMonth() + 1).padStart(2, '0');
      expect(row.due_date).toBe(`${thisMonth}-15`);
    }
  ),
];
