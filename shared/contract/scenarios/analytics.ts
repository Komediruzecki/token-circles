import { addTransaction, dayOf, isoDay, monthEnd, monthStart } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/** A category with its own colour, as the Categories form adds it. */
async function category(
  api: ContractApi,
  expect: Expect,
  name: string,
  color: string,
  type = 'expense'
): Promise<number> {
  return added(api, expect, '/api/categories', { name, type, color, icon: 'tag' });
}

/**
 * A year of one profile, 2025: Rent and three Food days in March (two Food rows on the 22nd),
 * a Food day in July, one uncategorised expense and the March pay. The other profile spends on
 * Fuel in March, and must count only when both profiles are selected.
 */
async function year2025(api: ContractApi, expect: Expect) {
  const food = await category(api, expect, 'Food', '#2e7d32');
  const rent = await category(api, expect, 'Rent', '#1565c0');
  const salary = await category(api, expect, 'Salary', '#f9a825', 'income');
  const spend = (description: string, amount: number, date: string, category_id: number | null) =>
    addTransaction(api, expect, { description, amount, date, category_id });
  await spend('Rent', 800, '2025-03-01', rent);
  await spend('Groceries', 45.5, '2025-03-10', food);
  await spend('Cash', 20, '2025-03-15', null);
  await spend('Market', 30.25, '2025-03-22', food);
  await spend('Bakery', 4.75, '2025-03-22', food);
  await spend('Picnic', 12, '2025-07-04', food);
  await addTransaction(api, expect, {
    description: 'Salary',
    amount: 2500,
    date: '2025-03-25',
    type: 'income',
    category_id: salary,
  });

  const fuel = await category(api.other, expect, 'Fuel', '#6d4c41');
  await addTransaction(api.other, expect, {
    description: 'Fuel',
    amount: 60,
    date: '2025-03-10',
    category_id: fuel,
  });
  await addTransaction(api.other, expect, {
    description: 'Old fuel',
    amount: 55,
    date: '2023-05-02',
    category_id: fuel,
  });
}

async function read(api: ContractApi, expect: Expect, path: string): Promise<Json> {
  const reply = await api.get(path);
  expectOk(expect, reply, `GET ${path}`);
  return reply.body;
}

/** Twelve zeros with the given months filled in, `{ 3: 800 }` being March. */
function months(filled: Record<number, number>): number[] {
  return Array.from({ length: 12 }, (_, i) => filled[i + 1] ?? 0);
}

/** A month's days, zero but for those given, `{ 10: 45.5 }` being the 10th. */
function days(length: number, filled: Record<number, number>): number[] {
  return Array.from({ length }, (_, i) => filled[i + 1] ?? 0);
}

/** A link of the budget flow, each end named with its kind as both runtimes name them. */
function link(source: string, target: string, value: number) {
  const kind = (name: string) =>
    ({ 'Total Budget': 'budget', 'Total Actual': 'actual', 'Unused Budget': 'savings' })[name] ??
    'category';
  return { source, target, value, sourceCategory: kind(source), targetCategory: kind(target) };
}

/** The flow's nodes and links in one order: each runtime adds them in its own. */
function sorted(flow: Json) {
  const key = (x: Json) => `${x.source ?? ''}>${x.target ?? x.name}`;
  const byKey = (a: Json, b: Json) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return {
    nodes: [...flow.nodes].sort(byKey),
    links: [...flow.links].sort(byKey),
    hasBudgets: flow.hasBudgets,
  };
}

