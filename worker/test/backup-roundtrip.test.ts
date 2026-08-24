import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import type { BackupData } from '../src/backup';

const USER_ID = 200;
const OTHER_USER_ID = 201;
let cookie = '';

const DATA_TABLES = [
  'transaction_tags',
  'loan_rate_periods',
  'loan_prepayments',
  'account_balance_history',
  'receipts',
  'category_mappings',
  'import_logs',
  'recurring_transactions',
  'bills',
  'housings',
  'budgets_zero_based',
  'budgets',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'portfolio_holdings',
  'transactions',
  'tag_rules',
  'tags',
  'loans',
  'categories',
  'accounts',
  'settings',
  'custom_reports',
  'profiles',
  'rate_limits',
  'users',
] as const;

async function clearReceiptBucket(): Promise<void> {
  const bucket = env.RECEIPTS;
  if (!bucket) return;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ cursor });
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

beforeEach(async () => {
  for (const table of DATA_TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await clearReceiptBucket();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'backup@example.com', 'password', 1)"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'other@example.com', 'password', 1)"
    ).bind(OTHER_USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id, created_at) VALUES (2000, 'Home', ?, '2026-01-01')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id, created_at) VALUES (2001, 'Joint', ?, '2026-01-02')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id, created_at) VALUES (2002, 'Excluded', ?, '2026-01-03')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, name, user_id, created_at) VALUES (2010, 'Other user', ?, '2026-01-04')"
    ).bind(OTHER_USER_ID),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO categories (id, name, type, color, profile_id) VALUES (2100, 'Food', 'expense', '#f00', 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, name, type, color, parent_id, profile_id) VALUES (2101, 'Dining', 'expense', '#f10', 2100, 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO categories (id, name, type, color, profile_id) VALUES (2110, 'Other category', 'expense', '#000', 2010)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, currency, balance, starting_balance, profile_id) VALUES (2200, 'Checking', 'EUR', 900, 1000, 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, currency, balance, starting_balance, profile_id) VALUES (2201, 'Joint cash', 'EUR', 500, 500, 2001)"
    ),
    env.DB.prepare(
      "INSERT INTO accounts (id, name, currency, balance, starting_balance, profile_id) VALUES (2210, 'Other account', 'EUR', 1, 1, 2010)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (id, description, amount, amount_local, date, type, currency, category_id, account_id, receipt_id, profile_id) VALUES (2300, 'Groceries', 100, 100, '2026-01-03', 'expense', 'EUR', 2100, 2200, 3100, 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (id, description, amount, amount_local, date, type, currency, account_id, profile_id) VALUES (2301, 'Joint income', 50, 50, '2026-01-04', 'income', 'EUR', 2201, 2001)"
    ),
    env.DB.prepare(
      "INSERT INTO transactions (id, description, amount, date, type, currency, account_id, profile_id) VALUES (2310, 'Other tx', 1, '2026-01-05', 'expense', 'EUR', 2210, 2010)"
    ),
    env.DB.prepare(
      "INSERT INTO budgets (id, category_id, amount, period, start_date, profile_id) VALUES (2400, 2100, 500, 'monthly', '2026-01-01', 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO budgets_zero_based (id, profile_id, category_id, amount, month) VALUES (2401, 2000, 2100, 450, '2026-01')"
    ),
    env.DB.prepare(
      "INSERT INTO savings_goals (id, name, target_amount, current_amount, category_id, profile_id) VALUES (2500, 'Reserve', 10000, 1000, 2100, 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO retirement_goals (id, name, target_amount, current_amount, profile_id) VALUES (2501, 'Retire', 500000, 20000, 2000)"
    ),
    env.DB.prepare(
      'INSERT INTO emergency_fund_config (id, monthly_expenses, profile_id) VALUES (2502, 1500, 2000)'
    ),
    env.DB.prepare(
      "INSERT INTO loans (id, name, principal, interest_rate, start_date, term_months, profile_id) VALUES (2600, 'Mortgage', 100000, 3, '2025-01-01', 240, 2000)"
    ),
    env.DB.prepare(
      'INSERT INTO loan_rate_periods (id, loan_id, rate, start_month, end_month) VALUES (2601, 2600, 3, 1, 12)'
    ),
    env.DB.prepare(
      "INSERT INTO loan_prepayments (id, loan_id, month, amount, note) VALUES (2602, 2600, 2, 1000, 'Extra')"
    ),
    env.DB.prepare(
      "INSERT INTO account_balance_history (id, account_id, balance, recorded_at) VALUES (2700, 2200, 900, '2026-01-03')"
    ),
    env.DB.prepare(
      "INSERT INTO recurring_transactions (id, profile_id, description, amount, type, category_id, account_id, frequency) VALUES (2800, 2000, 'Recurring', 25, 'expense', 2100, 2200, 'monthly')"
    ),
    env.DB.prepare(
      "INSERT INTO bills (id, profile_id, name, amount, category_id, account_id, due_date) VALUES (2801, 2000, 'Power', 60, 2100, 2200, '2026-02-01')"
    ),
    env.DB.prepare(
      "INSERT INTO housings (id, profile_id, name, monthly_amount, due_date) VALUES (2802, 2000, 'Apartment', 600, '2026-02-01')"
    ),
    env.DB.prepare("INSERT INTO tags (id, name, profile_id) VALUES (2900, 'essential', 2000)"),
    env.DB.prepare('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (2300, 2900)'),
    env.DB.prepare(
      `INSERT INTO tag_rules (id, profile_id, tag_id, name, criteria, auto_apply)
       VALUES (2950, 2000, 2900, 'Essentials', '{"description":"market","match":"all"}', 1)`
    ),
    env.DB.prepare(
      "INSERT INTO category_mappings (id, profile_id, pattern, category_id, confidence) VALUES (3000, 2000, 'MARKET', 2100, 1)"
    ),
    env.DB.prepare(
      "INSERT INTO receipts (id, transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id) VALUES (3100, 2300, '2000/receipt.png', 'receipt.png', 'image/png', 4, '2000/receipt.png', 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO portfolio_holdings (id, ticker, shares, purchase_price, purchase_date, profile_id) VALUES (3200, 'VWCE', 3, 100, '2026-01-01', 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO import_logs (id, profile_id, import_id, source, imported) VALUES (3300, 2000, 'batch-1', 'sheet', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO custom_reports (id, user_id, name, config) VALUES (3400, ?, 'Tax', '{\"year\":2026}')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO custom_reports (id, user_id, name, config) VALUES (3410, ?, 'Other report', '{}')"
    ).bind(OTHER_USER_ID),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'EUR', 2000)"
    ),
    env.DB.prepare(
      "INSERT INTO settings (key, value, profile_id) VALUES ('currency', 'CHF', 2001)"
    ),
  ]);
  await env.RECEIPTS!.put('2000/receipt.png', new Uint8Array([1, 2, 3, 4]), {
    httpMetadata: { contentType: 'image/png' },
  });
  cookie = (await issueSessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      'X-Profile-Id': '2000',
      'X-Profile-Ids': JSON.stringify([2000, 2001]),
      ...(init.headers || {}),
    },
  });
}

