import { addTransaction } from '../helpers';
import { added, expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';

/**
 * 2025 of one profile: two Office expenses (a tax-deductible category), a Food one, an
 * uncategorised one and the pay; one Food expense the year before. The other profile spends on
 * Food in 2025 too.
 */
async function year2025(api: ContractApi, expect: Expect) {
  const category = (name: string, type: string, tax_deductible: boolean) =>
    added(api, expect, '/api/categories', {
      name,
      type,
      color: '#455a64',
      icon: 'tag',
      tax_deductible,
    });
  const office = await category('Office', 'expense', true);
  const food = await category('Food', 'expense', false);
  const salary = await category('Salary', 'income', false);
  const entry = (
    description: string,
    amount: number,
    date: string,
    category_id: number | null,
    type = 'expense'
  ) => addTransaction(api, expect, { description, amount, date, category_id, type });
  await entry('Groceries', 10, '2024-12-31', food);
  await entry('Printer', 120, '2025-02-10', office);
  await entry('Groceries', 45.5, '2025-03-10', food);
  await entry('Cash', 20, '2025-03-15', null);
  await entry('Salary', 2500, '2025-03-25', salary, 'income');
  await entry('Paper', 30.5, '2025-05-01', office);
  await addTransaction(api.other, expect, {
    description: 'Groceries',
    amount: 99,
    date: '2025-04-01',
  });
  return { office, food, salary };
}

async function read(api: ContractApi, expect: Expect, path: string): Promise<Json> {
  const reply = await api.get(path);
  expectOk(expect, reply, `GET ${path}`);
  return reply.body;
}

export const reports = [
  scenario("a year's tax and profit-and-loss summaries", async (api, expect) => {
    await year2025(api, expect);
    const tax = await read(api, expect, '/api/reports/tax-summary?year=2025');
    const pl = await read(api, expect, '/api/reports/pl-summary?year=2025');

    // DIFFERENCE year-summaries
    if (api.runtime === 'worker') {
      expect(tax).toEqual({
        year: 2025,
        taxDeductibleTotal: 150.5,
        nonDeductibleTotal: 45.5,
        totalExpenses: 196,
        taxDeductibleCategories: {
          Office: {
            total: 150.5,
            transactions: [
              expect.objectContaining({ date: '2025-02-10', description: 'Printer', amount: 120 }),
              expect.objectContaining({ date: '2025-05-01', description: 'Paper', amount: 30.5 }),
            ],
          },
        },
        nonDeductibleCategories: {
          Food: {
            total: 45.5,
            transactions: [expect.objectContaining({ date: '2025-03-10', amount: 45.5 })],
          },
        },
        transactionCount: 3,
      });
      expect(pl).toEqual({
        year: 2025,
        income: { total: 2500, byCategory: { Salary: { total: 2500, count: 1 } } },
        expenses: {
          total: 196,
          byCategory: { Office: { total: 150.5, count: 2 }, Food: { total: 45.5, count: 1 } },
        },
        netSavings: 2304,
        savingsRate: 92.2,
        transactionCount: 4,
      });
    } else {
      expect(tax).toEqual({
        year: 2025,
        taxDeductibleTotal: 150.5,
        nonDeductibleTotal: 65.5,
        totalExpenses: 216,
        taxDeductibleCategories: { Office: { total: 150.5, transactions: [] } },
        nonDeductibleCategories: {
          Food: { total: 45.5, transactions: [] },
          Unknown: { total: 20, transactions: [] },
        },
        transactionCount: 4,
      });
      expect(pl).toEqual({
        year: 2025,
        income: { total: 2500, byCategory: { Salary: { total: 2500, count: 1 } } },
        expenses: {
          total: 216,
          byCategory: {
            Office: { total: 150.5, count: 2 },
            Food: { total: 45.5, count: 1 },
            Unknown: { total: 20, count: 1 },
          },
        },
        netSavings: 2284,
        savingsRate: 91.4,
        transactionCount: 5,
      });
    }

    // A year is required.
    expect((await api.get('/api/reports/tax-summary')).status).toBe(400);
    expect((await api.get('/api/reports/pl-summary')).status).toBe(400);
    // The other profile's year is its own: one uncategorised expense.
    // DIFFERENCE year-summaries
    expect(
      (await read(api.other, expect, '/api/reports/pl-summary?year=2025')).transactionCount
    ).toBe(api.runtime === 'worker' ? 0 : 1);
  }),

  scenario('the reports as PDF files', async (api, expect) => {
    await year2025(api, expect);
    const pdf = async (path: string) => {
      const reply = await api.get(path);
      expectOk(expect, reply, `GET ${path}`);
      expect(reply.type, `GET ${path} answers a PDF`).toBe('application/pdf');
    };
    // DIFFERENCE monthly-pdf-month
    if (api.runtime === 'worker') {
      await pdf('/api/reports/monthly-pdf?month=2025-03');
    } else {
      await pdf('/api/reports/monthly-pdf?year=2025&month=3');
    }
    await pdf('/api/reports/annual-pdf?year=2025');
    await pdf('/api/reports/tax-summary-pdf?year=2025');
    await pdf('/api/reports/pl-summary-pdf?year=2025');
  }),

  scenario('a custom report', async (api, expect) => {
    const { food } = await year2025(api, expect);
    const body = {
      name: 'Q1 groceries',
      type: 'custom',
      date_from: '2025-01-01',
      date_to: '2025-03-31',
      category_id: food,
    };
    const reply = await api.post('/api/reports/custom', body);
    expectOk(expect, reply, 'POST /api/reports/custom');
    expect(reply.body).toMatchObject({
      reportId: expect.any(Number),
      name: 'Q1 groceries',
      type: 'custom',
      createdAt: expect.any(String),
    });
    // DIFFERENCE custom-report
    if (api.runtime === 'worker') {
      expect(reply.body).toMatchObject({
        id: reply.body.reportId,
        date_from: '2025-01-01',
        date_to: '2025-03-31',
        category_id: food,
      });
    } else {
      expect(reply.body).toMatchObject({
        summary: { totalIncome: 0, totalExpenses: 45.5, netTotal: -45.5, transactionCount: 1 },
        byCategory: { Food: { count: 1, total: 45.5 } },
      });
    }
  }),
];
