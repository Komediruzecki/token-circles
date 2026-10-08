import { addCategory, listTransactions } from '../helpers';
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
