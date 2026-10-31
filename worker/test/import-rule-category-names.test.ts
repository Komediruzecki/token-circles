/**
 * A bank import's rule categories on the Worker.
 *
 * The rules give default category names, so a newcomer's first import files its rows into the
 * default categories and offers no second name beside a default: not the Croatian rules' old
 * 'Car (Gas)', 'Apartment (Bills)' and 'Salary Eur', and not 'Transport' or 'Health'. A profile
 * that already holds a category under a name a rule gave before keeps getting that rule's rows
 * there, even where two rules now give one name: fuel under 'Car (Gas)' and parking under
 * 'Transport'.
 *
 * Two paths categorize a statement's rows by the rules, and both are run here with a made-up
 * Revolut statement:
 * - the app's Bank Imports tab, which runs the rules in the browser with the categories GET
 *   /api/categories returns for the profile, then sends the rows to POST /api/import/execute;
 * - the API's statement import, POST /api/v1/import, which runs them here.
 * Mirrors frontend/src/core/storage/__tests__/importFlow.ruleCategoryNames.test.ts.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { processFiles } from '../../shared/bankImport/process';
import { DEFAULT_CATEGORIES } from '../src/profileData';
import { signCapability } from '../src/signed-url';
import { apiTokenRow } from './helpers/capability';
import { sessionCookie } from './helpers/session';

const USER = 740;
const PROFILE = 7400;
const OTHER_PROFILE = 7401;
const SECRET = 'test-jwt-secret-not-for-prod';
let cookie = '';

const REVOLUT_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance';

/** Fake statement lines: description, signed amount. Every name and number is made up. */
const LINES: Array<[string, number]> = [
  ['PETROL TEST STATION 0000', -40],
  ['PARKING TEST GARAGE 0000', -3],
  ['LJEKARNA TEST 0000', -9],
  ['HEP TEST INVOICE 0000', -55],
  ['ISPLATA PLACE TEST EMPLOYER', 1000],
  ['KONZUM TEST STORE 0000', -12],
];

/** Lines only the parking rule matches. */
const PARKING_LINES: Array<[string, number]> = [
  ['PARKING TEST GARAGE 0000', -3],
  ['ZET TEST TICKET 0000', -2],
];

function statement(lines: Array<[string, number]>): string {
  const rows = lines.map(([description, amount], i) => {
    const day = `2026-01-${String(i + 1).padStart(2, '0')}`;
    const kind = amount < 0 ? 'CARD_PAYMENT' : 'DEPOSIT';
    return `${kind},Current,${day} 09:00:00,${day} 09:00:05,${description},${amount.toFixed(2)},0.00,EUR,COMPLETED,0.00`;
  });
  return [REVOLUT_HEADER, ...rows].join('\n');
}

// Means of Payment is left unmapped: the test is about categories, not accounts.
const MAPPING = { date: 0, type: 1, category: 3, amount: 4, description: 6 };

beforeEach(async () => {
  for (const t of [
    'transactions',
    'account_balance_history',
    'import_logs',
    'accounts',
    'categories',
    'settings',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'rules@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Main'
    ),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      OTHER_PROFILE,
      USER,
      'Other'
    ),
    env.DB.prepare(
      "INSERT INTO accounts (name, type, currency, balance, profile_id) VALUES ('Test Giro', 'giro', 'EUR', 0, ?)"
    ).bind(PROFILE),
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
  await apiTokenRow('tok-rules', USER);
});

async function addCategory(name: string, type: 'income' | 'expense', profile = PROFILE) {
  await env.DB.prepare(
    "INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, '#6b7280', 'tag', ?)"
  )
    .bind(name, type, profile)
    .run();
}

async function seedDefaults(profile = PROFILE) {
  for (const c of DEFAULT_CATEGORIES) {
    await addCategory(c.name, c.type as 'income' | 'expense', profile);
  }
}

/** The categories a profile made from the rules before they gave default names. */
async function addOldNames(profile = PROFILE) {
  await addCategory('Car (Gas)', 'expense', profile);
  await addCategory('Transport', 'expense', profile);
  await addCategory('Health', 'expense', profile);
  await addCategory('Apartment (Bills)', 'expense', profile);
  await addCategory('Salary Eur', 'income', profile);
}

async function categoryNames(): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT name FROM categories WHERE profile_id = ?')
    .bind(PROFILE)
    .all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

