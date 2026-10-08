import { addCategory, addTransaction, expectMoney, monthStart } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** A month's budget, with the body the Budgets and Categories pages post (updateCatBudget). */
async function budget(
  api: ContractApi,
  expect: Expect,
  category: number,
  amount: number,
  start = '2026-03-01'
) {
  return added(api, expect, '/api/budgets', {
    category_id: category,
    amount,
    period: 'monthly',
    start_date: start,
  });
}

/** Every budget of the profile, as `GET /api/budgets` answers them. */
async function listBudgets(api: ContractApi, expect: Expect): Promise<Json[]> {
  const reply = await api.get('/api/budgets');
  expectOk(expect, reply, 'GET /api/budgets');
  return reply.body as Json[];
}

/** One budget out of the list: there is no single read on the Worker. */
async function budgetRow(api: ContractApi, expect: Expect, id: number): Promise<Json | undefined> {
  return (await listBudgets(api, expect)).find((row) => Number(row.id) === id);
}

/** The budgets that start on one day, as `[category_id, amount]`, sorted. */
async function monthOf(api: ContractApi, expect: Expect, start: string) {
  return (await listBudgets(api, expect))
    .filter((row) => row.start_date === start)
    .map((row) => [Number(row.category_id), Number(row.amount)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

async function rollover(api: ContractApi, expect: Expect, id: number, body: Json) {
  const reply = await api.put(`/api/budgets/${id}/rollover`, body);
  expectOk(expect, reply, `PUT /api/budgets/${id}/rollover`);
  return reply.body;
}

function byCategory(rows: readonly Json[], category: number): Json {
  return rows.find((row) => Number(row.category_id) === category);
}

/**
 * February and March of one profile: Food budgeted both months with rollover on, Fun in March,
 * Rent spent on without a budget, one uncategorised expense and the month's pay. The other
 * profile budgets and spends in March too, and must count nowhere.
 */
async function twoMonths(api: ContractApi, expect: Expect) {
  const food = await addCategory(api, expect, 'Food');
  const fun = await addCategory(api, expect, 'Fun');
  const rent = await addCategory(api, expect, 'Rent');
  const pay = await addCategory(api, expect, 'Pay', 'income');
  const foodFeb = await budget(api, expect, food, 200, '2026-02-01');
  const foodMar = await budget(api, expect, food, 300, '2026-03-01');
  const funMar = await budget(api, expect, fun, 100, '2026-03-01');
  // The Budgets page's rollover switch.
  await rollover(api, expect, foodFeb, { rollover_enabled: true });
  await rollover(api, expect, foodMar, { rollover_enabled: true });

  await addTransaction(api, expect, { amount: 150, date: '2026-02-10', category_id: food });
  await addTransaction(api, expect, { amount: 120.4, date: '2026-03-05', category_id: food });
  // The last day of the month belongs to it.
  await addTransaction(api, expect, { amount: 59.6, date: '2026-03-31', category_id: food });
  await addTransaction(api, expect, { amount: 110, date: '2026-03-12', category_id: fun });
  await addTransaction(api, expect, { amount: 500, date: '2026-03-01', category_id: rent });
  await addTransaction(api, expect, { amount: 25, date: '2026-03-15' });
  await addTransaction(api, expect, {
    description: 'Salary',
    type: 'income',
    amount: 2000,
    date: '2026-03-01',
    category_id: pay,
  });

  const other = api.other;
  const theirFood = await addCategory(other, expect, 'Food');
  await budget(other, expect, theirFood, 50, '2026-03-01');
  await addTransaction(other, expect, { amount: 40, date: '2026-03-05', category_id: theirFood });
  await addTransaction(other, expect, { type: 'income', amount: 900, date: '2026-03-02' });

  return { food, fun, rent, foodFeb, foodMar, funMar };
}

export const budgets = [
  scenario('a budget is added, read back, changed and removed', async (api, expect) => {
    const food = await addCategory(api, expect, 'Food');
    const fun = await addCategory(api, expect, 'Fun');
    const id = await budget(api, expect, food, 300.25);

    const row = await budgetRow(api, expect, id);
    expect(row).toMatchObject({
      id,
      category_id: food,
      period: 'monthly',
      start_date: '2026-03-01',
      end_date: null,
    });
    expectMoney(expect, row.amount, 300.25);
    expect(Boolean(row.rollover_enabled)).toBe(false);

    expectOk(
      expect,
      await api.put(`/api/budgets/${id}`, {
        category_id: fun,
        amount: 275.5,
        period: 'monthly',
        start_date: '2026-04-01',
      }),
      'PUT the budget'
    );
    const changed = await budgetRow(api, expect, id);
    expect(changed).toMatchObject({ id, category_id: fun, start_date: '2026-04-01' });
    expectMoney(expect, changed.amount, 275.5);

    expectOk(expect, await api.delete(`/api/budgets/${id}`), 'DELETE the budget');
    expect(await budgetRow(api, expect, id)).toBeUndefined();
    expect((await api.delete(`/api/budgets/${id}`)).status).toBe(404);
  }),

  scenario("another profile's budget is not read, changed or removed", async (api, expect) => {
    const food = await addCategory(api, expect, 'Food');
    const id = await budget(api, expect, food, 300);
    const other = api.other;
    const theirs = await addCategory(other, expect, 'Their food');

    expect(await listBudgets(other, expect)).toEqual([]);
    expect(
      (
        await other.put(`/api/budgets/${id}`, {
          category_id: theirs,
          amount: 1,
          period: 'monthly',
          start_date: '2026-03-01',
        })
      ).status
    ).toBe(404);
    expect(
      (await other.put(`/api/budgets/${id}/rollover`, { rollover_enabled: true })).status
    ).toBe(404);
    expect((await other.delete(`/api/budgets/${id}`)).status).toBe(404);

    const row = await budgetRow(api, expect, id);
    expect(row).toMatchObject({ category_id: food, start_date: '2026-03-01' });
    expectMoney(expect, row.amount, 300);
    expect(Boolean(row.rollover_enabled)).toBe(false);

    // DIFFERENCE foreign-link-status: a budget on another profile's category.
    expect(
      (
        await api.post('/api/budgets', {
          category_id: theirs,
          amount: 50,
          period: 'monthly',
          start_date: '2026-03-01',
        })
      ).status
    ).toBe(api.runtime === 'worker' ? 403 : 400);
    expect(await listBudgets(api, expect)).toHaveLength(1);
    expect(await listBudgets(other, expect)).toEqual([]);
  }),

  scenario("allocating to another profile's category is refused", async (api, expect) => {
    // In a household view the Budgets page lists every selected profile's categories, and its
    // Allocate button posts whichever one was picked.
    const theirs = await addCategory(api.other, expect, 'Their food');
    const reply = await api.post('/api/budgets/allocate?month=2026-03', {
      category_id: theirs,
      amount: 50,
      period: 'monthly',
    });
    // DIFFERENCE foreign-link-status
    expect(reply.status, JSON.stringify(reply.body)).toBe(api.runtime === 'worker' ? 403 : 400);
    expect(await listBudgets(api, expect)).toEqual([]);
    expect(await listBudgets(api.other, expect)).toEqual([]);
  }),

  scenario('an edit changes only the fields it is sent', async (api, expect) => {
    const food = await addCategory(api, expect, 'Food');
    const id = await budget(api, expect, food, 300);
    await rollover(api, expect, id, { rollover_enabled: true });

    expectOk(expect, await api.put(`/api/budgets/${id}`, { amount: 250 }), 'PUT an amount alone');
    let row = await budgetRow(api, expect, id);
    expect(row).toMatchObject({ category_id: food, period: 'monthly', start_date: '2026-03-01' });
    expectMoney(expect, row.amount, 250);
    expect(Boolean(row.rollover_enabled)).toBe(true);

    // The budget form's fields, which do not include the rollover switch.
    expectOk(
      expect,
      await api.put(`/api/budgets/${id}`, {
        category_id: food,
        amount: 260,
        period: 'monthly',
        start_date: '2026-03-01',
      }),
      'PUT the form fields'
    );
    row = await budgetRow(api, expect, id);
    expectMoney(expect, row.amount, 260);
    expect(Boolean(row.rollover_enabled)).toBe(true);
  }),

  scenario(
    "the month summary counts spending, last month's unused budget and what is left",
    async (api, expect) => {
      const { food, fun, foodMar } = await twoMonths(api, expect);

      const summary = async () => {
        const reply = await api.get('/api/budgets/summary?year=2026&month=3');
        expectOk(expect, reply, 'GET /api/budgets/summary');
        expect(reply.body).toHaveLength(2);
        return reply.body as Json[];
      };

      let rows = await summary();
      // Food: 300 budgeted, 180 spent, and February's 50 unused rolls in.
      expect(byCategory(rows, food)).toMatchObject({ id: foodMar, category_name: 'Food' });
      expectMoney(expect, byCategory(rows, food).spent, 180, 'Food spent');
      expectMoney(expect, byCategory(rows, food).remaining, 120, 'Food remaining');
      expectMoney(expect, byCategory(rows, food).auto_rollover, 50, 'Food auto rollover');
      expectMoney(expect, byCategory(rows, food).rollover_contribution, 50, 'Food rollover');
      expectMoney(expect, byCategory(rows, food).effective_budget, 350, 'Food effective');
      expectMoney(expect, byCategory(rows, food).effective_remaining, 170, 'Food left');
      expectMoney(expect, byCategory(rows, food).percentage, 60, 'Food percentage');
      // Fun: over budget, and its percentage stops at 100.
      expectMoney(expect, byCategory(rows, fun).spent, 110, 'Fun spent');
      expectMoney(expect, byCategory(rows, fun).remaining, -10, 'Fun remaining');
      expectMoney(expect, byCategory(rows, fun).rollover_contribution, 0, 'Fun rollover');
      expectMoney(expect, byCategory(rows, fun).effective_budget, 100, 'Fun effective');
      expectMoney(expect, byCategory(rows, fun).percentage, 100, 'Fun percentage');

      // A manual adjustment adds to the rollover, and what was used of it comes off.
      const adjusted = await rollover(api, expect, foodMar, {
        rollover_amount: 25,
        rollover_used: 10,
      });
      expect(adjusted.ok).toBe(true);
      expectMoney(expect, adjusted.budget.rollover_amount, 25, 'rollover_amount');
      rows = await summary();
      expectMoney(expect, byCategory(rows, food).rollover_contribution, 65, 'Food rollover');
      expectMoney(expect, byCategory(rows, food).effective_budget, 365, 'Food effective');
      expectMoney(expect, byCategory(rows, food).effective_remaining, 185, 'Food left');

      // Switched off, the budget is its own amount again.
      const off = await rollover(api, expect, foodMar, { rollover_enabled: false });
      expect(Boolean(off.budget.rollover_enabled)).toBe(false);
      rows = await summary();
      expectMoney(expect, byCategory(rows, food).auto_rollover, 0, 'Food auto rollover');
      expectMoney(expect, byCategory(rows, food).effective_budget, 300, 'Food effective');

      expect((await api.put(`/api/budgets/${foodMar}/rollover`, {})).status).toBe(400);
    }
  ),

  scenario("a category's budget history, newest month first", async (api, expect) => {
    const { food } = await twoMonths(api, expect);
    const reply = await api.get(`/api/budgets/history?category_id=${food}&months=6`);
    expectOk(expect, reply, 'GET /api/budgets/history');
    expect(reply.body).toHaveLength(2);
    expect(reply.body[0].month).toBe('2026-03-01');
    expectMoney(expect, reply.body[0].budget_amount, 300, 'March budget');
    expectMoney(expect, reply.body[0].spent, 180, 'March spent');
    expect(reply.body[1].month).toBe('2026-02-01');
    expectMoney(expect, reply.body[1].budget_amount, 200, 'February budget');
    expectMoney(expect, reply.body[1].spent, 150, 'February spent');

    const one = await api.get(`/api/budgets/history?category_id=${food}&months=1`);
    expect(one.body).toHaveLength(1);
    expect(one.body[0].month).toBe('2026-03-01');
  }),

  scenario('budget alerts list the categories at or over the threshold', async (api, expect) => {
    const { food, fun } = await twoMonths(api, expect);
    const reply = await api.get('/api/budgets/alerts?threshold=80&year=2026&month=3');
    expectOk(expect, reply, 'GET /api/budgets/alerts');
    expect(reply.body).toMatchObject({
      threshold: 80,
      startDate: '2026-03-01',
      endDate: '2026-04-01',
    });
    const alerts = reply.body.alerts as Json[];
    expect(alerts[0]).toMatchObject({
      categoryId: fun,
      categoryName: 'Fun',
      percentage: 110,
      status: 'over',
    });
    expectMoney(expect, alerts[0].budgetAmount, 100, 'Fun budget');
    expectMoney(expect, alerts[0].spent, 110, 'Fun spent');
    expectMoney(expect, alerts[0].remaining, -10, 'Fun remaining');
    // March's Food budget is 60% spent: under the threshold.
    expect(alerts).not.toContainEqual(
      expect.objectContaining({ categoryId: food, budgetAmount: 300 })
    );
  }),

  scenario(
    'zero-based budgeting: income, what each category has and what is left to assign',
    async (api, expect) => {
      const { food, fun, rent, foodMar, funMar } = await twoMonths(api, expect);

      const form = await api.get('/api/budgets/zero-based?month=2026-03');
      expectOk(expect, form, 'GET /api/budgets/zero-based');
      expect(form.body).toMatchObject({ period: '2026-03', can_allocate: true });
      expectMoney(expect, form.body.remaining_income, 2000, 'income');
      expectMoney(expect, form.body.alreadyBudgeted, 400, 'already budgeted');
      expectMoney(expect, form.body.unassigned_budget, 1600, 'unassigned');
      expect((form.body.categories as Json[]).map((c) => c.name)).toEqual(['Food', 'Fun', 'Rent']);

      const allocations = form.body.allocations as Json[];
      expect(byCategory(allocations, food)).toMatchObject({
        budget_id: foodMar,
        category_name: 'Food',
        is_budgeted: true,
        percent_used: 60,
      });
      expectMoney(expect, byCategory(allocations, food).amount, 300, 'Food amount');
      expectMoney(expect, byCategory(allocations, food).spent, 180, 'Food spent');
      expectMoney(expect, byCategory(allocations, food).remaining_budget, 120, 'Food left');
      expect(byCategory(allocations, fun)).toMatchObject({
        budget_id: funMar,
        is_budgeted: true,
        percent_used: 100,
      });
      expectMoney(expect, byCategory(allocations, fun).remaining_budget, -10, 'Fun left');
      expect(byCategory(allocations, rent)).toMatchObject({ budget_id: null, is_budgeted: false });
      expectMoney(expect, byCategory(allocations, rent).spent, 500, 'Rent spent');
      // DIFFERENCE budget-zero-based-unbudgeted
      if (api.runtime === 'worker') {
        expect(byCategory(allocations, rent)).toMatchObject({ amount: 0, percent_used: 0 });
      } else {
        expect(byCategory(allocations, rent)).toMatchObject({ amount: 500, percent_used: 100 });
      }

      const summary = await api.get('/api/budgets/zero-based/summary?month=2026-03');
      expectOk(expect, summary, 'GET /api/budgets/zero-based/summary');
      expect(summary.body).toMatchObject({ period: '2026-03', can_allocate: true });
      expectMoney(expect, summary.body.income, 2000, 'income');
      expectMoney(expect, summary.body.total_budget, 400, 'total budget');
      expectMoney(expect, summary.body.already_budgeted, 400, 'already budgeted');
      // Spent counts every category with spending this month, Rent included.
      expectMoney(expect, summary.body.total_spent, 790, 'total spent');
      expectMoney(expect, summary.body.remaining, -390, 'remaining');
      expectMoney(expect, summary.body.zero_based_remaining, 1600, 'left to assign');
      expectMoney(expect, summary.body.unassigned_budget, 1600, 'unassigned');

      const rows = summary.body.allocations as Json[];
      expect(rows).toHaveLength(3);
      expect(byCategory(rows, food)).toMatchObject({
        budget_id: foodMar,
        status: 'ok',
        is_fully_allocated: true,
        alerts: [],
      });
      expectMoney(expect, byCategory(rows, food).allocated, 300, 'Food allocated');
      expectMoney(expect, byCategory(rows, food).spent, 180, 'Food spent');
      expectMoney(expect, byCategory(rows, food).percent_used, 60, 'Food used');
      expect(byCategory(rows, fun)).toMatchObject({
        budget_id: funMar,
        status: 'over',
        is_fully_allocated: false,
      });
      expectMoney(expect, byCategory(rows, fun).percent_used, 110, 'Fun used');
      expectMoney(expect, byCategory(rows, fun).remaining, -10, 'Fun left');
      // DIFFERENCE budget-allocation-alerts
      expect(byCategory(rows, fun).alerts).toEqual([
        'Approaching limit: 110% used',
        api.runtime === 'worker' ? 'Over budget by $-10.00' : 'Over budget by $10.00',
      ]);
      expect(byCategory(rows, 0)).toMatchObject({
        category_name: 'Unallocated / Future',
        is_unallocated: true,
      });
      expectMoney(expect, byCategory(rows, 0).remaining, 1600, 'unallocated');
    }
  ),

  scenario(
    "allocating sets a category's budget for this month, and again changes it",
    async (api, expect) => {
      const food = await addCategory(api, expect, 'Food');
      const month = monthStart(0).slice(0, 7);

      // The Allocate dialog's body; the page sends no month, so it is this month.
      const first = await api.post('/api/budgets/allocate', {
        category_id: food,
        amount: 150,
        period: 'monthly',
      });
      expectOk(expect, first, 'POST /api/budgets/allocate');
      expect(first.body).toMatchObject({
        category_id: food,
        period: 'monthly',
        start_date: `${month}-01`,
        message: 'Budget allocated successfully',
      });
      const again = await api.post('/api/budgets/allocate', {
        category_id: food,
        amount: 175.25,
        period: 'monthly',
      });
      expectOk(expect, again, 'POST /api/budgets/allocate again');
      expect(again.body).toMatchObject({
        id: first.body.id,
        message: 'Budget updated successfully',
      });
      expect(await monthOf(api, expect, `${month}-01`)).toEqual([[food, 175.25]]);

      const form = await api.get(`/api/budgets/zero-based?month=${month}`);
      expect(byCategory(form.body.allocations, food)).toMatchObject({
        budget_id: first.body.id,
        is_budgeted: true,
      });
      expectMoney(expect, byCategory(form.body.allocations, food).amount, 175.25);

      // A month in the query allocates that month.
      const march = await api.post('/api/budgets/allocate?month=2026-03', {
        category_id: food,
        amount: 90,
        period: 'monthly',
      });
      expectOk(expect, march, 'POST /api/budgets/allocate?month=2026-03');
      expect(await monthOf(api, expect, '2026-03-01')).toEqual([[food, 90]]);
    }
  ),

  scenario("last month's budgets are copied to this month, once", async (api, expect) => {
    const food = await addCategory(api, expect, 'Food');
    const fun = await addCategory(api, expect, 'Fun');
    const gym = await addCategory(api, expect, 'Gym');
    const foodMar = await budget(api, expect, food, 300);
    const funMar = await budget(api, expect, fun, 100);
    await rollover(api, expect, foodMar, { rollover_enabled: true });
    // 25 carried into March by hand, on top of what February left.
    await rollover(api, expect, funMar, { rollover_enabled: true, rollover_amount: 25 });
    // April already has its own Food budget, and one for Gym, which March does not budget.
    const foodApr = await budget(api, expect, food, 450, '2026-04-01');
    const gymApr = await budget(api, expect, gym, 50, '2026-04-01');

    // The Budgets page sends the month it shows.
    const copy = async (month: number) => {
      const reply = await api.post('/api/budgets/duplicate-last', { year: 2026, month });
      expectOk(expect, reply, `POST /api/budgets/duplicate-last into month ${month}`);
      return reply.body;
    };

    // Only Fun is copied: a budget April already has is never replaced, and Food was there.
    const first = await copy(4);
    expect(await monthOf(api, expect, '2026-04-01')).toEqual([
      [food, 450],
      [fun, 100],
      [gym, 50],
    ]);
    expect(first).toMatchObject({ ok: true, count: 1, already_budgeted: 1 });
    const april = (await listBudgets(api, expect)).filter((row) => row.start_date === '2026-04-01');
    expect(byCategory(april, food).id, "April's own Food budget is the one kept").toBe(foodApr);
    expect(Boolean(byCategory(april, food).rollover_enabled), "with April's rollover").toBe(false);
    expect(byCategory(april, gym).id).toBe(gymApr);
    expect(Boolean(byCategory(april, fun).rollover_enabled), 'Fun keeps its rollover').toBe(true);
    // The rollover switch carries over, the 25 set by hand does not: it was carried into March,
    // and April rolls over only what March left unspent (all of its 100).
    const summary = await api.get('/api/budgets/summary?year=2026&month=4');
    expectOk(expect, summary, 'GET /api/budgets/summary for April');
    expectMoney(expect, byCategory(summary.body, fun).rollover_contribution, 100, 'Fun rollover');
    expectMoney(expect, byCategory(summary.body, fun).effective_budget, 200, 'Fun effective');
    expectMoney(expect, byCategory(april, fun).rollover_amount, 0, "April's Fun rollover amount");

    // Copying again copies nothing and adds nothing.
    expect(await copy(4)).toMatchObject({ ok: true, count: 0, already_budgeted: 2 });
    expect(await monthOf(api, expect, '2026-04-01')).toEqual([
      [food, 450],
      [fun, 100],
      [gym, 50],
    ]);
    expect(await monthOf(api, expect, '2026-03-01')).toEqual([
      [food, 300],
      [fun, 100],
    ]);

    // Into a month with no budgets, every one of last month's is copied.
    expect(await copy(5)).toMatchObject({ ok: true, count: 3, already_budgeted: 0 });
    expect(await monthOf(api, expect, '2026-05-01')).toEqual([
      [food, 450],
      [fun, 100],
      [gym, 50],
    ]);

    const none = await api.post('/api/budgets/duplicate-last', { year: 2026, month: 9 });
    expectOk(expect, none, 'POST /api/budgets/duplicate-last with nothing to copy');
    expect(none.body).toMatchObject({ ok: false, message: 'No budgets found for previous month' });
  }),

  scenario("this month's budgets are set from last month's spending", async (api, expect) => {
    const food = await addCategory(api, expect, 'Food');
    const fun = await addCategory(api, expect, 'Fun');
    await addTransaction(api, expect, { amount: 120.4, date: '2026-02-03', category_id: food });
    await addTransaction(api, expect, { amount: 29.6, date: '2026-02-28', category_id: food });
    await addTransaction(api, expect, { amount: 30.5, date: '2026-02-14', category_id: fun });
    await addTransaction(api, expect, { amount: 75, date: '2026-02-20' });
    await addTransaction(api, expect, { amount: 999, date: '2026-03-02', category_id: fun });
    await budget(api, expect, fun, 999, '2026-03-01');
    await addTransaction(api.other, expect, { amount: 40, date: '2026-02-05' });

    const reply = await api.post('/api/budgets/from-expenses', { year: 2026, month: 3 });
    expectOk(expect, reply, 'POST /api/budgets/from-expenses');
    expect(reply.body).toMatchObject({ ok: true, count: 2 });
    expect(await monthOf(api, expect, '2026-03-01')).toEqual([
      [food, 150],
      [fun, 30.5],
    ]);

    const none = await api.post('/api/budgets/from-expenses', { year: 2026, month: 6 });
    expectOk(expect, none, 'POST /api/budgets/from-expenses with nothing spent');
    expect(none.body).toMatchObject({ ok: false, message: 'No expenses found for previous month' });
    expect(await listBudgets(api.other, expect)).toEqual([]);
  }),

  scenario("every month's budgets are backfilled from its spending", async (api, expect) => {
    const { food, fun, rent } = await twoMonths(api, expect);

    // Budgets.tsx and the import flow both post an empty body: the whole range.
    const reply = await api.post('/api/budgets/backfill-from-spending', {});
    expectOk(expect, reply, 'POST /api/budgets/backfill-from-spending');
    expect(reply.body).toMatchObject({ ok: true, count: 4, months: 2 });
    expect(await monthOf(api, expect, '2026-02-01')).toEqual([[food, 150]]);
    expect(await monthOf(api, expect, '2026-03-01')).toEqual([
      [food, 180],
      [fun, 110],
      [rent, 500],
    ]);

    // A range leaves the months outside it alone.
    await budget(api, expect, food, 210, '2026-02-01');
    const march = await api.post('/api/budgets/backfill-from-spending', {
      from_month: '2026-03',
      to_month: '2026-03',
    });
    expect(march.body).toMatchObject({ ok: true, count: 3, months: 1 });
    expect(await monthOf(api, expect, '2026-02-01')).toEqual([
      [food, 150],
      [food, 210],
    ]);

    const theirs = await listBudgets(api.other, expect);
    expect(theirs).toHaveLength(1);
    expectMoney(expect, theirs[0].amount, 50, "the other profile's budget");
  }),

  scenario('budget adherence by month, with the month before', async (api, expect) => {
    await twoMonths(api, expect);

    const trend = await api.get('/api/budgets/improvements?months=6');
    expectOk(expect, trend, 'GET /api/budgets/improvements');
    expect((trend.body as Json[]).map((m) => m.month)).toEqual(['2026-03', '2026-02']);
    const [march, february] = trend.body as Json[];
    // Every budget of the month counts once: Food 300 and Fun 100.
    expectMoney(expect, march.total_budget, 400, 'March budget');
    expectMoney(expect, february.total_budget, 200, 'February budget');
    expectMoney(expect, february.total_spent, 150, 'February spent');
    expectMoney(expect, february.adherence_pct, 75, 'February adherence');
    expect(february.prev_adherence).toBeNull();
    expectMoney(expect, march.prev_adherence, 75, 'March against February');
    // DIFFERENCE budget-trend-spending
    if (api.runtime === 'worker') {
      expectMoney(expect, march.total_spent, 290, 'March spent');
      expectMoney(expect, march.adherence_pct, 72.5, 'March adherence');
      expectMoney(expect, march.change_pct, -2.5, 'March change');
    } else {
      expectMoney(expect, march.total_spent, 815, 'March spent');
      expectMoney(expect, march.adherence_pct, 203.75, 'March adherence');
      expectMoney(expect, march.change_pct, 128.75, 'March change');
    }
    expect(
      (JSON.parse(march.category_budgets) as Json[]).map((c) => [c.name, Number(c.budget_amount)])
    ).toEqual([
      ['Food', 300],
      ['Fun', 100],
    ]);

    const one = await api.get('/api/budgets/improvements?months=1');
    expect((one.body as Json[]).map((m) => m.month)).toEqual(['2026-03']);
  }),

  scenario("the forecast's history counts each budget once", async (api, expect) => {
    await twoMonths(api, expect);

    const forecast = await api.get('/api/budgets/forecast?month=2026-04');
    expectOk(expect, forecast, 'GET /api/budgets/forecast');
    expect(forecast.body.period).toBe('2026-04');
    expectMoney(expect, forecast.body.total_budget, 600, 'every budget to April');
    const history = forecast.body.history as Json[];
    expect(history.map((m) => m.month)).toEqual(['2026-03', '2026-02']);
    // Food's March budget has two expenses against it and still counts 300, not 600.
    expectMoney(expect, history[0].total_budget, 400, 'March budget');
    expectMoney(expect, history[1].total_budget, 200, 'February budget');
    expectMoney(expect, history[1].total_spent, 150, 'February spent');
    expectMoney(expect, history[1].adherence, 75, 'February adherence');
    // DIFFERENCE budget-trend-spending
    if (api.runtime === 'worker') {
      expectMoney(expect, history[0].total_spent, 290, 'March spent');
      expectMoney(expect, history[0].adherence, 72.5, 'March adherence');
      expect(forecast.body.avg_adherence).toBe(74);
    } else {
      expectMoney(expect, history[0].total_spent, 815, 'March spent');
      expectMoney(expect, history[0].adherence, 100, 'March adherence');
      expect(forecast.body.avg_adherence).toBe(88);
    }
  }),

  scenario('the forecast covers the next six months', async (api, expect) => {
    await twoMonths(api, expect);

    const forecast = await api.get('/api/budgets/forecast?month=2026-04');
    expectOk(expect, forecast, 'GET /api/budgets/forecast');
    // Each month from Food's average month, (150 + 180) / 2, and 3% a month of inflation.
    const months = forecast.body.forecast as Json[];
    expect(months.map((m) => m.month)).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => monthStart(i).slice(0, 7))
    );
    expectMoney(expect, months[0].budget_amount, 200, 'forecast budget');
    expectMoney(expect, months[0].predicted_spent, 165 * 1.03, 'next month predicted');
    expectMoney(expect, months[5].predicted_spent, 165 * 1.03 ** 6, 'sixth month predicted');
    expect(months[0].status).toBe('warning');

    const empty = await api.other.get('/api/budgets/forecast?month=2026-02');
    expectOk(expect, empty, 'GET /api/budgets/forecast with no budgets');
    expect(empty.body).toMatchObject({ history: [], forecast: [], total_budget: 0 });
  }),
];
