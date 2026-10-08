import { addTransaction, dayOf, isoDay, monthEnd, monthStart } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account, accountBody } from './accounts';
import { billForm } from './bills';

async function category(
  api: ContractApi,
  expect: Expect,
  name: string,
  color: string,
  type = 'expense'
): Promise<number> {
  return added(api, expect, '/api/categories', { name, type, color, icon: 'tag' });
}

async function read(api: ContractApi, expect: Expect, path: string): Promise<Json> {
  const reply = await api.get(path);
  expectOk(expect, reply, `GET ${path}`);
  return reply.body;
}

/**
 * February and March 2025 of one profile, with an account of 1000: the pay and the rent each
 * month, and in March two Food days and one uncategorised expense. The other profile has an
 * account and a Fuel expense in March.
 */
async function februaryAndMarch(api: ContractApi, expect: Expect) {
  await account(api, expect, 'Everyday', 1000);
  const food = await category(api, expect, 'Food', '#2e7d32');
  const rent = await category(api, expect, 'Rent', '#1565c0');
  const salary = await category(api, expect, 'Salary', '#f9a825', 'income');
  const entry = (
    description: string,
    amount: number,
    date: string,
    category_id: number | null,
    type = 'expense'
  ) => addTransaction(api, expect, { description, amount, date, category_id, type });
  await entry('Rent', 700, '2025-02-01', rent);
  await entry('Salary', 2400, '2025-02-25', salary, 'income');
  await entry('Rent', 800, '2025-03-01', rent);
  await entry('Groceries', 45.5, '2025-03-10', food);
  await entry('Cash', 20, '2025-03-15', null);
  await entry('Market', 35, '2025-03-22', food);
  await entry('Salary', 2500, '2025-03-25', salary, 'income');

  await account(api.other, expect, 'Theirs', 5);
  const fuel = await category(api.other, expect, 'Fuel', '#6d4c41');
  await addTransaction(api.other, expect, {
    description: 'Fuel',
    amount: 60,
    date: '2025-03-10',
    category_id: fuel,
  });
  return { food, rent, salary };
}

/** A day `days` from today, as `YYYY-MM-DD`. */
function daysAhead(days: number): string {
  return isoDay(new Date(Date.now() + days * 86_400_000));
}

