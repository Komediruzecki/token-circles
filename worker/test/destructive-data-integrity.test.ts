import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { issueSessionCookie } from '../src/auth';
import { DEFAULT_CATEGORIES } from '../src/profileData';

const TABLES = [
  'custom_reports',
  'error_logs',
  'reminder_sends',
  'reminder_dedup',
  'password_resets',
  'transaction_tags',
  'account_balance_history',
  'loan_rate_periods',
  'loan_prepayments',
  'import_logs',
  'receipts',
  'portfolio_holdings',
  'category_mappings',
  'tags',
  'housings',
  'bills',
  'recurring_transactions',
  'emergency_fund_config',
  'retirement_goals',
  'savings_goals',
  'budgets_zero_based',
  'budgets',
  'transactions',
  'accounts',
  'categories',
  'loans',
  'settings',
  'profiles',
  'users',
] as const;

const PROFILE_TABLES = [
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'budgets_zero_based',
  'savings_goals',
  'retirement_goals',
  'emergency_fund_config',
  'loans',
  'recurring_transactions',
  'bills',
  'housings',
  'tags',
  'category_mappings',
  'receipts',
  'portfolio_holdings',
  'import_logs',
] as const;

let cookie = '';

beforeEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS fail_account_delete').run();
  for (const table of TABLES) await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.RECEIPTS.delete(['receipts/700.txt', 'receipts/701.txt', 'receipts/702.txt']);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (70, 'owner@example.com', 'password', 1)"
    ),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (71, 'other@example.com', 'password', 1)"
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (700, 70, 'Primary')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (701, 70, 'Target')"),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (702, 71, 'Other user')"),
  ]);
  cookie = (await issueSessionCookie(70, 'password', env)).split(';')[0];
});

function api(path: string, method: 'DELETE' | 'POST', profileId?: number): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      ...(profileId === undefined ? {} : { 'X-Profile-Id': String(profileId) }),
    },
  });
}

async function seedProfile(profileId: number, includeReceipt = true): Promise<void> {
  const categoryId = profileId * 10 + 1;
  const accountId = profileId * 10 + 2;
  const transactionId = profileId * 10 + 3;
  const loanId = profileId * 10 + 4;
  const tagId = profileId * 10 + 5;
  const receiptPath = `receipts/${profileId}.txt`;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO categories (id, profile_id, name, color, type) VALUES (?, ?, ?, ?, ?)'
    ).bind(categoryId, profileId, `Category ${profileId}`, '#123456', 'expense'),
    env.DB.prepare(
      "INSERT INTO accounts (id, profile_id, name, type, currency, balance, starting_balance) VALUES (?, ?, ?, 'giro', 'EUR', 100, 100)"
    ).bind(accountId, profileId, `Account ${profileId}`),
    env.DB.prepare(
      "INSERT INTO transactions (id, profile_id, description, amount, date, category_id, account_id) VALUES (?, ?, 'Tx', 10, '2026-07-01', ?, ?)"
    ).bind(transactionId, profileId, categoryId, accountId),
    env.DB.prepare(
      'INSERT INTO account_balance_history (account_id, balance) VALUES (?, 100)'
    ).bind(accountId),
    env.DB.prepare(
      "INSERT INTO budgets (profile_id, category_id, amount, start_date) VALUES (?, ?, 20, '2026-07-01')"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO budgets_zero_based (profile_id, category_id, amount, month) VALUES (?, ?, 20, '2026-07')"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO savings_goals (profile_id, name, target_amount, category_id) VALUES (?, 'Goal', 100, ?)"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO retirement_goals (profile_id, name, target_amount) VALUES (?, 'Retire', 1000)"
    ).bind(profileId),
    env.DB.prepare(
      'INSERT INTO emergency_fund_config (id, profile_id, monthly_expenses) VALUES (?, ?, 100)'
    ).bind(profileId, profileId),
    env.DB.prepare(
      "INSERT INTO loans (id, profile_id, name, principal, interest_rate, start_date, term_months) VALUES (?, ?, 'Loan', 100, 5, '2026-01-01', 12)"
    ).bind(loanId, profileId),
    env.DB.prepare(
      'INSERT INTO loan_rate_periods (loan_id, rate, start_month) VALUES (?, 5, 1)'
    ).bind(loanId),
    env.DB.prepare('INSERT INTO loan_prepayments (loan_id, month, amount) VALUES (?, 1, 10)').bind(
      loanId
    ),
    env.DB.prepare(
      "INSERT INTO recurring_transactions (profile_id, description, amount, category_id) VALUES (?, 'Recurring', 10, ?)"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO bills (profile_id, name, amount, due_date, category_id) VALUES (?, 'Bill', 10, '2026-07-15', ?)"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO housings (profile_id, name, monthly_amount) VALUES (?, 'Home', 100)"
    ).bind(profileId),
    env.DB.prepare("INSERT INTO tags (id, profile_id, name) VALUES (?, ?, 'Tag')").bind(
      tagId,
      profileId
    ),
    env.DB.prepare('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').bind(
      transactionId,
      tagId
    ),
    env.DB.prepare(
      "INSERT INTO category_mappings (profile_id, pattern, category_id, confidence) VALUES (?, 'pattern', ?, 1)"
    ).bind(profileId, categoryId),
    env.DB.prepare(
      "INSERT INTO portfolio_holdings (profile_id, ticker, shares, purchase_price, purchase_date) VALUES (?, 'TEST', 1, 1, '2026-01-01')"
    ).bind(profileId),
    env.DB.prepare(
      "INSERT INTO import_logs (profile_id, source, imported) VALUES (?, 'test', 1)"
    ).bind(profileId),
    env.DB.prepare(
      "INSERT INTO settings (profile_id, key, value) VALUES (?, 'currency', 'EUR')"
    ).bind(profileId),
  ]);

  if (includeReceipt) {
    await env.RECEIPTS.put(receiptPath, 'receipt');
    await env.DB.prepare(
      `INSERT INTO receipts
         (profile_id, transaction_id, filename, original_name, file_type, file_size, storage_path)
       VALUES (?, ?, ?, 'receipt.txt', 'text/plain', 7, ?)`
    )
      .bind(profileId, transactionId, `${profileId}.txt`, receiptPath)
      .run();
  }
}