/** Category name of each imported row, by description. */
async function filedUnder(): Promise<Record<string, string | null>> {
  const { results } = await env.DB.prepare(
    `SELECT t.description, c.name AS category FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.profile_id = ?`
  )
    .bind(PROFILE)
    .all<{ description: string; category: string | null }>();
  return Object.fromEntries((results ?? []).map((r) => [r.description, r.category]));
}

/** What the app sends: the session, and the profile the import writes into. */
const appHeaders = () => ({
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-Profile-Id': String(PROFILE),
});

/**
 * The Bank Imports tab, as the browser runs it on the Worker: the profile's categories as GET
 * /api/categories gives them, the statement through the rules with those names, and the rows to
 * POST /api/import/execute.
 */
async function appImport(lines: Array<[string, number]>, dryRun: boolean) {
  const listed = await SELF.fetch('https://example.com/api/categories', { headers: appHeaders() });
  expect(listed.status).toBe(200);
  const list = (await listed.json()) as Array<{ name: string; profile_id: number }>;
  const categoryNamesForRules = list.filter((c) => c.profile_id === PROFILE).map((c) => c.name);

  const parsed = await processFiles(
    [
      {
        filename: 'account-statement_test.csv',
        bytes: new TextEncoder().encode(statement(lines)),
        bankId: 'revolut',
        targetAccount: 'Test Giro',
      },
    ],
    { categoryNames: categoryNamesForRules }
  );
  expect(parsed.rows).toHaveLength(lines.length);
  return execute(parsed.rows, dryRun);
}

async function execute(rows: string[][], dryRun: boolean) {
  const res = await SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: appHeaders(),
    body: JSON.stringify({ rows, mapping: MAPPING, dry_run: dryRun }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    imported: number;
    new_categories: string[];
    created_categories: string[];
  };
}