export const dashboard = [
  scenario('the dashboard of a month, of a range and of all time', async (api, expect) => {
    await februaryAndMarch(api, expect);
    await added(api, expect, '/api/bills', billForm({ name: 'Water', dueDate: daysAhead(5) }));
    await added(api, expect, '/api/bills', billForm({ name: 'Insurance', dueDate: daysAhead(60) }));

    // The Dashboard asks for its month as month and year, unpadded.
    const march = await read(api, expect, '/api/dashboard?month=3&year=2025');
    expect(march).toMatchObject({
      totalIncome: 2500,
      totalExpenses: 900.5,
      balance: 1000,
      incomeByCategory: [],
      // Against February.
      momIncomeDelta: 100,
      momExpenseDelta: 200.5,
      momBalanceDelta: -100.5,
    });
    expect(march.recentTransactions.map((t: Json) => t.description)).toEqual([
      'Salary',
      'Market',
      'Cash',
      'Groceries',
      'Rent',
    ]);
    // DIFFERENCE dashboard-uncategorised
    const none =
      api.runtime === 'worker'
        ? { category_name: null, category_color: null }
        : { category_name: 'Uncategorized', category_color: '#999' };
    expect(march.expenseByCategory).toEqual([
      { category_name: 'Rent', category_color: '#1565c0', total: 800 },
      { category_name: 'Food', category_color: '#2e7d32', total: 80.5 },
      { ...none, total: 20 },
    ]);
    expect(march.recentTransactions.map((t: Json) => t.category_name)).toEqual([
      'Salary',
      'Food',
      none.category_name,
      'Food',
      'Rent',
    ]);
    // DIFFERENCE dashboard-upcoming-bills
    expect(march.upcomingBills.map((b: Json) => b.name)).toEqual(
      api.runtime === 'worker' ? ['Water'] : []
    );

    // A range, and all time.
    expect(
      await read(api, expect, '/api/dashboard?date_from=2025-03-10&date_to=2025-03-22')
    ).toMatchObject({ totalIncome: 0, totalExpenses: 100.5 });
    expect(await read(api, expect, '/api/dashboard?all=true')).toMatchObject({
      totalIncome: 4900,
      totalExpenses: 1600.5,
    });

    // The other profile sees its own; both profiles selected, both.
    expect(await read(api.other, expect, '/api/dashboard?month=3&year=2025')).toMatchObject({
      totalIncome: 0,
      totalExpenses: 60,
      balance: 5,
    });
    expect(await read(api.household, expect, '/api/dashboard?month=3&year=2025')).toMatchObject({
      totalIncome: 2500,
      totalExpenses: 960.5,
      balance: 1005,
    });
    expect((await read(api.household, expect, '/api/dashboard/net-worth')).totalNetWorth).toBe(
      1005
    );
  }),

  scenario("the dashboard's charts, and the net worth month by month", async (api, expect) => {
    // The base currency is chosen before any money is entered; after that it is locked.
    expectOk(expect, await api.put('/api/settings', { currency: 'USD' }), 'PUT the currency');
    await added(api, expect, '/api/accounts', {
      ...accountBody('Everyday', 1000),
      currency: 'USD',
    });
    const food = await category(api, expect, 'Food', '#2e7d32');
    const rent = await category(api, expect, 'Rent', '#1565c0');
    const salary = await category(api, expect, 'Salary', '#f9a825', 'income');
    const entry = (
      description: string,
      amount: number,
      date: string,
      category_id: number | null,
      type = 'expense'
    ) =>
      addTransaction(api, expect, {
        description,
        amount,
        date,
        category_id,
        type,
        currency: 'USD',
      });
    await entry('Old groceries', 30, dayOf(-24, 10), food);
    await entry('Salary', 2000, dayOf(-2, 10), salary, 'income');
    await entry('Rent', 500, dayOf(-1, 10), rent);
    await entry('Cash', 20, dayOf(-1, 12), null);
    await entry('Groceries', 100, monthStart(0), food);
    // Dated on the last day of this month: still ahead, unless today is that day.
    const later = monthEnd(0);
    await entry('Insurance', 60, later, food);
    const ahead = later > isoDay(new Date());

    const month = (offset: number) => monthStart(offset).slice(0, 7);
    const charts = await read(api, expect, '/api/dashboard/charts?months=12');
    // The months with income or expense, up to today, and the running total.
    const thisMonth = ahead ? 100 : 160;
    const monthly = [
      { month: month(-2), income: 2000, expense: 0 },
      { month: month(-1), income: 0, expense: 520 },
      { month: month(0), income: 0, expense: thisMonth },
    ];
    const cumulative = [2000, 1480, 1480 - thisMonth];
    expect(charts.cashFlow).toEqual(
      monthly.map((row, i) => ({ ...row, cumulative: cumulative[i] }))
    );
    // DIFFERENCE dashboard-charts: the Worker's monthly rows carry the running total too.
    expect(charts.monthly).toEqual(api.runtime === 'worker' ? charts.cashFlow : monthly);
    // DIFFERENCE dashboard-charts
    if (api.runtime === 'worker') {
      expect(charts.byCategory).toEqual([
        { name: 'Rent', color: '#1565c0', icon: 'tag', total: 500, count: 1 },
        { name: 'Food', color: '#2e7d32', icon: 'tag', total: 190, count: 3 },
      ]);
      expect(charts.currency).toBe('EUR');
    } else {
      expect(charts.byCategory).toEqual([
        { name: 'Rent', color: '#1565c0', icon: 'tag', total: 500, count: 1 },
        { name: 'Food', color: '#2e7d32', icon: 'tag', total: thisMonth, count: ahead ? 1 : 2 },
        { name: 'Uncategorized', color: '#999', icon: null, total: 20, count: 1 },
      ]);
      expect(charts.currency).toBe('USD');
    }

    // Net worth: today's balances, walked back month by month through every transaction.
    const worth = await read(api, expect, '/api/dashboard/net-worth');
    expect(worth.totalNetWorth).toBe(1000);
    expect(worth.accounts).toEqual([
      expect.objectContaining({ name: 'Everyday', type: 'giro', currency: 'USD', balance: 1000 }),
    ]);
    expect(worth.timeline).toEqual([
      { month: month(-24), balance: -320, netChange: -30 },
      { month: month(-2), balance: 1680, netChange: 2000 },
      { month: month(-1), balance: 1160, netChange: -520 },
      { month: month(0), balance: 1000, netChange: -160 },
    ]);
  }),

  scenario('the summary of a month and of a year', async (api, expect) => {
    const { food } = await februaryAndMarch(api, expect);
    await addTransaction(api, expect, {
      description: 'Groceries in April',
      amount: 99,
      date: '2025-04-02',
      category_id: food,
    });

    const march = await read(api, expect, '/api/dashboard/summary?year=2025&month=3');
    expect(march).toMatchObject({
      summary: { income: 2500, expense: 900.5, transfer: 0, balance: 1599.5 },
      prevSummary: { income: 2400, expense: 700 },
      ytd: { income: 4900, expense: 1699.5, net: 3200.5 },
      month: '2025-03',
      currency: 'EUR',
    });
    expect(march.recent.map((t: Json) => t.description)).toEqual([
      'Salary',
      'Market',
      'Cash',
      'Groceries',
      'Rent',
    ]);

    expect(await read(api, expect, '/api/dashboard/summary?year=2025')).toMatchObject({
      summary: { income: 4900, expense: 1699.5, transfer: 0, balance: 3200.5 },
      prevSummary: { income: 0, expense: 0 },
      month: '2025',
    });
  }),
];