async function count(table: string, profileId: number): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`)
    .bind(profileId)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

async function assertProfileDataRemoved(profileId: number): Promise<void> {
  for (const table of PROFILE_TABLES) {
    expect(await count(table, profileId), table).toBe(0);
  }
  const accountHistory = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM account_balance_history WHERE account_id = ?'
  )
    .bind(profileId * 10 + 2)
    .first<{ n: number }>();
  const transactionTags = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id = ?'
  )
    .bind(profileId * 10 + 3)
    .first<{ n: number }>();
  const loanPeriods = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM loan_rate_periods WHERE loan_id = ?'
  )
    .bind(profileId * 10 + 4)
    .first<{ n: number }>();
  const loanPrepayments = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM loan_prepayments WHERE loan_id = ?'
  )
    .bind(profileId * 10 + 4)
    .first<{ n: number }>();
  expect(accountHistory?.n).toBe(0);
  expect(transactionTags?.n).toBe(0);
  expect(loanPeriods?.n).toBe(0);
  expect(loanPrepayments?.n).toBe(0);
  expect(await env.RECEIPTS.get(`receipts/${profileId}.txt`)).toBeNull();
}

describe('destructive profile operations', () => {
  it('clears every target domain and child row while preserving the profile, settings, and other profiles', async () => {
    await seedProfile(700);
    await seedProfile(701);
    await seedProfile(702);

    const response = await api('/api/profile/data', 'DELETE', 701);
    expect(response.status).toBe(200);
    await assertProfileDataRemoved(701);
    expect(await count('settings', 701)).toBe(1);
    expect(await count('transactions', 700)).toBe(1);
    expect(await env.DB.prepare('SELECT id FROM profiles WHERE id = 701').first()).not.toBeNull();
  });

  it('deletes a profile, its settings, every child row, and its receipt object', async () => {
    await seedProfile(700);
    await seedProfile(701);

    const response = await api('/api/profiles/701', 'DELETE', 700);
    expect(response.status).toBe(200);
    await assertProfileDataRemoved(701);
    expect(await count('settings', 701)).toBe(0);
    expect(await env.DB.prepare('SELECT id FROM profiles WHERE id = 701').first()).toBeNull();
    expect(await count('transactions', 700)).toBe(1);
  });

  it('Reset All clears every owned profile but preserves profiles and another user', async () => {
    await seedProfile(700);
    await seedProfile(701);
    await seedProfile(702);

    const response = await api('/api/clear-all', 'DELETE');
    expect(response.status).toBe(200);
    await assertProfileDataRemoved(700);
    await assertProfileDataRemoved(701);
    expect(await count('transactions', 702)).toBe(1);
    expect(await count('settings', 700)).toBe(0);
    expect(await count('settings', 701)).toBe(0);
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = 70').first<{
        n: number;
      }>()
    ).toMatchObject({ n: 2 });
  });

  it('rolls back all D1 deletions when one statement fails', async () => {
    await seedProfile(701, false);
    await env.DB.prepare(
      `CREATE TRIGGER fail_account_delete
       BEFORE DELETE ON accounts
       WHEN OLD.profile_id = 701
       BEGIN
         SELECT RAISE(ABORT, 'forced failure');
       END`
    ).run();

    const response = await api('/api/profile/data', 'DELETE', 701);
    expect(response.status).toBe(500);
    expect(await count('transactions', 701)).toBe(1);
    expect(await count('categories', 701)).toBe(1);
    expect(await count('accounts', 701)).toBe(1);
    const children = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM loan_rate_periods WHERE loan_id = ?'
    )
      .bind(7014)
      .first<{ n: number }>();
    expect(children?.n).toBe(1);
  });

  it('permanently deletes an account and every user-owned data domain', async () => {
    await seedProfile(700);
    await seedProfile(701);
    await seedProfile(702);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO custom_reports (user_id, name, config) VALUES (70, 'Report', '{}')"
      ),
      env.DB.prepare(
        "INSERT INTO error_logs (user_id, status, message) VALUES (70, 500, 'failure')"
      ),
      env.DB.prepare(
        "INSERT INTO reminder_sends (user_id, year_month, count) VALUES (70, '2026-07', 1)"
      ),
      env.DB.prepare(
        "INSERT INTO reminder_dedup (user_id, dedup_key) VALUES (70, 'report:2026-07')"
      ),
      env.DB.prepare(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (70, 'hash', '2026-08-01')"
      ),
    ]);

    const response = await SELF.fetch('https://example.com/api/account', {
      method: 'DELETE',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirm: 'owner@example.com' }),
    });
    expect(response.status).toBe(200);

    expect(await env.DB.prepare('SELECT id FROM users WHERE id = 70').first()).toBeNull();
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM profiles WHERE user_id = 70').first()
    ).toMatchObject({ n: 0 });
    for (const table of ['custom_reports', 'error_logs', 'reminder_sends', 'reminder_dedup']) {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = 70`
      ).first<{
        n: number;
      }>();
      expect(row?.n, table).toBe(0);
    }
    expect(await env.RECEIPTS.get('receipts/700.txt')).toBeNull();
    expect(await env.RECEIPTS.get('receipts/701.txt')).toBeNull();
    expect(await count('transactions', 702)).toBe(1);
  });
});

