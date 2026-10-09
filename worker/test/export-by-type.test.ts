/**
 * One kind of row exported on its own (GET /api/export/:type), on a real D1 with older rows in
 * place: the columns, the order, the cells a spreadsheet would read as formulas, a kind with no
 * rows, pretty JSON and a kind there is no export of (shared/exportColumns.ts). The twin of the
 * local-first test, frontend/src/core/storage/__tests__/exportByType.test.ts, which expects the
 * same files.
 *
 * Before, the Worker wrote an empty file, without its header, for a kind with no rows; ignored
 * Settings' "Format JSON"; and refused an unknown kind as "Invalid export type".
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_MESSAGES } from '../../shared/exportColumns';
import { sessionCookie } from './helpers/session';

const USER_ID = 6440;
const PROFILE = 64400;
const SIDE = 64401;
let cookie = '';

beforeEach(async () => {
  for (const t of [
    'loan_prepayments',
    'loans',
    'recurring_transactions',
    'budgets',
    'transactions',
    'accounts',
    'categories',
    'rate_limits',
    'profiles',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(USER_ID).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'export-by-type@example.com', 'password', 1, 'free')"
    ).bind(USER_ID),
    env.DB.prepare(
      "INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Household'), (?, ?, 'Side')"
    ).bind(PROFILE, USER_ID, SIDE, USER_ID),
    env.DB.prepare(
      `INSERT INTO categories (id, profile_id, name, color, icon, type) VALUES
         (64410, ?, 'Food', '#aa5500', 'cart', 'expense'),
         (64411, ?, 'Theirs', '#335577', 'tag', 'expense')`
    ).bind(PROFILE, SIDE),
    // An older row filed under another profile's category, a description a spreadsheet would
    // run as a formula, and a beneficiary with a comma and quotes.
    env.DB.prepare(
      `INSERT INTO transactions (id, profile_id, date, description, amount, type, currency, beneficiary, category_id) VALUES
         (64420, ?, '2026-03-10', 'Groceries', 45.5, 'expense', 'EUR', '', 64410),
         (64421, ?, '2026-03-10', '=SUM(A1)', -12, 'expense', 'EUR', 'Shop, "Corner"', NULL),
         (64422, ?, '2026-03-01', 'Refund', 5, 'income', 'EUR', '', 64411),
         (64423, ?, '2026-02-01', 'Side tools', 20, 'expense', 'EUR', '', 64411)`
    ).bind(PROFILE, PROFILE, PROFILE, SIDE),
    env.DB.prepare(
      `INSERT INTO accounts (id, profile_id, name, type, currency, balance, notes) VALUES
         (64430, ?, 'Everyday', 'giro', 'EUR', 954.5, ''),
         (64431, ?, 'Card', 'credit', 'EUR', -250.75, NULL)`
    ).bind(PROFILE, PROFILE),
    env.DB.prepare(
      `INSERT INTO budgets (id, profile_id, category_id, amount, period, start_date, created_at) VALUES
         (64440, ?, 64410, 300, 'monthly', '2026-03-01', '2026-03-01 09:00:00'),
         (64441, ?, 64411, 50, 'monthly', '2026-03-01', '2026-03-01 09:00:00')`
    ).bind(PROFILE, PROFILE),
    env.DB.prepare(
      `INSERT INTO loans (id, profile_id, name, principal, interest_rate, start_date, term_months) VALUES
         (64450, ?, 'Car', 12000, 4.5, '2026-01-01', 48),
         (64451, ?, 'Bike', 800, 0, '2026-02-01', 12)`
    ).bind(PROFILE, PROFILE),
    env.DB.prepare(
      'INSERT INTO loan_prepayments (loan_id, month, amount) VALUES (64450, 3, 500), (64450, 6, 250)'
    ),
    env.DB.prepare(
      `INSERT INTO recurring_transactions (id, profile_id, description, amount, type, frequency, day_of_month, next_date, active) VALUES
         (64460, ?, 'Rent', 900, 'expense', 'monthly', 1, '2026-04-01', 1),
         (64461, ?, 'Gym', 30, 'expense', 'monthly', 15, '2026-04-15', 0)`
    ).bind(PROFILE, PROFILE),
  ]);
  cookie = (await sessionCookie(USER_ID, 'password', env)).split(';')[0];
});

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { Cookie: cookie, 'X-Profile-Id': String(PROFILE), ...headers },
  });
}

async function text(path: string, headers?: Record<string, string>): Promise<string> {
  const res = await get(path, headers);
  expect(res.status).toBe(200);
  return res.text();
}

describe('a kind exported as CSV', () => {
  it('writes the transactions newest first, each category by name, guarding a formula', async () => {
    expect(await text('/api/export/transactions?format=csv')).toBe(
      [
        'date,description,amount,type,currency,means_of_payment,beneficiary,payor,notes,category',
        `2026-03-10,'=SUM(A1),-12,expense,EUR,,"Shop, ""Corner""",,,`,
        '2026-03-10,Groceries,45.5,expense,EUR,,,,,Food',
        '2026-03-01,Refund,5,income,EUR,,,,,',
      ].join('\n')
    );
  });

  it('writes every profile the request names', async () => {
    const csv = await text('/api/export/transactions?format=csv', {
      'X-Profile-Ids': JSON.stringify([PROFILE, SIDE]),
    });
    expect(csv.split('\n').slice(-1)).toEqual(['2026-02-01,Side tools,20,expense,EUR,,,,,Theirs']);
  });

  it('writes the other kinds with their own columns', async () => {
    expect(await text('/api/export/categories?format=csv')).toBe(
      'name,color,icon,type,parent_id\nFood,#aa5500,cart,expense,'
    );
    expect(await text('/api/export/accounts?format=csv')).toBe(
      'name,type,currency,balance,notes\nEveryday,giro,EUR,954.5,\nCard,credit,EUR,-250.75,'
    );
    // A budget whose category is another profile's is left out.
    expect(await text('/api/export/budgets?format=csv')).toBe(
      'id,category_id,amount,period,start_date,end_date,rollover_enabled,rollover_amount,rollover_used,created_at,profile_id,category_name\n' +
        '64440,64410,300,monthly,2026-03-01,,0,0,0,2026-03-01 09:00:00,64400,Food'
    );
    expect(await text('/api/export/loans?format=csv')).toBe(
      'name,principal,interest_rate,start_date,term_months,total_prepaid\n' +
        'Car,12000,4.5,2026-01-01,48,750\n' +
        'Bike,800,0,2026-02-01,12,'
    );
    expect(await text('/api/export/recurring?format=csv')).toBe(
      'description,amount,type,frequency,day_of_month,next_date,notes,active\n' +
        'Rent,900,expense,monthly,1,2026-04-01,,1\n' +
        'Gym,30,expense,monthly,15,2026-04-15,,0'
    );
  });

  it('writes the header of a kind with no rows', async () => {
    expect(await text('/api/export/loans?format=csv', { 'X-Profile-Id': String(SIDE) })).toBe(
      'name,principal,interest_rate,start_date,term_months,total_prepaid'
    );
  });
});

describe('a kind exported as JSON', () => {
  it('is the list of rows, with a null where a row holds none', async () => {
    const res = await get('/api/export/accounts?format=json');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="accounts.json"');
    expect(await res.json()).toEqual([
      { name: 'Everyday', type: 'giro', currency: 'EUR', balance: 954.5, notes: '' },
      { name: 'Card', type: 'credit', currency: 'EUR', balance: -250.75, notes: null },
    ]);
  });

  it('is indented when Settings asks for it formatted', async () => {
    expect(await text('/api/export/loans?format=json&pretty=true')).toBe(
      JSON.stringify(
        [
          {
            name: 'Car',
            principal: 12000,
            interest_rate: 4.5,
            start_date: '2026-01-01',
            term_months: 48,
            total_prepaid: 750,
          },
          {
            name: 'Bike',
            principal: 800,
            interest_rate: 0,
            start_date: '2026-02-01',
            term_months: 12,
            total_prepaid: null,
          },
        ],
        null,
        2
      )
    );
  });
});

describe('a kind there is no export of', () => {
  it('is refused, in words that list the kinds', async () => {
    for (const kind of ['settings', 'goals', 'everything']) {
      const res = await get(`/api/export/${kind}?format=json`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: EXPORT_MESSAGES.kind });
    }
  });
});
