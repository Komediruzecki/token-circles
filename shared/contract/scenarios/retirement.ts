import { addTransaction, dayOf, expectMoney } from '../helpers';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

/** The body the Retirement page saves (features/Retirement.tsx, handleSubmit): every field is required. */
export function retirementForm(fields: Record<string, unknown> = {}) {
  return {
    name: 'Retire at 60',
    target_amount: 750000,
    current_amount: 42000.5,
    target_date: '2050-01-01',
    monthly_contribution: 1200,
    expected_return_rate: 6.5,
    current_age: 38,
    retirement_age: 60,
    ...fields,
  };
}

async function addGoal(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  const reply = await api.post('/api/retirement-goals', retirementForm(fields));
  expectOk(expect, reply, 'POST /api/retirement-goals');
  return reply.body;
}

async function listed(
  api: ContractApi,
  expect: Expect
): Promise<{ goals: Json[]; settings: Json }> {
  const reply = await api.get('/api/retirement-goals');
  expectOk(expect, reply, 'GET /api/retirement-goals');
  return reply.body;
}

async function settingsOf(api: ContractApi, expect: Expect): Promise<Json> {
  const reply = await api.get('/api/retirement/settings');
  expectOk(expect, reply, 'GET /api/retirement/settings');
  return reply.body;
}

/** `YYYY-MM` for this month, in UTC, as both runtimes start a projection. */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** `YYYY-MM` some whole months before this one. */
function monthsAgo(months: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1))
    .toISOString()
    .slice(0, 7);
}

