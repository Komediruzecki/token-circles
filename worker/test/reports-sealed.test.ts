/**
 * The tax summary returns each transaction's description, which field encryption may have sealed.
 * It must come back opened, in the report's own order, with the totals untouched; the P&L summary
 * no longer reads a sealed column at all.
 */
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { sealForInsert } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };

const U_PLAIN = 53021;
const P_PLAIN = 530210;
const U_KEYED = 53022;
const P_KEYED = 530220;

type Row = Record<string, unknown>;

async function insert(values: Row): Promise<number> {
  const cols = Object.keys(values);
  const res = await env.DB.prepare(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
  return Number(res.meta.last_row_id);
}

async function insertSealed(values: Row): Promise<number> {
  const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
  const row = await sealForInsert(ring, U_KEYED, 'transactions', values);
  expect(row.text_enc).toBe(1);
  return insert(row);
}

async function cookieFor(userId: number): Promise<string> {
  return (await issueSessionCookie(userId, 'password', env)).split(';')[0];
}

/** Category ids are profile id * 10 + n, so the two profiles never collide. */
const cat = (profileId: number, n: 1 | 2 | 3) => profileId * 10 + n;

async function seed(profileId: number, sealedAlso: boolean): Promise<void> {
  const tx = (values: Row, seal: boolean) =>
    seal && sealedAlso
      ? insertSealed({ ...values, profile_id: profileId })
      : insert({ ...values, profile_id: profileId });
  await tx(
    {
      category_id: cat(profileId, 1),
      description: 'Printer paper',
      amount: 30,
      type: 'expense',
      date: '2025-02-01',
    },
    true
  );
  await tx(
    {
      category_id: cat(profileId, 1),
      description: 'Laptop stand',
      amount: 45,
      type: 'expense',
      date: '2025-01-15',
    },
    false
  );
  await tx(
    {
      category_id: cat(profileId, 2),
      description: 'Weekly shop',
      amount: 80,
      type: 'expense',
      date: '2025-03-01',
    },
    true
  );
  await tx(
    {
      category_id: cat(profileId, 3),
      description: 'Payroll',
      amount: 2000,
      type: 'income',
      date: '2025-01-31',
    },
    false
  );
  // Outside the year: in neither report.
  await tx(
    {
      category_id: cat(profileId, 1),
      description: 'Old desk',
      amount: 999,
      type: 'expense',
      date: '2024-12-31',
    },
    true
  );
}

function expectTaxSummary(body: Row): void {
  expect(body.taxDeductibleTotal).toBe(75);
  expect(body.nonDeductibleTotal).toBe(80);
  expect(body.totalExpenses).toBe(155);
  expect(body.transactionCount).toBe(3);
  const ded = body.taxDeductibleCategories as Record<
    string,
    { total: number; transactions: Row[] }
  >;
  const non = body.nonDeductibleCategories as Record<
    string,
    { total: number; transactions: Row[] }
  >;
  expect(Object.keys(ded)).toEqual(['Office']);
  expect(Object.keys(non)).toEqual(['Groceries']);
  expect(ded.Office.total).toBe(75);
  // Ordered by date within the category, exactly as the SQL returns them.
  expect(ded.Office.transactions.map((t) => [t.date, t.description])).toEqual([
    ['2025-01-15', 'Laptop stand'],
    ['2025-02-01', 'Printer paper'],
  ]);
  expect(non.Groceries.transactions.map((t) => t.description)).toEqual(['Weekly shop']);
  for (const t of [...ded.Office.transactions, ...non.Groceries.transactions]) {
    expect(Object.keys(t).sort()).toEqual(['amount', 'currency', 'date', 'description', 'id']);
  }
}

function expectPl(body: Row): void {
  expect(body.income).toEqual({ total: 2000, byCategory: { Salary: { total: 2000, count: 1 } } });
  expect(body.expenses).toEqual({
    total: 155,
    byCategory: { Groceries: { total: 80, count: 1 }, Office: { total: 75, count: 2 } },
  });
  expect(body.netSavings).toBe(1845);
  expect(body.transactionCount).toBe(4);
}

beforeEach(async () => {
  const pids = [P_PLAIN, P_KEYED];
  await env.DB.prepare('DELETE FROM transactions WHERE profile_id IN (?, ?)')
    .bind(...pids)
    .run();
  await env.DB.prepare('DELETE FROM categories WHERE profile_id IN (?, ?)')
    .bind(...pids)
    .run();
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)')
    .bind(...pids)
    .run();
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U_PLAIN, U_KEYED).run();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'rep-plain@example.com', 'password', 1, 'basic')"
    ).bind(U_PLAIN),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'rep-keyed@example.com', 'password', 1, 'basic')"
    ).bind(U_KEYED),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_PLAIN,
      U_PLAIN
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_KEYED,
      U_KEYED
    ),
  ];
  for (const pid of pids) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO categories (id, profile_id, name, type, tax_deductible) VALUES (?, ?, 'Office', 'expense', 1), (?, ?, 'Groceries', 'expense', 0), (?, ?, 'Salary', 'income', 0)"
      ).bind(cat(pid, 1), pid, cat(pid, 2), pid, cat(pid, 3), pid)
    );
  }
  await env.DB.batch(stmts);
});

describe('year-end reports, whichever mode the suite runs in', () => {
  it('tax summary and P&L over plaintext rows', async () => {
    await seed(P_PLAIN, false);
    const headers = { Cookie: await cookieFor(U_PLAIN), 'X-Profile-Id': String(P_PLAIN) };
    const tax = await SELF.fetch('https://example.com/api/reports/tax-summary?year=2025', {
      headers,
    });
    expect(tax.status).toBe(200);
    expectTaxSummary((await tax.json()) as Row);
    const pl = await SELF.fetch('https://example.com/api/reports/pl-summary?year=2025', {
      headers,
    });
    expect(pl.status).toBe(200);
    expectPl((await pl.json()) as Row);
  });
});

describe('year-end reports with a key', () => {
  it('opens sealed descriptions in a mix of sealed and plaintext rows', async () => {
    await seed(P_KEYED, true);
    const raw = (
      await env.DB.prepare(
        'SELECT description FROM transactions WHERE profile_id = ? AND text_enc = 1'
      )
        .bind(P_KEYED)
        .all<{ description: string }>()
    ).results;
    expect(raw).toHaveLength(3);
    for (const r of raw) expect(r.description.startsWith(TEXT_PREFIX)).toBe(true);

    const cookie = await cookieFor(U_KEYED);
    const get = (path: string) =>
      app.fetch(
        new Request(`https://example.com${path}`, {
          headers: { Cookie: cookie, 'X-Profile-Id': String(P_KEYED) },
        }),
        KEYED,
        createExecutionContext()
      );
    const tax = await get('/api/reports/tax-summary?year=2025');
    expect(tax.status).toBe(200);
    expectTaxSummary((await tax.json()) as Row);
    const pl = await get('/api/reports/pl-summary?year=2025');
    expect(pl.status).toBe(200);
    expectPl((await pl.json()) as Row);
  });
});