/** The API's statement import: the file to POST /api/v1/import, categorized here. */
async function apiImport(lines: Array<[string, number]>, mode: 'preview' | 'commit') {
  const sig = await signCapability(
    { tokenId: 'tok-rules', userId: USER, profileId: PROFILE, purpose: 'import' },
    SECRET
  );
  const form = new FormData();
  form.append(
    'file',
    new File([statement(lines)], 'account-statement_test.csv', { type: 'text/csv' })
  );
  const qs = new URLSearchParams({
    sig,
    mode,
    account: 'Test Giro',
    autoCreateCategories: 'true',
  });
  const res = await SELF.fetch(`https://api.example.com/api/v1/import?${qs}`, {
    method: 'POST',
    body: form,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    parsedBy: string;
    imported: number;
    newCategories: string[];
  };
  expect(body.parsedBy).toBe('bank:revolut');
  return body;
}

const FRESH = {
  'PETROL TEST STATION 0000': 'Transportation',
  'PARKING TEST GARAGE 0000': 'Transportation',
  'LJEKARNA TEST 0000': 'Healthcare',
  'HEP TEST INVOICE 0000': 'Utilities',
  'ISPLATA PLACE TEST EMPLOYER': 'Salary',
  'KONZUM TEST STORE 0000': 'Groceries',
};

const OLD = {
  'PETROL TEST STATION 0000': 'Car (Gas)',
  'PARKING TEST GARAGE 0000': 'Transport',
  'LJEKARNA TEST 0000': 'Health',
  'HEP TEST INVOICE 0000': 'Apartment (Bills)',
  'ISPLATA PLACE TEST EMPLOYER': 'Salary Eur',
  'KONZUM TEST STORE 0000': 'Groceries',
};

describe('worker import from the Bank Imports tab: a fresh profile', () => {
  it('files the rows under the default categories and offers no second name', async () => {
    await seedDefaults();

    // Groceries sits beside main's default Food; folding it is the defaults' change, not this one.
    expect((await appImport(LINES, true)).new_categories).toEqual(['Groceries']);
    const done = await appImport(LINES, false);
    expect(done.imported).toBe(6);
    expect(await filedUnder()).toEqual(FRESH);
  });

  it('offers only default and general names in a profile with no categories at all', async () => {
    // A new cloud account starts with none: a first import proposes every rule name it meets.
    const preview = await appImport(LINES, true);
    expect(preview.new_categories.sort()).toEqual(
      ['Groceries', 'Healthcare', 'Salary', 'Transportation', 'Utilities'].sort()
    );
  });
});

describe('worker import from the Bank Imports tab: a profile made from the old rules', () => {
  it('keeps filing each rule’s rows under its old name, ahead of the defaults', async () => {
    await seedDefaults();
    await addOldNames();
    const before = (await categoryNames()).length;

    expect((await appImport(LINES, true)).new_categories).toEqual(['Groceries']);
    await appImport(LINES, false);

    expect(await filedUnder()).toEqual(OLD);
    expect((await categoryNames()).length).toBe(before + 1);
  });

  it('creates no new name beside an old one when the profile has no defaults', async () => {
    // Case-blind like every other import match.
    await addCategory('car (gas)', 'expense');
    await addCategory('TRANSPORT', 'expense');
    await addCategory('Health', 'expense');
    await addCategory('Apartment (Bills)', 'expense');
    await addCategory('SALARY EUR', 'income');

    expect((await appImport(LINES, true)).new_categories).toEqual(['Groceries']);
    expect((await appImport(LINES, false)).created_categories).toEqual(['Groceries']);

    expect(await filedUnder()).toEqual({
      ...OLD,
      'PETROL TEST STATION 0000': 'car (gas)',
      'PARKING TEST GARAGE 0000': 'TRANSPORT',
      'ISPLATA PLACE TEST EMPLOYER': 'SALARY EUR',
    });
  });

  it('keeps filing parking under Transport in a profile with no Car (Gas)', async () => {
    await seedDefaults();
    await addCategory('Transport', 'expense');

    expect((await appImport(LINES, true)).new_categories).toEqual(['Groceries']);
    await appImport(LINES, false);

    const filed = await filedUnder();
    expect(filed['PARKING TEST GARAGE 0000']).toBe('Transport');
    expect(filed['PETROL TEST STATION 0000']).toBe('Transportation');
  });

  it('offers no category to a profile with only Transport', async () => {
    await addCategory('Transport', 'expense');

    expect((await appImport(PARKING_LINES, true)).new_categories).toEqual([]);
    expect((await appImport(PARKING_LINES, false)).created_categories).toEqual([]);

    expect(await filedUnder()).toEqual({
      'PARKING TEST GARAGE 0000': 'Transport',
      'ZET TEST TICKET 0000': 'Transport',
    });
    expect(await categoryNames()).toEqual(['Transport']);
  });
});

describe('worker import from the Bank Imports tab: a category the file names itself', () => {
  it('files under that name, even beside a name the rules gave before', async () => {
    // Only a rule remembers what it gave before. A sheet or CSV that says Salary means Salary.
    await seedDefaults();
    await addCategory('Salary Eur', 'income');
    const rows = [['2026-01-05', 'Income', '', 'Salary', '1000', 'EUR', 'TEST EMPLOYER PAY']];

    expect((await execute(rows, true)).new_categories).toEqual([]);
    await execute(rows, false);

    expect(await filedUnder()).toEqual({ 'TEST EMPLOYER PAY': 'Salary' });
  });
});

describe('worker statement import (POST /api/v1/import)', () => {
  it('files a fresh profile’s rows under the default categories', async () => {
    await seedDefaults();

    expect((await apiImport(LINES, 'preview')).newCategories).toEqual(['Groceries']);
    expect((await apiImport(LINES, 'commit')).imported).toBe(6);

    expect(await filedUnder()).toEqual(FRESH);
  });

  it('keeps fuel under Car (Gas) and parking under Transport in a profile made from the old rules', async () => {
    await seedDefaults();
    await addOldNames();

    expect((await apiImport(LINES, 'preview')).newCategories).toEqual(['Groceries']);
    await apiImport(LINES, 'commit');

    expect(await filedUnder()).toEqual(OLD);
  });

  it('offers no category to a profile with only Transport', async () => {
    await addCategory('Transport', 'expense');

    expect((await apiImport(PARKING_LINES, 'preview')).newCategories).toEqual([]);
    await apiImport(PARKING_LINES, 'commit');

    expect(await filedUnder()).toEqual({
      'PARKING TEST GARAGE 0000': 'Transport',
      'ZET TEST TICKET 0000': 'Transport',
    });
    expect(await categoryNames()).toEqual(['Transport']);
  });

  it('files by the categories of the profile it imports into, not another of the user’s', async () => {
    await seedDefaults();
    await addOldNames(OTHER_PROFILE);

    expect((await apiImport(LINES, 'preview')).newCategories).toEqual(['Groceries']);
    await apiImport(LINES, 'commit');

    expect(await filedUnder()).toEqual(FRESH);
  });
});