export const retirement = [
  scenario('a retirement goal is added, read back, changed and removed', async (api, expect) => {
    const answer = await addGoal(api, expect);
    // Both answer the fields they were sent, not the stored row.
    expect(answer).toMatchObject({
      id: expect.any(Number),
      name: 'Retire at 60',
      target_amount: 750000,
      current_amount: 42000.5,
      deadline: '2050-01-01',
    });
    const id = answer.id as number;

    let row = (await listed(api, expect)).goals.find((g) => g.id === id);
    expect(row).toMatchObject({
      name: 'Retire at 60',
      deadline: '2050-01-01',
      current_age: 38,
      retirement_age: 60,
      expected_return_rate: 6.5,
      notes: '',
    });
    expectMoney(expect, row.target_amount, 750000, 'target');
    expectMoney(expect, row.current_amount, 42000.5, 'saved');
    expectMoney(expect, row.monthly_contribution, 1200, 'monthly');

    expectOk(
      expect,
      await api.put(
        `/api/retirement-goals/${id}`,
        retirementForm({
          name: 'Retire at 58',
          current_amount: 50000,
          target_date: '2048-06-30',
          retirement_age: 58,
          monthly_contribution: 1500.25,
        })
      ),
      'PUT the goal'
    );
    row = (await listed(api, expect)).goals.find((g) => g.id === id);
    expect(row).toMatchObject({ name: 'Retire at 58', deadline: '2048-06-30', retirement_age: 58 });
    expectMoney(expect, row.current_amount, 50000, 'saved');
    expectMoney(expect, row.monthly_contribution, 1500.25, 'monthly');

    expectOk(expect, await api.delete(`/api/retirement-goals/${id}`), 'DELETE the goal');
    expect((await listed(api, expect)).goals).toEqual([]);
    // A goal that is not there is said the same way by both. The Worker said "Not found" where
    // local-first said "Retirement goal not found", and the goal dialog shows it in its notice.
    for (const reply of [
      await api.put(`/api/retirement-goals/${id}`, retirementForm()),
      await api.delete(`/api/retirement-goals/${id}`),
    ]) {
      expect(reply.status).toBe(404);
      expect(reply.body).toEqual({ error: 'Retirement goal not found' });
    }
  }),

  scenario("another profile's retirement goal is not changed or removed", async (api, expect) => {
    const { id } = await addGoal(api, expect);
    const other = api.other;

    expect((await listed(other, expect)).goals).toEqual([]);
    expect(
      (await other.put(`/api/retirement-goals/${id}`, retirementForm({ name: 'Theirs' }))).status
    ).toBe(404);
    expect((await other.delete(`/api/retirement-goals/${id}`)).status).toBe(404);
    expect((await listed(api, expect)).goals).toEqual([
      expect.objectContaining({ id, name: 'Retire at 60', current_age: 38 }),
    ]);
  }),

  scenario('retirement goals are listed newest first', async (api, expect) => {
    const first = (await addGoal(api, expect, { name: 'First' })).id;
    const second = (await addGoal(api, expect, { name: 'Second' })).id;
    const third = (await addGoal(api, expect, { name: 'Third' })).id;
    expect((await listed(api, expect)).goals.map((g) => g.id)).toEqual([third, second, first]);
  }),

  scenario(
    "the retirement plan fills what was not set from the profile's own data, until it is saved",
    async (api, expect) => {
      await account(api, expect, 'Everyday', 5000.5);
      await account(api, expect, 'Savings', 20000);
      for (const [offset, spent] of [
        [-1, 1000.25],
        [-2, 1200],
        [-3, 799.75],
      ] as const) {
        await addTransaction(api, expect, {
          description: 'Salary',
          type: 'income',
          amount: 3000,
          date: dayOf(offset, 5),
        });
        await addTransaction(api, expect, { amount: spent, date: dayOf(offset, 12) });
      }
      // Older than the twelve months the plan looks back over.
      await addTransaction(api, expect, { amount: 9999, date: dayOf(-14, 12) });
      // The age on the newest goal is the one the plan takes, however close together they were saved.
      await addGoal(api, expect, { name: 'Earlier plan', current_age: 35 });
      await addGoal(api, expect, { current_age: 40 });
      // Another profile's data is not this profile's.
      await account(api.other, expect, 'Theirs', 1000000);

      const derived = await settingsOf(api, expect);
      expect(derived.startMonth).toBe(thisMonth());
      expect(derived.facts).toEqual({
        netWorth: 25000.5,
        monthlyIncome: 3000,
        monthlyExpenses: 1000,
        monthsObserved: 3,
        currentAge: 40,
      });
      expect(derived.settings).toMatchObject({
        netWorth: 25000.5,
        monthlyIncome: 3000,
        monthlyExpenses: 1000,
        monthlyContribution: 2000,
        birthMonth: monthsAgo(480),
        lifestyles: [expect.objectContaining({ monthlySpendToday: 1000 })],
      });
      expect(derived.filled.map((f: Json) => f.field).sort()).toEqual([
        'birthMonth',
        'lifestyles',
        'monthlyContribution',
        'monthlyExpenses',
        'monthlyIncome',
        'netWorth',
      ]);
      expect(derived.missing).toEqual([]);

      // The planner saves the whole settings object, edited.
      const edited = {
        ...derived.settings,
        netWorth: 30000,
        monthlyContribution: 1500,
        birthMonth: '1986-04',
        lifestyles: [{ id: 'default', label: 'Modest', monthlySpendToday: 1250 }],
      };
      const saved = await api.put('/api/retirement/settings', edited);
      expectOk(expect, saved, 'PUT /api/retirement/settings');
      expect(saved.body.settings).toMatchObject({
        netWorth: 30000,
        monthlyContribution: 1500,
        birthMonth: '1986-04',
        monthlyIncome: 3000,
      });
      expect(saved.body.filled).toEqual([]);
      expect(saved.body.missing).toEqual([]);

      const reread = await settingsOf(api, expect);
      expect(reread.settings).toEqual(saved.body.settings);
      expect(reread.filled).toEqual([]);
      // The goals list carries what was saved, too.
      expect((await listed(api, expect)).settings).toEqual(saved.body.settings);

      const projected = await api.get('/api/retirement/projection');
      expectOk(expect, projected, 'GET /api/retirement/projection');
      expect(projected.body.settings).toEqual(saved.body.settings);
      expect(projected.body.filled).toEqual([]);
      const projection = projected.body.projection;
      expect(projection.rows[0]).toMatchObject({ month: thisMonth(), index: 0, netWorth: 30000 });
      // 1,250 a month at a 4% withdrawal rate.
      expect(projection.lifestyles).toEqual([
        expect.objectContaining({ label: 'Modest', targetToday: 375000 }),
      ]);
      expect(projection.rows.length).toBeGreaterThan(12);

      // The other profile has saved nothing, and its data is its own.
      const theirs = await settingsOf(api.other, expect);
      expect(theirs.facts).toMatchObject({
        netWorth: 1000000,
        monthsObserved: 0,
        currentAge: null,
      });
      expect(theirs.settings.birthMonth).toBeNull();
      expect(theirs.missing).toEqual(expect.arrayContaining(['birthMonth', 'monthlyIncome']));
      expect((await listed(api.other, expect)).settings).toEqual({});
    }
  ),
];
