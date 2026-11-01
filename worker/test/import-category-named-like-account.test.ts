/**
 * The import's Category column names a category, and on a Transfer row the account the money went
 * to. A row that names the account that paid it (Means of Payment) books from that account, and
 * its Category is its category.
 *
 * executeImport read Category as an account on every row: the account map is seeded with the
 * profile's accounts, so an expense categorised "Vacation" and paid from Checking, on a profile
 * with an account "Vacation", was stored with a stray transfer_account_id (Vacation) and no
 * category. A row with no Means of Payment still resolves as it did; which rule it should follow
 * is a separate decision. Every Worker import path (the Import page, v1, sheet sync, email, MCP)
 * shares executeImport. The local-first mirror is
 * frontend/src/core/storage/__tests__/importFlow.categoryNamedLikeAccount.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { markedAccountUsedAsCategoryNote } from '../../shared/importRowChecks';
import { sessionCookie } from './helpers/session';

const PROFILE = 980;
let cookie = '';
let checking = 0;
let vacation = 0;

beforeEach(async () => {
  for (const table of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (98, 'catacct@example.com', 'password', 1)"
    ),
    env.DB.prepare(`INSERT INTO profiles (id, user_id, name) VALUES (${PROFILE}, 98, 'Main')`),
  ]);
  const insert = (name: string, type: string) =>
    env.DB.prepare(
      'INSERT INTO accounts (name, type, currency, balance, starting_balance, profile_id) VALUES (?, ?, ?, 0, 0, ?) RETURNING id'
    )
      .bind(name, type, 'EUR', PROFILE)
      .first<{ id: number }>();
  checking = (await insert('Checking', 'giro'))!.id;
  vacation = (await insert('Vacation', 'savings'))!.id;
  cookie = (await sessionCookie(98, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

const MAPPING = { date: 0, description: 1, amount: 2, category: 3, means_of_payment: 4, type: 5 };

type Stored = {
  type: string;
  account_id: number | null;
  transfer_account_id: number | null;
  category: string | null;
};

async function onlyTransaction(): Promise<Stored> {
  const rows = await env.DB.prepare(
    `SELECT t.type, t.account_id, t.transfer_account_id, c.name AS category
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.profile_id = ?`
  )
    .bind(PROFILE)
    .all<Stored>();
  expect(rows.results).toHaveLength(1);
  return rows.results[0]!;
}

async function balanceOf(name: string): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE name = ? AND profile_id = ?')
    .bind(name, PROFILE)
    .first<{ balance: number }>();
  return row?.balance;
}

async function accountNames(): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT name FROM accounts WHERE profile_id = ? ORDER BY name')
    .bind(PROFILE)
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

async function balance(id: number): Promise<number> {
  const row = await env.DB.prepare('SELECT balance FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ balance: number }>();
  return row!.balance;
}

describe('a category named like an account, in the Worker import', () => {
  it('stores an expense in that category, against the account it was paid from', async () => {
    const res = await execute({
      rows: [['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense']],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'expense', Checking: 'account' },
    });
    expect(((await res.json()) as { imported: number }).imported).toBe(1);

    expect(await onlyTransaction()).toEqual({
      type: 'expense',
      account_id: checking,
      transfer_account_id: null,
      category: 'Vacation',
    });
    expect(await balance(checking)).toBe(-80);
    expect(await balance(vacation)).toBe(0);
  });

  it('books a row whose category is set to Account from its Means of Payment, and notes it once', async () => {
    const res = await execute({
      rows: [['2026-01-12', 'Monthly deposit', '500', 'IB', 'Checking', 'Expense']],
      mapping: MAPPING,
      categoryTypes: { IB: 'account', Checking: 'account' },
    });
    const body = (await res.json()) as { warnings: Array<{ index?: number; reason: string }> };

    expect(await onlyTransaction()).toEqual({
      type: 'expense',
      account_id: checking,
      transfer_account_id: null,
      category: 'IB',
    });
    expect(await balance(checking)).toBe(-500);
    // No row uses IB as an account, so none is made beside the category.
    expect(await accountNames()).toEqual(['Checking', 'Vacation']);
    expect(body.warnings).toEqual([
      {
        reason: markedAccountUsedAsCategoryNote({
          name: 'IB',
          rows: 1,
          paidFrom: ['Checking'],
          notAccounts: [],
          preview: false,
          categorised: true,
          types: ['expense'],
        }),
      },
    ]);
    const category = await env.DB.prepare('SELECT type FROM categories WHERE name = ?')
      .bind('IB')
      .first<{ type: string }>();
    expect(category?.type).toBe('expense');
  });

  it('makes categories, not accounts, of names set to Account that only rows paid from Checking use', async () => {
    // The mapping step sets these to Account: classifyCategory reads "ib" in Library, "saving",
    // "invest" and "rev" as account names.
    const REAL = [
      ['2026-03-01', 'Late fee', '12', 'Library'],
      ['2026-03-02', 'Supermarket', '40', 'Groceries'],
      ['2026-03-03', 'Book sale', '8', 'Library'],
      ['2026-03-04', 'Put aside', '200', 'Savings'],
      ['2026-03-05', 'ETF buy', '500', 'Investments'],
      ['2026-03-06', 'Supermarket', '35', 'Groceries'],
      ['2026-03-07', 'Membership', '15', 'Library'],
      ['2026-03-08', 'Magazine', '6', 'Review'],
      ['2026-03-09', 'Supermarket', '22', 'Groceries'],
      ['2026-03-10', 'Put aside', '200', 'Savings'],
    ];
    const rows = REAL.map(([d, s, a, c]) => [d, s, '-' + a, c, 'Checking', 'Expense']);
    const categoryTypes = {
      Library: 'account',
      Savings: 'account',
      Investments: 'account',
      Review: 'account',
      Groceries: 'expense',
      Checking: 'account',
    };
    const preview = (await (
      await execute({ rows, mapping: MAPPING, categoryTypes, dryRun: true })
    ).json()) as {
      new_categories: string[];
      new_accounts: string[];
      warnings: Array<{ reason: string }>;
    };
    expect(preview.new_accounts).toEqual([]);
    expect([...preview.new_categories].sort()).toEqual([
      'Groceries',
      'Investments',
      'Library',
      'Review',
      'Savings',
    ]);

    const body = (await (
      await execute({
        rows,
        mapping: MAPPING,
        categoryTypes,
        approvedCategories: preview.new_categories,
      })
    ).json()) as { imported: number; warnings: Array<{ reason: string }> };
    expect(body.imported).toBe(10);
    expect(await accountNames()).toEqual(['Checking', 'Vacation']);
    expect(await balance(checking)).toBe(-1038);
    const note = (name: string, rows: number, preview: boolean) =>
      markedAccountUsedAsCategoryNote({
        name,
        rows,
        paidFrom: ['Checking'],
        notAccounts: [],
        // The preview's copy says to change the rows before importing, not to undo the import.
        preview,
        categorised: true,
        types: ['expense'],
      });
    expect(preview.warnings.map((w) => w.reason)).toEqual([
      note('Library', 3, true),
      note('Savings', 2, true),
      note('Investments', 1, true),
      note('Review', 1, true),
    ]);
    expect(body.warnings.map((w) => w.reason)).toEqual([
      note('Library', 3, false),
      note('Savings', 2, false),
      note('Investments', 1, false),
      note('Review', 1, false),
    ]);
  });

  it('books an opening deposit with no Means of Payment into the Savings account', async () => {
    await execute({
      rows: [['2026-01-02', 'Opening deposit', '200', 'Savings', '', 'Income']],
      mapping: MAPPING,
      categoryTypes: { Savings: 'account' },
    });
    expect(await balanceOf('Savings')).toBe(200);
  });

  it('stores rows with no Means of Payment as before: no account, the category account as transfer_account_id', async () => {
    // Unchanged here; which rule these rows should follow is a separate decision.
    await execute({
      rows: [
        ['2026-03-01', 'Deposit', '1000', 'IB', '', ''],
        ['2026-03-20', 'Fee', '-5', 'IB', '', ''],
        ['2026-03-21', 'Deposit2', '500', 'IB', '', 'Expense'],
        ['2026-03-22', 'Late fee', '12', 'Library', '', 'expense'],
      ],
      mapping: MAPPING,
      categoryTypes: { IB: 'account', Library: 'account' },
    });

    const rows = await env.DB.prepare(
      `SELECT t.description, t.type, t.account_id, d.name AS destination, t.category_id
         FROM transactions t LEFT JOIN accounts d ON d.id = t.transfer_account_id
        WHERE t.profile_id = ? ORDER BY t.date`
    )
      .bind(PROFILE)
      .all();
    expect(rows.results).toEqual([
      {
        description: 'Deposit',
        type: 'income',
        account_id: null,
        destination: 'IB',
        category_id: null,
      },
      {
        description: 'Fee',
        type: 'expense',
        account_id: null,
        destination: 'IB',
        category_id: null,
      },
      {
        description: 'Deposit2',
        type: 'expense',
        account_id: null,
        destination: 'IB',
        category_id: null,
      },
      {
        description: 'Late fee',
        type: 'expense',
        account_id: null,
        destination: 'Library',
        category_id: null,
      },
    ]);
  });

  it('notes a Means of Payment that names no account as such, not as the account paid from', async () => {
    const body = (await (
      await execute({
        rows: [['2026-01-12', 'Put aside', '-200', 'Savings', 'Cash', 'Expense']],
        mapping: MAPPING,
        categoryTypes: { Savings: 'account' },
      })
    ).json()) as { warnings: Array<{ index?: number; reason: string }> };

    expect(await onlyTransaction()).toEqual({
      type: 'expense',
      account_id: null,
      transfer_account_id: null,
      category: 'Savings',
    });
    expect(body.warnings).toEqual([
      {
        reason: markedAccountUsedAsCategoryNote({
          name: 'Savings',
          rows: 1,
          paidFrom: [],
          notAccounts: ['Cash'],
          preview: false,
          categorised: true,
          types: ['expense'],
        }),
      },
    ]);
  });

  it('keeps the category of a row paid from an account when the same name is also a transfer target', async () => {
    const rows = [
      ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
      ['2026-01-13', 'Save', '200', 'Vacation', 'Checking', 'Transfer'],
    ];
    const categoryTypes = { Vacation: 'account', Checking: 'account' };
    const preview = await execute({ rows, mapping: MAPPING, categoryTypes, dryRun: true });
    expect(((await preview.json()) as { new_categories: string[] }).new_categories).toEqual([
      'Vacation',
    ]);
    await execute({ rows, mapping: MAPPING, categoryTypes, approvedCategories: ['Vacation'] });

    const expense = await env.DB.prepare(
      `SELECT c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.profile_id = ? AND t.type = 'expense'`
    )
      .bind(PROFILE)
      .first<{ category: string | null }>();
    expect(expense?.category).toBe('Vacation');
    expect(await balance(checking)).toBe(-280);
    expect(await balance(vacation)).toBe(200);
  });

  it('counts a row an earlier import credited through its category as a duplicate', async () => {
    const ib = (await env.DB.prepare(
      "INSERT INTO accounts (name, type, currency, balance, starting_balance, profile_id) VALUES ('IB', 'ib', 'EUR', 0, 0, ?) RETURNING id"
    )
      .bind(PROFILE)
      .first<{ id: number }>())!.id;
    // As the import stored it before: no account, the category's account as transfer_account_id.
    await env.DB.prepare(
      `INSERT INTO transactions (description, amount, date, type, currency, amount_local, profile_id, account_id, transfer_account_id)
       VALUES ('Deposit', 1000, '2026-03-01', 'income', 'EUR', 1000, ?, NULL, ?)`
    )
      .bind(PROFILE, ib)
      .run();

    const res = await execute({
      rows: [['2026-03-01', 'Deposit', '1000', 'IB', '', 'Income']],
      mapping: MAPPING,
      categoryTypes: { IB: 'account' },
    });
    expect(await res.json()).toMatchObject({ imported: 0, duplicates: 1 });
  });

  it("still reads a Transfer row's category as the account the money went to", async () => {
    await execute({
      rows: [['2026-01-13', 'Save', '100', 'Vacation', 'Checking', 'Transfer']],
      mapping: MAPPING,
      categoryTypes: { Checking: 'account' },
    });

    expect(await onlyTransaction()).toMatchObject({
      type: 'transfer',
      account_id: checking,
      transfer_account_id: vacation,
    });
    expect(await balance(checking)).toBe(-100);
    expect(await balance(vacation)).toBe(100);
  });

  it('offers the category as new in the preview, and a transfer destination as an account', async () => {
    const res = await execute({
      rows: [
        ['2026-01-10', 'Travel Agent', '-80', 'Vacation', 'Checking', 'Expense'],
        ['2026-01-13', 'Save', '100', 'Savings', 'Checking', 'Transfer'],
      ],
      mapping: MAPPING,
      categoryTypes: { Vacation: 'expense', Checking: 'account' },
      dryRun: true,
    });
    const body = (await res.json()) as { new_categories: string[]; new_accounts: string[] };
    expect(body.new_categories).toEqual(['Vacation']);
    expect(body.new_accounts).toEqual(['Savings']);
  });
});