export const analytics = [
  scenario('a year of spending, by category, by month and by week', async (api, expect) => {
    await year2025(api, expect);

    // The stacked chart's year view: one dataset per category with spending, largest first.
    // Uncategorised spending and the other profile's count nowhere.
    expect(
      await read(api, expect, '/api/analytics/category-trends?year=2025&type=expense')
    ).toEqual({
      labels: [
        'Jan 2025',
        'Feb 2025',
        'Mar 2025',
        'Apr 2025',
        'May 2025',
        'Jun 2025',
        'Jul 2025',
        'Aug 2025',
        'Sep 2025',
        'Oct 2025',
        'Nov 2025',
        'Dec 2025',
      ],
      datasets: [
        { category: 'Rent', color: '#1565c0', data: months({ 3: 800 }) },
        { category: 'Food', color: '#2e7d32', data: months({ 3: 80.5, 7: 12 }) },
      ],
      numDays: 365,
    });
    expect(await read(api, expect, '/api/analytics/category-trends?type=income&year=2025')).toEqual(
      {
        labels: expect.any(Array),
        datasets: [{ category: 'Salary', color: '#f9a825', data: months({ 3: 2500 }) }],
        numDays: 365,
      }
    );

    // The month view, as the page sends it: the month unpadded.
    const march = await read(
      api,
      expect,
      '/api/analytics/category-trends?year=2025&type=expense&month=3'
    );
    expect(march.labels).toHaveLength(31);
    expect([march.labels[0], march.labels[30]]).toEqual(['March 1', 'March 31']);
    expect(march.numDays).toBe(31);
    expect(march.datasets).toEqual([
      { category: 'Rent', color: '#1565c0', data: days(31, { 1: 800 }) },
      { category: 'Food', color: '#2e7d32', data: days(31, { 10: 45.5, 22: 35 }) },
    ]);

    // Its weeks, and one week of it: the 8th to the 14th, a Saturday to a Friday.
    expect(await read(api, expect, '/api/analytics/weeks?year=2025&month=3')).toEqual({
      weeks: [
        { week: 1, label: 'Week 1 (2025-02-23 - 2025-03-01)' },
        { week: 2, label: 'Week 2 (2025-03-02 - 2025-03-08)' },
        { week: 3, label: 'Week 3 (2025-03-09 - 2025-03-15)' },
        { week: 4, label: 'Week 4 (2025-03-16 - 2025-03-22)' },
        { week: 5, label: 'Week 5 (2025-03-23 - 2025-03-29)' },
      ],
    });
    expect(await read(api, expect, '/api/analytics/weeks')).toEqual({ weeks: [] });
    expect(
      await read(
        api,
        expect,
        '/api/analytics/category-trends?year=2025&type=expense&month=3&week=2'
      )
    ).toEqual({
      labels: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      datasets: [{ category: 'Food', color: '#2e7d32', data: [0, 0, 45.5, 0, 0, 0, 0] }],
      numDays: 7,
    });

    // The other profile sees only its own.
    expect(
      (await read(api.other, expect, '/api/analytics/category-trends?year=2025&type=expense'))
        .datasets
    ).toEqual([{ category: 'Fuel', color: '#6d4c41', data: months({ 3: 60 }) }]);

    // Both profiles selected: both spend.
    expect(
      (
        await read(
          api.household,
          expect,
          '/api/analytics/category-trends?year=2025&type=expense&month=3'
        )
      ).datasets
    ).toEqual([
      { category: 'Rent', color: '#1565c0', data: days(31, { 1: 800 }) },
      { category: 'Food', color: '#2e7d32', data: days(31, { 10: 45.5, 22: 35 }) },
      { category: 'Fuel', color: '#6d4c41', data: days(31, { 10: 60 }) },
    ]);
  }),

  scenario(
    'a year of spending, day by day, and the years there is data for',
    async (api, expect) => {
      await year2025(api, expect);

      // The heatmap sums each day, uncategorised spending included.
      expect(
        await read(api, expect, '/api/analytics/daily-heatmap?year=2025&type=expense')
      ).toEqual({
        dates: {
          '2025-03-01': 800,
          '2025-03-10': 45.5,
          '2025-03-15': 20,
          '2025-03-22': 35,
          '2025-07-04': 12,
        },
        year: 2025,
        type: 'expense',
      });
      expect(await read(api, expect, '/api/analytics/daily-heatmap?year=2025&type=income')).toEqual(
        {
          dates: { '2025-03-25': 2500 },
          year: 2025,
          type: 'income',
        }
      );
      expect(
        (await read(api.household, expect, '/api/analytics/daily-heatmap?year=2025&type=expense'))
          .dates['2025-03-10']
      ).toBe(105.5);
      expect((await api.get('/api/analytics/daily-heatmap?type=expense')).status).toBe(400);

      // The year pickers: the years with transactions, newest first, and this year always.
      const thisYear = new Date().getUTCFullYear();
      expect(await read(api, expect, '/api/analytics/distinct-years')).toEqual({
        years: [thisYear, 2025],
      });
      expect(await read(api.other, expect, '/api/analytics/distinct-years')).toEqual({
        years: [thisYear, 2025, 2023],
      });
    }
  ),

  scenario("a month's budgets against its spending", async (api, expect) => {
    const food = await category(api, expect, 'Food', '#2e7d32');
    const rent = await category(api, expect, 'Rent', '#1565c0');
    const fun = await category(api, expect, 'Fun', '#8e24aa');
    // The Budgets page keeps one row per category and month.
    for (const [start, amount] of [
      ['2025-02-01', 90],
      ['2025-03-01', 100],
      ['2025-04-01', 110],
    ] as const) {
      await added(api, expect, '/api/budgets', {
        category_id: food,
        amount,
        period: 'monthly',
        start_date: start,
      });
    }
    await added(api, expect, '/api/budgets', {
      category_id: fun,
      amount: 50,
      period: 'monthly',
      start_date: '2025-03-01',
    });
    const spend = (description: string, amount: number, date: string, category_id: number) =>
      addTransaction(api, expect, { description, amount, date, category_id });
    await spend('Rent', 800, '2025-03-01', rent);
    await spend('Groceries', 45.5, '2025-03-10', food);
    await spend('Market', 35, '2025-03-22', food);
    await spend('Groceries in April', 99, '2025-04-02', food);
    await addTransaction(api, expect, { description: 'Cash', amount: 20, date: '2025-03-15' });
    const fuel = await category(api.other, expect, 'Fuel', '#6d4c41');
    await addTransaction(api.other, expect, {
      description: 'Fuel',
      amount: 60,
      date: '2025-03-10',
      category_id: fuel,
    });

    // March: Food has its March budget, Fun a budget and no spending, Rent spending and no
    // budget, which the flow counts as budgeted at what was spent.
    const flow = await read(api, expect, '/api/analytics/sankey?year=2025&month=3');
    // DIFFERENCE sankey-uncategorised
    const uncategorised = api.runtime === 'local';
    expect(sorted(flow)).toEqual(
      sorted({
        nodes: [
          { name: 'Total Budget', category: 'budget' },
          { name: 'Food', category: 'category', color: '#2e7d32' },
          { name: 'Fun', category: 'category', color: '#8e24aa' },
          { name: 'Rent', category: 'category', color: '#1565c0' },
          ...(uncategorised ? [{ name: 'Uncategorized', category: 'category' }] : []),
          { name: 'Total Actual', category: 'actual' },
          { name: 'Unused Budget', category: 'savings' },
        ],
        links: [
          link('Total Budget', 'Food', 100),
          link('Total Budget', 'Fun', 50),
          link('Total Budget', 'Rent', 800),
          link('Food', 'Total Actual', 80.5),
          link('Rent', 'Total Actual', 800),
          ...(uncategorised
            ? [link('Total Budget', 'Uncategorized', 20), link('Uncategorized', 'Total Actual', 20)]
            : []),
          link('Total Budget', 'Unused Budget', 69.5),
        ],
        hasBudgets: true,
      })
    );

    // No month asked for, or a month with nothing in it.
    expect(await read(api, expect, '/api/analytics/sankey?year=2025')).toEqual({
      nodes: [],
      links: [],
    });
    expect(await read(api, expect, '/api/analytics/sankey?year=2024&month=3')).toEqual({
      nodes: [],
      links: [],
      hasBudgets: false,
    });
  }),

  scenario('income and expense, month by month', async (api, expect) => {
    const lastMonth = monthStart(-1).slice(0, 7);
    const thisMonth = monthStart(0).slice(0, 7);
    const today = isoDay(new Date());
    const salary = await category(api, expect, 'Salary', '#f9a825', 'income');
    const food = await category(api, expect, 'Food', '#2e7d32');
    const entry = (description: string, amount: number, date: string, type = 'expense') =>
      addTransaction(api, expect, {
        description,
        amount,
        date,
        type,
        category_id: type === 'income' ? salary : food,
      });
    await entry('Salary', 2000, dayOf(-1, 10), 'income');
    await entry('Groceries', 150.25, dayOf(-1, 12));
    await entry('Salary', 2100, monthStart(0), 'income');
    await entry('Groceries', 40, monthStart(0));
    // Dated on the last day of this month: still ahead, unless today is that day.
    const later = monthEnd(0);
    await entry('Insurance', 60, later);
    await addTransaction(api.other, expect, {
      description: 'Their salary',
      amount: 1800,
      date: monthStart(0),
      type: 'income',
    });

    const stats = (await read(api, expect, '/api/stats/monthly?months=24')) as Json[];
    const month = (key: string) => stats.find((row) => row.month === key);
    expect(month(lastMonth)).toMatchObject({ income: 2000, expense: 150.25 });
    // DIFFERENCE analytics-month-to-date
    const counted = api.runtime === 'local' || later <= today;
    expect(month(thisMonth)).toMatchObject({ income: 2100, expense: counted ? 100 : 40 });

    // DIFFERENCE stats-monthly-shape
    if (api.runtime === 'worker') {
      expect(stats.map((row) => row.month)).toEqual([lastMonth, thisMonth]);
      expect(month(lastMonth).net).toBe(1849.75);
    } else {
      expect(stats).toHaveLength(24);
      expect(stats[23].month).toBe(thisMonth);
      expect(stats[0]).toEqual({ month: monthStart(-23).slice(0, 7), income: 0, expense: 0 });
    }

    // Both profiles selected: the other one's pay counts too.
    const both = (await read(api.household, expect, '/api/stats/monthly?months=24')) as Json[];
    expect(both.find((row) => row.month === thisMonth)).toMatchObject({ income: 3900 });
  }),
];
