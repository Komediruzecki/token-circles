import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { exportBackup, type BackupData } from '../src/backup';
import type { Env } from '../src/index';
import { DataKeyring } from '../src/data-keys';
import { openRows, sealForInsert } from '../src/sealed-rows';
import { putReceipt, receiptBytes } from '../src/sealed-objects';
import { openedRows } from './helpers/sealed';

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
      `SELECT r.storage_path, r.enc FROM receipts r
       JOIN profiles p ON p.id = r.profile_id
       WHERE p.user_id = ?`
    )
      .bind(USER_ID)
      .first<{ storage_path: string; enc: number }>();
    expect(restoredReceipt?.storage_path).toBeTruthy();
    // Opened, so this holds whether the suite runs keyed (sealed object) or keyless (raw bytes).
    const restoredObject = (await env.RECEIPTS!.get(restoredReceipt!.storage_path))!;
    expect(
      Array.from(
        await receiptBytes(new DataKeyring(env), USER_ID, restoredObject, restoredReceipt!.enc)
      )
    ).toEqual([1, 2, 3, 4]);
    const restoredText = await openedRows<{ description: string }>(
      'transactions',
      USER_ID,
      `SELECT t.description, t.text_enc FROM transactions t
       JOIN profiles p ON p.id = t.profile_id
       WHERE p.user_id = ? ORDER BY t.date`,
      USER_ID
    );
    expect(restoredText.map((row) => row.description)).toEqual(['Groceries', 'Joint income']);
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
      `SELECT r.storage_path, r.enc, r.file_size FROM receipts r
       JOIN profiles p ON p.id = r.profile_id
       WHERE p.user_id = ?`
    )
      .bind(USER_ID)
      .first<{ storage_path: string; enc: number; file_size: number }>();
    expect(receipt?.file_size).toBe(0);
    const object = await env.RECEIPTS!.get(receipt!.storage_path);
    expect(object).not.toBeNull();
    expect(await receiptBytes(new DataKeyring(env), USER_ID, object!, receipt!.enc)).toHaveLength(
      0
    );
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