describe('category reset referential integrity', () => {
  it('preserves a canonical default ID and removes or detaches custom references atomically', async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, color, type) VALUES (7101, 701, 'Salary', '#000000', 'expense')"
      ),
      env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, color, type) VALUES (7102, 701, 'Custom', '#111111', 'expense')"
      ),
      env.DB.prepare(
        "INSERT INTO transactions (id, profile_id, description, amount, date, category_id) VALUES (7103, 701, 'Custom tx', 1, '2026-07-01', 7102)"
      ),
      env.DB.prepare(
        "INSERT INTO transactions (id, profile_id, description, amount, date, category_id) VALUES (7104, 701, 'Salary tx', 1, '2026-07-01', 7101)"
      ),
      env.DB.prepare(
        "INSERT INTO budgets (id, profile_id, category_id, amount, start_date) VALUES (7105, 701, 7102, 1, '2026-07-01')"
      ),
      env.DB.prepare(
        "INSERT INTO budgets (id, profile_id, category_id, amount, start_date) VALUES (7106, 701, 7101, 1, '2026-07-01')"
      ),
      env.DB.prepare(
        "INSERT INTO savings_goals (id, profile_id, name, target_amount, category_id) VALUES (7107, 701, 'Goal', 1, 7102)"
      ),
      env.DB.prepare(
        "INSERT INTO bills (id, profile_id, name, amount, due_date, category_id) VALUES (7108, 701, 'Bill', 1, '2026-07-01', 7102)"
      ),
      env.DB.prepare(
        "INSERT INTO recurring_transactions (id, profile_id, description, amount, category_id) VALUES (7109, 701, 'Recurring', 1, 7102)"
      ),
      env.DB.prepare(
        "INSERT INTO category_mappings (id, profile_id, pattern, category_id, confidence) VALUES (7110, 701, 'custom', 7102, 1)"
      ),
    ]);

    const response = await api('/api/categories', 'DELETE', 701);
    expect(response.status).toBe(200);

    expect(await count('categories', 701)).toBe(DEFAULT_CATEGORIES.length);
    expect(
      await env.DB.prepare('SELECT id, type, color FROM categories WHERE id = 7101').first()
    ).toMatchObject({ id: 7101, type: 'income', color: '#22C55E' });
    expect(await env.DB.prepare('SELECT id FROM categories WHERE id = 7102').first()).toBeNull();
    expect(
      await env.DB.prepare('SELECT category_id FROM transactions WHERE id = 7103').first()
    ).toMatchObject({ category_id: null });
    expect(
      await env.DB.prepare('SELECT category_id FROM transactions WHERE id = 7104').first()
    ).toMatchObject({ category_id: 7101 });
    expect(await env.DB.prepare('SELECT id FROM budgets WHERE id = 7105').first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM budgets WHERE id = 7106').first()).not.toBeNull();
    expect(
      await env.DB.prepare('SELECT category_id FROM savings_goals WHERE id = 7107').first()
    ).toMatchObject({ category_id: null });
    expect(
      await env.DB.prepare('SELECT id FROM category_mappings WHERE id = 7110').first()
    ).toBeNull();
  });
});
