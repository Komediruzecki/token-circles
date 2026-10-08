import { addCategory, balanceOf, expectMoney, listTransactions } from '../helpers';
import { SHEETS } from '../outbound';
import { expectOk, scenario } from '../types';
import type { ContractApi, Expect, Json } from '../types';
import { account } from './accounts';

/** Columns of the sheet the scenarios import, as the mapping step numbers them. */
const MAPPING = { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 };

/** A statement as the mapping step hands it on: the header is gone, the cells are text. */
const STATEMENT = [
  ['2026-03-01', 'Salary', '2500', 'Salary', 'Everyday', 'income'],
  ['2026-03-02', 'Groceries', '-45.50', 'Food', 'Everyday', 'expense'],
  ['2026-03-03', 'Cinema', '-12', 'Fun', 'Everyday', 'expense'],
  ['2026-03-04', 'To savings', '100', 'Savings', 'Everyday', 'transfer'],
];

/** The body the Import page's execute step posts (features/import/importFlow.ts). */
function executeBody(fields: Record<string, unknown> = {}) {
  return {
    rows: STATEMENT,
    mapping: MAPPING,
    categoryTypes: { Salary: 'income', Fun: 'expense', Savings: 'account' },
    accountTypes: { Savings: 'savings' },
    accountBalances: { Savings: '200' },
    accountBalanceDates: { Savings: '2026-03-01' },
    defaultCurrency: 'EUR',
    ...fields,
  };
}

async function execute(api: ContractApi, expect: Expect, fields: Record<string, unknown> = {}) {
  const reply = await api.post('/api/import/execute', executeBody(fields));
  expectOk(expect, reply, 'POST /api/import/execute');
  return reply.body;
}

async function accountNamed(api: ContractApi, expect: Expect, name: string): Promise<Json> {
  const reply = await api.get('/api/accounts');
  expectOk(expect, reply, 'GET /api/accounts');
  return (reply.body as Json[]).find((a) => a.name === name);
}

async function categoryNames(api: ContractApi, expect: Expect): Promise<string[]> {
  const reply = await api.get('/api/categories');
  expectOk(expect, reply, 'GET /api/categories');
  return (reply.body as Json[]).map((c) => c.name as string);
}

export const imports = [
  scenario('an import previews what it would create, and writes nothing', async (api, expect) => {
    await account(api, expect, 'Everyday', 1000);
    await addCategory(api, expect, 'Food');

    const preview = await execute(api, expect, { dry_run: true });
    expect(preview).toMatchObject({
      dry_run: true,
      imported: 4,
      skipped: 0,
      duplicates: 0,
      accounts_created: 0,
      categories_created: 0,
      created_accounts: [],
      created_categories: [],
    });
    expect([...preview.new_categories].sort()).toEqual(['Fun', 'Salary']);
    // The transfer's destination is an account the run would create, not one already there.
    expect(preview.new_accounts).toEqual(['Savings']);

    expect(await listTransactions(api, expect)).toEqual([]);
    expect(await accountNamed(api, expect, 'Savings')).toBeUndefined();
    const names = await categoryNames(api, expect);
    expect(names).toContain('Food');
    expect(names).not.toContain('Fun');
    expect(names).not.toContain('Salary');
  }),

  scenario(
    'an import creates the accounts and categories its rows name, and moves the balances',
    async (api, expect) => {
      const everyday = await account(api, expect, 'Everyday', 1000);
      const food = await addCategory(api, expect, 'Food');

      // The run, with the categories the preview offered confirmed.
      const ran = await execute(api, expect, {
        importId: 'contract-import-1',
        approvedCategories: ['Salary', 'Fun'],
      });
      expect(ran).toMatchObject({
        imported: 4,
        skipped: 0,
        duplicates: 0,
        accounts_created: 1,
        categories_created: 2,
        // As the sheet spells it: the import log and the page's summary list these names.
        created_accounts: ['Savings'],
      });
      expect([...ran.created_categories].sort()).toEqual(['Fun', 'Salary']);

      const rows = await listTransactions(api, expect);
      expect(rows).toHaveLength(4);
      const byDescription = Object.fromEntries(rows.map((r) => [r.description, r]));
      expect(byDescription.Salary).toMatchObject({ type: 'income', account_id: everyday });
      expect(byDescription.Groceries).toMatchObject({
        type: 'expense',
        category_id: food,
        account_id: everyday,
        date: '2026-03-02',
      });
      expectMoney(expect, byDescription.Groceries.amount, 45.5, 'groceries');
      const savings = await accountNamed(api, expect, 'Savings');
      expect(savings).toMatchObject({ type: 'savings', currency: 'EUR' });
      expect(byDescription['To savings']).toMatchObject({
        type: 'transfer',
        account_id: everyday,
        transfer_account_id: savings.id,
      });
      // 1,000 + 2,500 - 45.50 - 12 - 100, and the new account's 200 + 100.
      expectMoney(expect, await balanceOf(api, expect, everyday), 3342.5, 'Everyday');
      expectMoney(expect, await balanceOf(api, expect, savings.id), 300, 'Savings');
      const names = await categoryNames(api, expect);
      expect(names).toEqual(expect.arrayContaining(['Food', 'Fun', 'Salary']));
    }
  ),

  scenario('a shared Google Sheet is read for the mapping step', async (api, expect) => {
    // The Import page's Google Sheets tab sends the link and the tab it last chose.
    const reply = await api.post('/api/import/googlesheet', {
      url: 'https://docs.google.com/spreadsheets/d/contract-sheet/edit#gid=0',
      sheetName: '',
    });
    expectOk(expect, reply, 'POST /api/import/googlesheet');
    expect(reply.body).toMatchObject({
      headers: ['Date', 'Description', 'Amount', 'Category'],
      rows: [
        ['2026-03-01', 'Salary', '2500', 'Salary'],
        ['2026-03-02', 'Groceries', '-45.50', 'Food'],
      ],
      sheetNames: ['Sheet1'],
      selectedSheet: 'Sheet1',
    });
    expect(SHEETS['contract-sheet']).toContain('Groceries');

    expect(
      (await api.post('/api/import/googlesheet', { url: 'https://example.com/not-a-sheet' })).status
    ).toBe(400);
  }),

  scenario('a spreadsheet file is uploaded for the mapping step', async (api, expect) => {
    // The Import page's file tab posts the file as a form (handleFileUpload).
    const form = new FormData();
    form.append(
      'file',
      new File(
        ['Date,Description,Amount\n2026-03-01,Salary,2500\n2026-03-02,Groceries,-45.50\n'],
        'statement.csv',
        { type: 'text/csv' }
      )
    );
    const reply = await api.post('/api/import/upload', form);
    expectOk(expect, reply, 'POST /api/import/upload');
    // DIFFERENCE import-upload-answer
    if (api.runtime === 'worker') {
      expect(reply.body).toEqual({
        headers: ['Date', 'Description', 'Amount'],
        rows: [
          ['2026-03-01', 'Salary', '2500'],
          ['2026-03-02', 'Groceries', '-45.50'],
        ],
        selectedSheet: 'CSV',
        sheetNames: ['CSV'],
      });
    } else {
      expect(reply.body).toMatchObject({ filename: 'statement.csv', row_count: 2 });
      expect(reply.body.sheetNames).toBeUndefined();
      expect(reply.body.rows[0]).toMatchObject({ description: 'Salary' });
    }
  }),
];
