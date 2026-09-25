/**
 * The dashboard returns raw transaction rows (t.*) and bill rows (b.*). Since migration 0031 those
 * carry text_enc, and with field encryption on their text may be ciphertext: both responses must
 * come back opened, in the same order, and without the marker.
 */
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { sealForInsert, type SealedTable } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };

const U_PLAIN = 53011;
const P_PLAIN = 530110;
const U_KEYED = 53012;
const P_KEYED = 530120;

type Row = Record<string, unknown>;

async function insert(table: SealedTable, values: Row): Promise<number> {
  const cols = Object.keys(values);
  const res = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
  return Number(res.meta.last_row_id);
}

async function insertSealed(table: SealedTable, values: Row): Promise<number> {
  const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
  const row = await sealForInsert(ring, U_KEYED, table, values);
  expect(row.text_enc).toBe(1);
  return insert(table, row);
}

async function cookieFor(userId: number): Promise<string> {
  return (await issueSessionCookie(userId, 'password', env)).split(';')[0];
}

const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const TX = {
  coffee: {
    description: 'Coffee at Kavana',
    beneficiary: 'Kavana d.o.o.',
    payor: '',
    notes: 'with Ana',
    amount: 3.2,
    type: 'expense',
    date: '2026-03-05',
  },
  bread: {
    description: 'Bread',
    beneficiary: 'Pekara',
    amount: 1.5,
    type: 'expense',
    date: '2026-03-05',
  },
  salary: {
    description: 'Salary March',
    payor: 'Employer Ltd',
    notes: 'net',
    amount: 2000,
    type: 'income',
    date: '2026-03-10',
  },
  rent: {
    description: 'Rent',
    beneficiary: 'Landlord',
    notes: 'March rent',
    amount: 700,
    type: 'expense',
    date: '2026-03-01',
  },
};
const BILLS = {
  power: { name: 'Electricity', notes: 'HEP', amount: 60, due_date: daysFromNow(3) },
  internet: { name: 'Internet', notes: '', amount: 25, due_date: daysFromNow(10) },
  water: { name: 'Water', notes: 'Vodovod', amount: 18, due_date: daysFromNow(20) },
  later: { name: 'Insurance', notes: 'yearly', amount: 300, due_date: daysFromNow(45) },
};
const TEXT_COLS = ['description', 'beneficiary', 'payor', 'notes'] as const;

/** The dashboard's order (date DESC, id DESC): salary, then bread before coffee (higher id). */
async function seed(profileId: number, sealedAlso: boolean): Promise<void> {
  const tx = (values: Row, seal: boolean) =>
    seal && sealedAlso
      ? insertSealed('transactions', { ...values, profile_id: profileId })
      : insert('transactions', { ...values, profile_id: profileId });
  await tx(TX.coffee, true);
  await tx(TX.bread, false);
  await tx(TX.salary, true);
  await tx(TX.rent, false);
  const bill = (values: Row, seal: boolean) =>
    seal && sealedAlso
      ? insertSealed('bills', { ...values, profile_id: profileId })
      : insert('bills', { ...values, profile_id: profileId });
  await bill(BILLS.power, true);
  await bill(BILLS.internet, false);
  await bill(BILLS.water, true);
  await bill(BILLS.later, true);
}

function expectTransactions(rows: Row[]): void {
  expect(rows.map((r) => r.description)).toEqual([
    'Salary March',
    'Bread',
    'Coffee at Kavana',
    'Rent',
  ]);
  const byDesc = new Map(rows.map((r) => [r.description, r]));
  for (const tx of Object.values(TX)) {
    const got = byDesc.get(tx.description)!;
    for (const col of TEXT_COLS) expect(got[col]).toBe((tx as Row)[col] ?? '');
    expect(got).not.toHaveProperty('text_enc');
    expect(got.category_name).toBeNull();
  }
}

function expectBills(rows: Row[]): void {
  expect(rows.map((r) => r.name)).toEqual(['Electricity', 'Internet', 'Water']);
  expect(rows.map((r) => r.notes)).toEqual(['HEP', '', 'Vodovod']);
  for (const r of rows) {
    expect(r).not.toHaveProperty('text_enc');
    expect(r.profile_name).toBe('Main');
  }
}

beforeEach(async () => {
  for (const table of ['transactions', 'bills']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE profile_id IN (?, ?)`)
      .bind(P_PLAIN, P_KEYED)
      .run();
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(P_PLAIN, P_KEYED).run();
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U_PLAIN, U_KEYED).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'dash-plain@example.com', 'password', 1)"
    ).bind(U_PLAIN),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'dash-keyed@example.com', 'password', 1)"
    ).bind(U_KEYED),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_PLAIN,
      U_PLAIN
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_KEYED,
      U_KEYED
    ),
  ]);
});

describe('dashboard rows, whichever mode the suite runs in', () => {
  it('returns recent transactions and upcoming bills without the text_enc marker', async () => {
    await seed(P_PLAIN, false);
    const headers = { Cookie: await cookieFor(U_PLAIN), 'X-Profile-Id': String(P_PLAIN) };

    const res = await SELF.fetch('https://example.com/api/dashboard?year=2026&month=3', {
      headers,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recentTransactions: Row[]; upcomingBills: Row[] };
    expectTransactions(body.recentTransactions);
    expectBills(body.upcomingBills);

    const summary = await SELF.fetch(
      'https://example.com/api/dashboard/summary?year=2026&month=3',
      {
        headers,
      }
    );
    expect(summary.status).toBe(200);
    expectTransactions(((await summary.json()) as { recent: Row[] }).recent);
  });
});

describe('dashboard rows with a key', () => {
  it('opens a mix of sealed and plaintext rows, in the same order', async () => {
    await seed(P_KEYED, true);

    const rawTx = (
      await env.DB.prepare(
        'SELECT description, beneficiary, payor, notes FROM transactions WHERE profile_id = ? AND text_enc = 1'
      )
        .bind(P_KEYED)
        .all<Row>()
    ).results;
    expect(rawTx).toHaveLength(2);
    for (const r of rawTx) {
      expect(String(r.description).startsWith(TEXT_PREFIX)).toBe(true);
      expect(String(r.notes).startsWith(TEXT_PREFIX)).toBe(true);
    }
    const rawBills = (
      await env.DB.prepare('SELECT name, notes FROM bills WHERE profile_id = ? AND text_enc = 1')
        .bind(P_KEYED)
        .all<Row>()
    ).results;
    expect(rawBills).toHaveLength(3);
    for (const r of rawBills) expect(String(r.name).startsWith(TEXT_PREFIX)).toBe(true);

    const cookie = await cookieFor(U_KEYED);
    const get = (path: string) =>
      app.fetch(
        new Request(`https://example.com${path}`, {
          headers: { Cookie: cookie, 'X-Profile-Id': String(P_KEYED) },
        }),
        KEYED,
        createExecutionContext()
      );

    const res = await get('/api/dashboard?year=2026&month=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recentTransactions: Row[]; upcomingBills: Row[] };
    expectTransactions(body.recentTransactions);
    expectBills(body.upcomingBills);

    const summary = await get('/api/dashboard/summary?year=2026&month=3');
    expect(summary.status).toBe(200);
    expectTransactions(((await summary.json()) as { recent: Row[] }).recent);
  });
});
