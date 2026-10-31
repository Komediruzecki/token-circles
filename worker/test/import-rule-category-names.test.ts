/**
 * A bank import's rule categories on the Worker (POST /api/import/execute).
 *
 * The Croatian rules give default category names, so a newcomer's first import files its rows
 * into the default categories and offers none of the names the rules used to give
 * ('Salary Eur', 'Apartment (Bills)', 'Car (Gas)'). A profile that already holds a category under
 * one of those old names keeps getting the matching rows there, and gets no second category
 * beside it. Mirrors frontend/src/core/storage/__tests__/importFlow.ruleCategoryNames.test.ts.
 * The rows are hand-written and fake; the categories come from the real rules.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { txnsToTable } from '../../shared/bankImport/canonical';
import { categorize, DEFAULT_CATEGORY_RULES } from '../../shared/bankImport/categoryRules';
import { DEFAULT_CATEGORIES } from '../src/profileData';
import { sessionCookie } from './helpers/session';
import type { CanonicalTxn } from '../../shared/bankImport/types';

const USER = 740;
const PROFILE = 7400;
let cookie = '';

const RETIRED = ['Salary Eur', 'Apartment (Bills)', 'Car (Gas)'];

/** Fake statement lines: description, signed amount. */
const LINES: Array<[string, number]> = [
  ['PETROL TEST STATION 0000', -40],
  ['HEP TEST INVOICE 0000', -55],
  ['ISPLATA PLACE TEST EMPLOYER', 1000],
  ['KONZUM TEST STORE 0000', -12],
];

function ruleRows(): string[][] {
  const txns: CanonicalTxn[] = LINES.map(([description, amount], i) => ({
    date: `2026-01-0${i + 1}`,
    type: amount < 0 ? 'Expense' : 'Income',
    meansOfPayment: 'Test Giro',
    category: categorize([description], DEFAULT_CATEGORY_RULES),
    amount: Math.abs(amount),
    currency: 'EUR',
    description,
  }));
  return txnsToTable(txns).rows;
}

// Means of Payment is left unmapped: the test is about categories, not accounts.
const MAPPING = { date: 0, type: 1, category: 3, amount: 4, description: 6 };

beforeEach(async () => {
  for (const t of [
    'transactions',
    'account_balance_history',
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
  ]);
  cookie = (await sessionCookie(USER, 'password', env)).split(';')[0];
});

async function run(dryRun: boolean) {
  const res = await SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify({ rows: ruleRows(), mapping: MAPPING, dry_run: dryRun }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    imported: number;
    new_categories: string[];
    created_categories: string[];
  };
}

async function addCategory(name: string, type: 'income' | 'expense') {
  await env.DB.prepare(
    "INSERT INTO categories (name, type, color, icon, profile_id) VALUES (?, ?, '#6b7280', 'tag', ?)"
  )
    .bind(name, type, PROFILE)
    .run();
}

async function seedDefaults() {
  for (const c of DEFAULT_CATEGORIES) await addCategory(c.name, c.type as 'income' | 'expense');
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

describe('worker import: rule categories in a fresh profile', () => {
  it('files the rule rows under the default categories and offers no old name', async () => {
    await seedDefaults();

    const preview = await run(true);
    expect(preview.new_categories).toEqual(['Groceries']);

    const done = await run(false);
    expect(done.imported).toBe(4);
    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Transportation',
      'HEP TEST INVOICE 0000': 'Utilities',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary',
      'KONZUM TEST STORE 0000': 'Groceries',
    });
    const names = await categoryNames();
    for (const old of RETIRED) expect(names).not.toContain(old);
  });

  it('offers only neutral names in a profile with no categories at all', async () => {
    // A new cloud account starts with none: a first import proposes every rule name it meets.
    const preview = await run(true);
    expect(preview.new_categories.sort()).toEqual(
      ['Groceries', 'Salary', 'Transportation', 'Utilities'].sort()
    );
  });
});

describe('worker import: a profile that holds the old names', () => {
  it('keeps filing the rows under the old names, ahead of the defaults beside them', async () => {
    await seedDefaults();
    await addCategory('Car (Gas)', 'expense');
    await addCategory('Apartment (Bills)', 'expense');
    await addCategory('Salary Eur', 'income');
    const before = (await categoryNames()).length;

    expect((await run(true)).new_categories).toEqual(['Groceries']);
    await run(false);

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'Car (Gas)',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'Salary Eur',
      'KONZUM TEST STORE 0000': 'Groceries',
    });
    expect((await categoryNames()).length).toBe(before + 1);
  });

  it('offers and creates no new name beside an old one when the profile has no defaults', async () => {
    // Case-blind like every other import match.
    await addCategory('car (gas)', 'expense');
    await addCategory('Apartment (Bills)', 'expense');
    await addCategory('SALARY EUR', 'income');

    expect((await run(true)).new_categories).toEqual(['Groceries']);
    const done = await run(false);
    expect(done.created_categories).toEqual(['Groceries']);

    expect(await filedUnder()).toEqual({
      'PETROL TEST STATION 0000': 'car (gas)',
      'HEP TEST INVOICE 0000': 'Apartment (Bills)',
      'ISPLATA PLACE TEST EMPLOYER': 'SALARY EUR',
      'KONZUM TEST STORE 0000': 'Groceries',
    });
    expect((await categoryNames()).sort()).toEqual(
      ['Apartment (Bills)', 'Groceries', 'SALARY EUR', 'car (gas)'].sort()
    );
  });
});