/**
 * Note the request below still sends `X-Profile-Ids: [2000, 2001]`, deliberately: the point is
 * that the full backup ignores it. "Excluded" (2002) is in every one of these files.
 */
async function exportAccount(): Promise<BackupData> {
  const response = await request('/api/export');
  expect(response.status).toBe(200);
  return response.json<BackupData>();
}

describe('Worker full backup and staged restore', () => {
  it('exports every financial domain, scoped settings, relations, and receipt bytes', async () => {
    const backup = await exportAccount();
    expect(backup.version).toBe('3.0.0');
    expect(backup.profiles.map((profile) => profile.name)).toEqual(['Home', 'Joint', 'Excluded']);

    for (const key of [
      'categories',
      'transactions',
      'accounts',
      'budgets',
      'budgetsZeroBased',
      'goals',
      'retirementGoals',
      'emergencyFundConfig',
      'loans',
      'loanRatePeriods',
      'loanPrepayments',
      'portfolioHoldings',
      'bills',
      'recurring',
      'housings',
      'tags',
      'tagRules',
      'transactionTags',
      'categoryMappings',
      'receipts',
      'receiptFiles',
      'balanceHistoryRows',
      'importLogs',
      'customReports',
      'settingsRows',
    ] as const) {
      expect(backup[key].length, key).toBeGreaterThan(0);
    }

    expect(backup.settingsRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile_id: 2000, key: 'currency', value: 'EUR' }),
        expect.objectContaining({ profile_id: 2001, key: 'currency', value: 'CHF' }),
      ])
    );
    expect(backup.customReports).toHaveLength(1);
    expect(backup.receiptFiles[0]).toMatchObject({
      receipt_id: 3100,
      content_type: 'image/png',
      data_base64: 'AQIDBA==',
    });
    expect(backup.transactions.some((transaction) => Number(transaction.profile_id) === 2010)).toBe(
      false
    );
  });

  it('covers the whole account, not the profiles the caller happens to have selected', async () => {
    // The request sends X-Profile-Ids: [2000, 2001]. A restore deletes every profile the user
    // owns, so a backup that honoured that selection would delete "Excluded" on the way back in.
    const backup = await exportAccount();

    expect(backup.profiles.map((profile) => profile.id)).toEqual([2000, 2001, 2002]);
  });

  it('refuses to hand back an empty file to an account with no profiles', async () => {
    // A backup of nothing is not a backup, and restoring one would delete everything it does not
    // contain. Say so instead of handing over a file that looks like a safety net.
    await env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (299, 'empty@example.com', 'password', 1)"
    ).run();
    const emptyCookie = (await issueSessionCookie(299, 'password', env)).split(';')[0];

    const response = await SELF.fetch('https://example.com/api/export', {
      headers: { Cookie: emptyCookie },
    });

    expect(response.status).toBe(404);
  });

  it('skips a receipt whose file is gone rather than failing the whole backup', async () => {
    // The one receipt object in the fixture, deleted out from under the metadata row — a file
    // lost to a storage migration, a manual delete, an upload that never completed. It used to
    // 503 the whole export, so the account most in need of a backup was the one that could not
    // take one.
    await env.RECEIPTS!.delete('2000/receipt.png');

    const response = await request('/api/export');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Backup-Skipped-Receipts')).toBe('1');
    const backup = await response.json<BackupData>();
    expect(backup.skippedReceipts).toEqual([
      { receipt_id: 3100, original_name: 'receipt.png', reason: 'file_missing' },
    ]);
    // Everything else is there — including the transaction the receipt belonged to.
    expect(backup.transactions.some((row) => Number(row.id) === 2300)).toBe(true);
    expect(backup.accounts.length).toBeGreaterThan(0);
  });

  it('leaves a skipped receipt out of the metadata too, so the file still restores', async () => {
    // `validateBackup` requires every receipt row to carry its bytes. A backup that listed a
    // receipt it had no file for would be a file that exports fine and refuses to come back.
    await env.RECEIPTS!.delete('2000/receipt.png');
    const backup = await exportAccount();

    expect(backup.receipts).toHaveLength(0);
    expect(backup.receiptFiles).toHaveLength(0);
    // And the transaction keeps its row, with the pointer to the vanished receipt cleared.
    const transaction = backup.transactions.find((row) => Number(row.id) === 2300)!;
    expect(transaction.receipt_id).toBeNull();

    const restore = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    expect(restore.status).toBe(200);
  });

  it('says nothing about skipped receipts when none were skipped', async () => {
    const response = await request('/api/export');

    expect(response.headers.get('X-Backup-Skipped-Receipts')).toBeNull();
    expect((await response.json<BackupData>()).skippedReceipts).toBeUndefined();
  });

  it('lets you restore the profiles you already have, over a lower plan cap', async () => {
    // Free allows two; this account holds three. Judged against the plan limit alone, the user's
    // own backup is unrestorable — which is the one moment they most need it to work.
    const backup = await exportAccount();
    expect(backup.profiles).toHaveLength(3);

    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });

    expect(response.status).toBe(200);
  });

  it('still caps a restore that would add profiles beyond both the plan and the account', async () => {
    const backup = await exportAccount();
    backup.profiles = [
      ...backup.profiles,
      { ...backup.profiles[0]!, id: 9001, name: 'Extra one' },
      { ...backup.profiles[0]!, id: 9002, name: 'Extra two' },
    ];

    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });

    expect(response.status).toBe(403);
  });

  it('round-trips every profile and leaves another user untouched', async () => {
    const backup = await exportAccount();
    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    expect(response.status).toBe(200);
    const result = await response.json<{
      profiles_restored: number;
      rows_restored: number;
      first_profile_id: number;
    }>();
    expect(result.profiles_restored).toBe(3);
    expect(result.rows_restored).toBeGreaterThan(20);

    const profiles = await env.DB.prepare(
      'SELECT id, name FROM profiles WHERE user_id = ? ORDER BY name'
    )
      .bind(USER_ID)
      .all<{ id: number; name: string }>();
    expect(profiles.results?.map((profile) => profile.name)).toEqual(['Excluded', 'Home', 'Joint']);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM profiles WHERE name LIKE ?')
        .bind('__restore_%')
        .first<{ count: number }>()
    ).toMatchObject({ count: 0 });
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM transactions WHERE profile_id = 2010'
      ).first<{ count: number }>()
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM custom_reports WHERE user_id = ?')
        .bind(OTHER_USER_ID)
        .first<{ count: number }>()
    ).toMatchObject({ count: 1 });

    const restoredReceipt = await env.DB.prepare(
      `SELECT r.storage_path FROM receipts r
       JOIN profiles p ON p.id = r.profile_id
       WHERE p.user_id = ?`
    )
      .bind(USER_ID)
      .first<{ storage_path: string }>();
    expect(restoredReceipt?.storage_path).toBeTruthy();
    expect(
      Array.from(
        new Uint8Array(
          await (await env.RECEIPTS!.get(restoredReceipt!.storage_path))!.arrayBuffer()
        )
      )
    ).toEqual([1, 2, 3, 4]);
    expect(await env.RECEIPTS!.get('2000/receipt.png')).toBeNull();

    const restoredIds = (profiles.results ?? []).map((profile) => profile.id);
    const reexport = await SELF.fetch('https://example.com/api/export', {
      headers: {
        Cookie: cookie,
        'X-Profile-Id': String(result.first_profile_id),
        'X-Profile-Ids': JSON.stringify(restoredIds),
      },
    });
    expect(reexport.status).toBe(200);
    const roundTrip = await reexport.json<BackupData>();
    for (const key of [
      'profiles',
      'categories',
      'transactions',
      'accounts',
      'budgets',
      'budgetsZeroBased',
      'goals',
      'retirementGoals',
      'emergencyFundConfig',
      'loans',
      'loanRatePeriods',
      'loanPrepayments',
      'portfolioHoldings',
      'bills',
      'recurring',
      'housings',
      'tags',
      'tagRules',
      'transactionTags',
      'categoryMappings',
      'receipts',
      'receiptFiles',
      'balanceHistoryRows',
      'importLogs',
      'customReports',
      'settingsRows',
    ] as const) {
      expect(roundTrip[key]).toHaveLength(backup[key].length);
    }
  });

  it('keeps the current dataset when staging fails', async () => {
    const backup = await exportAccount();
    backup.transactions[0] = { ...backup.transactions[0], amount: null };

    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });
    expect(response.status).toBe(500);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM profiles WHERE user_id = ?')
        .bind(USER_ID)
        .first<{ count: number }>()
    ).toMatchObject({ count: 3 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions WHERE id = 2300').first<{
        count: number;
      }>()
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM profiles WHERE name LIKE ?')
        .bind('__restore_%')
        .first<{ count: number }>()
    ).toMatchObject({ count: 0 });
    expect(
      Array.from(new Uint8Array(await (await env.RECEIPTS!.get('2000/receipt.png'))!.arrayBuffer()))
    ).toEqual([1, 2, 3, 4]);
  });

  it('restores a valid zero-byte receipt attachment', async () => {
    const backup = await exportAccount();
    backup.receiptFiles[0]!.data_base64 = '';

    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    });

    expect(response.status).toBe(200);
    const receipt = await env.DB.prepare(
      `SELECT r.storage_path FROM receipts r
       JOIN profiles p ON p.id = r.profile_id
       WHERE p.user_id = ?`
    )
      .bind(USER_ID)
      .first<{ storage_path: string }>();
    const object = await env.RECEIPTS!.get(receipt!.storage_path);
    expect(object).not.toBeNull();
    expect(new Uint8Array(await object!.arrayBuffer())).toHaveLength(0);
  });

  it('restores the browser backup shape, including embedded loan and tag relations', async () => {
    const browserBackup = {
      version: '3.0.0',
      export_date: '2026-07-23T00:00:00.000Z',
      storage_mode: 'serverless',
      profiles: [{ id: 1, name: 'Browser', created_at: '2026-01-01' }],
      categories: [{ id: 1, profile_id: 1, name: 'Food', type: 'expense', color: '#f00' }],
      accounts: [
        {
          id: 1,
          profile_id: 1,
          name: 'Checking',
          type: 'giro',
          currency: 'EUR',
          balance: 90,
          starting_balance: 100,
        },
      ],
      transactions: [
        {
          id: 1,
          profile_id: 1,
          description: 'Lunch',
          amount: 10,
          amount_local: 10,
          date: '2026-01-01',
          type: 'expense',
          currency: 'EUR',
          category_id: 1,
          account_id: 1,
          tag_ids: [1],
        },
      ],
      budgets: [],
      goals: [],
      loans: [
        {
          id: 1,
          profile_id: 1,
          name: 'Loan',
          principal: 1000,
          interest_rate: 2,
          start_date: '2026-01-01',
          term_months: 12,
          rate_periods: [{ rate: 2, start_month: 1 }],
          prepayments: [{ month: 2, amount: 50, note: 'Extra' }],
        },
      ],
      tags: [{ id: 1, profile_id: 1, name: 'work' }],
      settings: { currency: 'EUR', theme: 'dark' },
    };

    const response = await request('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(browserBackup),
    });
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM loan_rate_periods').first<{
        count: number;
      }>()
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM loan_prepayments').first<{
        count: number;
      }>()
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS count FROM transaction_tags').first<{
        count: number;
      }>()
    ).toMatchObject({ count: 1 });
    expect(
      await env.DB.prepare(
        "SELECT value FROM settings s JOIN profiles p ON p.id = s.profile_id WHERE p.user_id = ? AND s.key = 'currency'"
      )
        .bind(USER_ID)
        .first<{ value: string }>()
    ).toMatchObject({ value: 'EUR' });
  });
});