// Forced on (and, for one user, forced off), whatever mode the suite runs in. Users 56000-56099
// only ever go through these envs: a user who got a key under KEYED and was then read through SELF
// in a keyless run would get a 503 by design.
describe('backup and restore with field encryption on', () => {
  const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const KEYED = { ...env, DATA_KEK_1: K };
  // No master key at all — what a deployment without encryption is.
  const PLAIN = { ...env, DATA_KEK_1: undefined };
  const SEALED_USER = 56000;
  const PLAIN_USER = 56001;
  const PROFILE = 56010;
  const TCE1 = [0x54, 0x43, 0x45, 0x31];

  async function as(
    target: typeof KEYED | typeof PLAIN,
    userId: number,
    path: string,
    init: RequestInit = {},
    profileId?: number
  ): Promise<Response> {
    const userCookie = (await issueSessionCookie(userId, 'password', env)).split(';')[0];
    return app.fetch(
      new Request(`https://example.com${path}`, {
        ...init,
        headers: {
          Cookie: userCookie,
          ...(profileId === undefined ? {} : { 'X-Profile-Id': String(profileId) }),
          ...(init.headers || {}),
        },
      }),
      target,
      createExecutionContext()
    );
  }

  const restore = (target: typeof KEYED | typeof PLAIN, userId: number, body: unknown) =>
    as(target, userId, '/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const byId = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((row) => [Number(row.id), row]));

  /**
   * An account caught mid-backfill: in each sealed table one row sealed under the user's key and
   * one still plaintext at text_enc 0, and one receipt object in each form.
   */
  async function seedMixedAccount(): Promise<void> {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sealed-backup@example.com', 'password', 1)"
      ).bind(SEALED_USER),
      env.DB.prepare(
        "INSERT INTO profiles (id, name, user_id, created_at) VALUES (?, 'Sealed home', ?, '2026-01-01')"
      ).bind(PROFILE, SEALED_USER),
      env.DB.prepare(
        "INSERT INTO accounts (id, name, currency, balance, starting_balance, profile_id) VALUES (56030, 'Checking', 'EUR', 0, 0, ?)"
      ).bind(PROFILE),
    ]);
    const ring = new DataKeyring(KEYED);
    const tx = await sealForInsert(ring, SEALED_USER, 'transactions', {
      description: 'Coffee beans',
      beneficiary: 'Roastery',
      payor: '',
      notes: 'two bags',
    });
    const bill = await sealForInsert(ring, SEALED_USER, 'bills', {
      name: 'Power',
      notes: 'meter 7',
    });
    const recurring = await sealForInsert(ring, SEALED_USER, 'recurring_transactions', {
      description: 'Gym',
      notes: 'annual',
    });
    expect([tx.text_enc, bill.text_enc, recurring.text_enc]).toEqual([1, 1, 1]);
    const sealedEnc = await putReceipt(
      ring,
      SEALED_USER,
      env.RECEIPTS!,
      `${PROFILE}/sealed.jpg`,
      new Uint8Array([1, 2, 3, 4, 5]),
      'image/jpeg'
    );
    expect(sealedEnc).toBe(1);
    await env.RECEIPTS!.put(`${PROFILE}/plain.png`, new Uint8Array([6, 7, 8]), {
      httpMetadata: { contentType: 'image/png' },
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO transactions (id, description, beneficiary, payor, notes, text_enc, amount, amount_local, date, type, currency, account_id, receipt_id, profile_id)
         VALUES (56040, ?, ?, ?, ?, ?, 12, 12, '2026-03-02', 'expense', 'EUR', 56030, 56070, ?)`
      ).bind(tx.description, tx.beneficiary, tx.payor, tx.notes, tx.text_enc, PROFILE),
      env.DB.prepare(
        `INSERT INTO transactions (id, description, beneficiary, payor, notes, text_enc, amount, amount_local, date, type, currency, account_id, receipt_id, profile_id)
         VALUES (56041, 'Rent', 'Landlord', '', NULL, 0, 700, 700, '2026-03-01', 'expense', 'EUR', 56030, 56071, ?)`
      ).bind(PROFILE),
      env.DB.prepare(
        "INSERT INTO bills (id, profile_id, name, notes, text_enc, amount, due_date) VALUES (56050, ?, ?, ?, ?, 60, '2026-04-01')"
      ).bind(PROFILE, bill.name, bill.notes, bill.text_enc),
      env.DB.prepare(
        "INSERT INTO bills (id, profile_id, name, notes, text_enc, amount, due_date) VALUES (56051, ?, 'Water', NULL, 0, 20, '2026-04-02')"
      ).bind(PROFILE),
      env.DB.prepare(
        "INSERT INTO recurring_transactions (id, profile_id, description, notes, text_enc, amount, type, frequency) VALUES (56060, ?, ?, ?, ?, 40, 'expense', 'monthly')"
      ).bind(PROFILE, recurring.description, recurring.notes, recurring.text_enc),
      env.DB.prepare(
        "INSERT INTO recurring_transactions (id, profile_id, description, notes, text_enc, amount, type, frequency) VALUES (56061, ?, 'Phone', NULL, 0, 15, 'expense', 'monthly')"
      ).bind(PROFILE),
      env.DB.prepare(
        `INSERT INTO receipts (id, transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id, enc)
         VALUES (56070, 56040, ?, 'beans.jpg', 'image/jpeg', 5, ?, ?, 1)`
      ).bind(`${PROFILE}/sealed.jpg`, `${PROFILE}/sealed.jpg`, PROFILE),
      env.DB.prepare(
        `INSERT INTO receipts (id, transaction_id, filename, original_name, file_type, file_size, storage_path, profile_id, enc)
         VALUES (56071, 56041, ?, 'rent.png', 'image/png', 3, ?, ?, 0)`
      ).bind(`${PROFILE}/plain.png`, `${PROFILE}/plain.png`, PROFILE),
    ]);
  }

  async function exportSealedUser(): Promise<BackupData> {
    const response = await as(KEYED, SEALED_USER, '/api/export');
    expect(response.status).toBe(200);
    return response.json<BackupData>();
  }

  it('seals a restored file under the restoring user, not whoever exported it', async () => {
    await seedMixedAccount();
    const backup = await exportSealedUser();
    const RESTORER = 56002;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'sealed-restorer@example.com', 'password', 1)"
      ).bind(RESTORER),
      env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (56020, 'Before', ?)").bind(
        RESTORER
      ),
    ]);
    expect((await restore(KEYED, RESTORER, backup)).status).toBe(200);

    const { results } = await env.DB.prepare(
      `SELECT t.description, t.beneficiary, t.payor, t.notes, t.text_enc FROM transactions t
         JOIN profiles p ON p.id = t.profile_id WHERE p.user_id = ? ORDER BY t.date`
    )
      .bind(RESTORER)
      .all<Record<string, unknown>>();
    expect(results.map((r) => r.text_enc)).toEqual([1, 1]);
    const ring = new DataKeyring(KEYED);
    expect(
      (await openRows(ring, RESTORER, 'transactions', results)).map((r) => r.description)
    ).toEqual(['Rent', 'Coffee beans']);
    // Sealed under the restorer's key: the exporter's key does not open them.
    await expect(openRows(ring, SEALED_USER, 'transactions', results)).rejects.toThrow();
  });

  it('fails the export on a sealed value that will not open, never shipping ciphertext', async () => {
    await seedMixedAccount();
    const { description } = (await env.DB.prepare(
      'SELECT description FROM transactions WHERE id = 56040'
    ).first<{ description: string }>())!;
    const at = description.lastIndexOf('.') + 1;
    const flipped =
      description.slice(0, at) + (description[at] === 'A' ? 'B' : 'A') + description.slice(at + 1);
    await env.DB.prepare('UPDATE transactions SET description = ? WHERE id = 56040')
      .bind(flipped)
      .run();

    const response = await as(KEYED, SEALED_USER, '/api/export');
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toContain('tc1.');
  });

  it('fails the export on a sealed receipt that will not open, rather than skipping it', async () => {
    await seedMixedAccount();
    const key = `${PROFILE}/sealed.jpg`;
    const object = (await env.RECEIPTS!.get(key))!;
    const bytes = new Uint8Array(await object.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    await env.RECEIPTS!.put(key, bytes, {
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    });

    const response = await as(KEYED, SEALED_USER, '/api/export');
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it('a snapshot without receipt bytes never opens a receipt', async () => {
    await seedMixedAccount();
    const key = `${PROFILE}/sealed.jpg`;
    const object = (await env.RECEIPTS!.get(key))!;
    const bytes = new Uint8Array(await object.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    await env.RECEIPTS!.put(key, bytes, { customMetadata: object.customMetadata });

    const data = await exportBackup(
      KEYED as unknown as Env,
      SEALED_USER,
      [PROFILE],
      new DataKeyring(KEYED),
      {
        receiptBytes: false,
      }
    );
    expect(data.receiptFiles).toEqual([]);
    expect(data.receipts.map((r) => r.id).sort()).toEqual([56070, 56071]);
    expect(JSON.stringify(data)).not.toContain('tc1.');
  });

  it('exports sealed and plaintext rows alike as plaintext, with no encryption markers', async () => {
    await seedMixedAccount();
    const raw = await env.DB.prepare(
      'SELECT description, text_enc FROM transactions WHERE id = 56040'
    ).first<{ description: string; text_enc: number }>();
    expect(raw?.text_enc).toBe(1);
    expect(raw?.description.startsWith('tc1.')).toBe(true);

    const backup = await exportSealedUser();

    const transactions = byId(backup.transactions);
    expect(transactions.get(56040)).toMatchObject({
      description: 'Coffee beans',
      beneficiary: 'Roastery',
      payor: '',
      notes: 'two bags',
    });
    expect(transactions.get(56041)).toMatchObject({
      description: 'Rent',
      beneficiary: 'Landlord',
      payor: '',
      notes: null,
    });
    expect(byId(backup.bills).get(56050)).toMatchObject({ name: 'Power', notes: 'meter 7' });
    expect(byId(backup.bills).get(56051)).toMatchObject({ name: 'Water', notes: null });
    expect(byId(backup.recurring).get(56060)).toMatchObject({
      description: 'Gym',
      notes: 'annual',
    });
    expect(byId(backup.recurring).get(56061)).toMatchObject({ description: 'Phone' });
    for (const row of [...backup.transactions, ...backup.bills, ...backup.recurring]) {
      expect(row).not.toHaveProperty('text_enc');
    }
    expect(backup.receipts).toHaveLength(2);
    for (const row of backup.receipts) expect(row).not.toHaveProperty('enc');

    const files = new Map(backup.receiptFiles.map((file) => [file.receipt_id, file]));
    // The sealed object is stored as application/octet-stream; its type comes from the row.
    expect(files.get(56070)).toMatchObject({ content_type: 'image/jpeg', data_base64: 'AQIDBAU=' });
    expect(files.get(56071)).toMatchObject({ content_type: 'image/png', data_base64: 'BgcI' });
    expect(backup.skippedReceipts).toBeUndefined();
  });

  it('restores sealed under the restoring user, whatever markers the file carries', async () => {
    await seedMixedAccount();
    const backup = await exportSealedUser();
    // A file that lies about its form — plaintext marked sealed and the reverse. Restore must
    // decide the form itself, or it would store plaintext under a "sealed" marker.
    const lying = structuredClone(backup);
    for (const row of lying.transactions) row.text_enc = 1;
    for (const row of lying.bills) row.text_enc = 0;
    for (const row of lying.recurring) row.text_enc = 1;
    for (const row of lying.receipts) row.enc = 0;

    const response = await restore(KEYED, SEALED_USER, lying);
    expect(response.status).toBe(200);
    const { first_profile_id: profileId } = await response.json<{ first_profile_id: number }>();

    const ring = new DataKeyring(KEYED);
    const rawTx = (
      await env.DB.prepare('SELECT * FROM transactions WHERE profile_id = ? ORDER BY date')
        .bind(profileId)
        .all<Record<string, unknown>>()
    ).results;
    expect(rawTx).toHaveLength(2);
    for (const row of rawTx) {
      expect(row.text_enc).toBe(1);
      expect(String(row.description)).toMatch(/^tc1\./);
      expect(String(row.beneficiary)).toMatch(/^tc1\./);
      // Empty and NULL stay as they are, sealed row or not.
      expect(row.payor).toBe('');
    }
    expect(
      (await openRows(ring, SEALED_USER, 'transactions', rawTx)).map((row) => [
        row.description,
        row.beneficiary,
        row.payor,
        row.notes,
      ])
    ).toEqual([
      ['Rent', 'Landlord', '', null],
      ['Coffee beans', 'Roastery', '', 'two bags'],
    ]);

    const rawBills = (
      await env.DB.prepare('SELECT * FROM bills WHERE profile_id = ? ORDER BY due_date')
        .bind(profileId)
        .all<Record<string, unknown>>()
    ).results;
    for (const row of rawBills) {
      expect(row.text_enc).toBe(1);
      expect(String(row.name)).toMatch(/^tc1\./);
    }
    expect(
      (await openRows(ring, SEALED_USER, 'bills', rawBills)).map((row) => [row.name, row.notes])
    ).toEqual([
      ['Power', 'meter 7'],
      ['Water', null],
    ]);

    const rawRecurring = (
      await env.DB.prepare(
        'SELECT * FROM recurring_transactions WHERE profile_id = ? ORDER BY amount'
      )
        .bind(profileId)
        .all<Record<string, unknown>>()
    ).results;
    for (const row of rawRecurring) expect(row.text_enc).toBe(1);
    expect(
      (await openRows(ring, SEALED_USER, 'recurring_transactions', rawRecurring)).map((row) => [
        row.description,
        row.notes,
      ])
    ).toEqual([
      ['Phone', null],
      ['Gym', 'annual'],
    ]);

    const receipts = (
      await env.DB.prepare(
        'SELECT id, original_name, storage_path, file_size, enc FROM receipts WHERE profile_id = ? ORDER BY original_name'
      )
        .bind(profileId)
        .all<{
          id: number;
          original_name: string;
          storage_path: string;
          file_size: number;
          enc: number;
        }>()
    ).results;
    expect(receipts.map((r) => [r.original_name, r.file_size, r.enc])).toEqual([
      ['beans.jpg', 5, 1],
      ['rent.png', 3, 1],
    ]);
    const expected: Record<string, number[]> = {
      'beans.jpg': [1, 2, 3, 4, 5],
      'rent.png': [6, 7, 8],
    };
    for (const receipt of receipts) {
      const stored = new Uint8Array(
        await (await env.RECEIPTS!.get(receipt.storage_path))!.arrayBuffer()
      );
      expect(Array.from(stored.subarray(0, 4))).toEqual(TCE1);
      const served = await as(
        KEYED,
        SEALED_USER,
        `/api/receipts/${receipt.id}/file`,
        {},
        profileId
      );
      expect(served.status).toBe(200);
      expect(Array.from(new Uint8Array(await served.arrayBuffer()))).toEqual(
        expected[receipt.original_name]
      );
    }

    // And it comes back out as the same plaintext it went in as.
    const again = await exportSealedUser();
    const text = (data: BackupData) =>
      data.transactions
        .map((row) => [row.description, row.beneficiary, row.payor, row.notes])
        .sort();
    expect(text(again)).toEqual(text(backup));
    expect(again.bills.map((row) => row.name).sort()).toEqual(['Power', 'Water']);
    expect(again.receiptFiles.map((file) => file.data_base64).sort()).toEqual(['AQIDBAU=', 'BgcI']);
    for (const row of again.transactions) expect(row).not.toHaveProperty('text_enc');
    for (const row of again.receipts) expect(row).not.toHaveProperty('enc');
  });

  it('restores plaintext at marker 0 without a key, even from a file claiming sealed', async () => {
    await env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'plain-backup@example.com', 'password', 1)"
    )
      .bind(PLAIN_USER)
      .run();
    const file = {
      version: '3.0.0',
      profiles: [{ id: 1, name: 'Plain', created_at: '2026-01-01' }],
      accounts: [
        { id: 1, profile_id: 1, name: 'Cash', currency: 'EUR', balance: 0, starting_balance: 0 },
      ],
      transactions: [
        {
          id: 1,
          profile_id: 1,
          description: 'Bakery',
          beneficiary: 'Baker',
          amount: 3,
          amount_local: 3,
          date: '2026-02-01',
          type: 'expense',
          currency: 'EUR',
          account_id: 1,
          receipt_id: 1,
          text_enc: 1,
        },
      ],
      bills: [
        { id: 1, profile_id: 1, name: 'Internet', amount: 30, due_date: '2026-02-10', text_enc: 1 },
      ],
      recurring: [
        {
          id: 1,
          profile_id: 1,
          description: 'Streaming',
          amount: 10,
          type: 'expense',
          frequency: 'monthly',
          text_enc: 1,
        },
      ],
      receipts: [
        {
          id: 1,
          profile_id: 1,
          transaction_id: 1,
          original_name: 'bread.png',
          file_type: 'image/png',
          file_size: 3,
          enc: 1,
        },
      ],
      receiptFiles: [{ receipt_id: 1, content_type: 'image/png', data_base64: 'CgsM' }],
    };

    const response = await restore(PLAIN, PLAIN_USER, file);
    expect(response.status).toBe(200);
    const { first_profile_id: profileId } = await response.json<{ first_profile_id: number }>();

    expect(
      await env.DB.prepare(
        'SELECT description, beneficiary, text_enc FROM transactions WHERE profile_id = ?'
      )
        .bind(profileId)
        .first()
    ).toEqual({ description: 'Bakery', beneficiary: 'Baker', text_enc: 0 });
    expect(
      await env.DB.prepare('SELECT name, text_enc FROM bills WHERE profile_id = ?')
        .bind(profileId)
        .first()
    ).toEqual({ name: 'Internet', text_enc: 0 });
    expect(
      await env.DB.prepare(
        'SELECT description, text_enc FROM recurring_transactions WHERE profile_id = ?'
      )
        .bind(profileId)
        .first()
    ).toEqual({ description: 'Streaming', text_enc: 0 });
    const receipt = await env.DB.prepare(
      'SELECT storage_path, enc FROM receipts WHERE profile_id = ?'
    )
      .bind(profileId)
      .first<{ storage_path: string; enc: number }>();
    expect(receipt?.enc).toBe(0);
    const object = (await env.RECEIPTS!.get(receipt!.storage_path))!;
    expect(object.httpMetadata?.contentType).toBe('image/png');
    expect(Array.from(new Uint8Array(await object.arrayBuffer()))).toEqual([10, 11, 12]);
    expect(
      await env.DB.prepare('SELECT dek_wrapped FROM users WHERE id = ?').bind(PLAIN_USER).first()
    ).toEqual({ dek_wrapped: null });
  });
});
