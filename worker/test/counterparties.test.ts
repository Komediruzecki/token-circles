/**
 * GET /api/counterparties groups transactions by beneficiary (expenses) and payor (income). With
 * field encryption on, those columns may be ciphertext — a fresh IV per value, so equal names are
 * unequal bytes — and the grouping moves out of SQL into JS. These tests pin the result to the
 * unencrypted expectation, in both suite modes and with a key forced on, over a MIX of sealed rows
 * and rows the backfill has not reached yet.
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

// Read only through SELF, with plaintext rows: passes whichever mode the suite runs in.
const U_PLAIN = 53001;
const P_PLAIN = 530010;
// Read only through KEYED: this user gets a data key, and a keyless read of it would 503.
const U_KEYED = 53002;
const P_KEYED = 530020;
const P_KEYED2 = 530021;

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

/** Stored exactly as a write through KEYED would store it. */
async function insertSealed(values: Row): Promise<number> {
  const ring = new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
  const row = await sealForInsert(ring, U_KEYED, 'transactions', values);
  expect(row.text_enc).toBe(1);
  return insert(row);
}

async function cookieFor(userId: number): Promise<string> {
  return (await issueSessionCookie(userId, 'password', env)).split(';')[0];
}

function keyedGet(path: string, headers: Record<string, string>): Promise<Response> {
  return app.fetch(
    new Request(`https://example.com${path}`, { headers }),
    KEYED,
    createExecutionContext()
  );
}

// Expense rows count by beneficiary, income rows by payor; '' and NULL are no counterparty, a
// transfer is neither, and the amount is the base-currency one (amount_local when set).
const DATASET: Row[] = [
  { type: 'expense', beneficiary: 'Lidl', amount: 10, date: '2026-03-01' },
  { type: 'expense', beneficiary: 'Lidl', amount: 5.5, date: '2026-03-02' },
  {
    type: 'expense',
    beneficiary: 'Konzum',
    payor: 'Me',
    amount: 150,
    amount_local: 20,
    currency: 'HRK',
    date: '2026-03-03',
  },
  { type: 'expense', beneficiary: '', amount: 99, date: '2026-03-04' },
  { type: 'income', payor: 'Employer', amount: 1000, date: '2026-03-05' },
  { type: 'expense', beneficiary: null, amount: 7, date: '2026-03-06' },
  { type: 'income', payor: 'Lidl', beneficiary: 'Nobody', amount: 3, date: '2026-03-07' },
  { type: 'transfer', beneficiary: 'Savings', payor: 'Savings', amount: 50, date: '2026-03-08' },
];

const EXPECTED = [
  { name: 'Employer', incoming: 1000, outgoing: 0, net: 1000, transaction_count: 1 },
  { name: 'Konzum', incoming: 0, outgoing: 20, net: -20, transaction_count: 1 },
  { name: 'Lidl', incoming: 3, outgoing: 15.5, net: -12.5, transaction_count: 3 },
];

beforeEach(async () => {
  const pids = [P_PLAIN, P_KEYED, P_KEYED2];
  const users = [U_PLAIN, U_KEYED];
  await env.DB.prepare(`DELETE FROM transactions WHERE profile_id IN (?, ?, ?)`)
    .bind(...pids)
    .run();
  await env.DB.prepare(`DELETE FROM profiles WHERE id IN (?, ?, ?)`)
    .bind(...pids)
    .run();
  await env.DB.prepare(`DELETE FROM users WHERE id IN (?, ?)`)
    .bind(...users)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'cp-plain@example.com', 'password', 1)"
    ).bind(U_PLAIN),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'cp-keyed@example.com', 'password', 1)"
    ).bind(U_KEYED),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_PLAIN,
      U_PLAIN
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(
      P_KEYED,
      U_KEYED
    ),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Partner')").bind(
      P_KEYED2,
      U_KEYED
    ),
  ]);
});

describe('GET /api/counterparties', () => {
  it('groups plaintext rows by counterparty, whichever mode the suite runs in', async () => {
    for (const row of DATASET) await insert({ ...row, profile_id: P_PLAIN });
    const res = await SELF.fetch('https://example.com/api/counterparties', {
      headers: { Cookie: await cookieFor(U_PLAIN), 'X-Profile-Id': String(P_PLAIN) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED);
  });

  it('with a key: groups a mix of sealed and plaintext rows exactly as the plaintext would', async () => {
    // Alternate the forms, and the profiles, so every counterparty spans both.
    for (const [i, row] of DATASET.entries()) {
      const values = { ...row, profile_id: i % 3 === 0 ? P_KEYED2 : P_KEYED };
      if (i % 2 === 0) await insertSealed(values);
      else await insert(values);
    }

    const sealed = (
      await env.DB.prepare(
        'SELECT beneficiary, payor FROM transactions WHERE profile_id IN (?, ?) AND text_enc = 1'
      )
        .bind(P_KEYED, P_KEYED2)
        .all<{ beneficiary: string | null; payor: string | null }>()
    ).results;
    expect(sealed).toHaveLength(4);
    const stored = sealed.flatMap((r) => [r.beneficiary, r.payor]).filter((v) => v);
    expect(stored.length).toBeGreaterThan(0);
    for (const v of stored) expect(String(v).startsWith(TEXT_PREFIX)).toBe(true);

    const res = await keyedGet('/api/counterparties', {
      Cookie: await cookieFor(U_KEYED),
      'X-Profile-Id': String(P_KEYED),
      'X-Profile-Ids': JSON.stringify([P_KEYED, P_KEYED2]),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EXPECTED);
  });

  it('with a key: breaks ties and merges trimmed names exactly as the SQL path does', async () => {
    // Zeta, Alpha and Mid tie on |net| and go in out of name order, so the result's order comes
    // from GROUP BY's. 'Acme' and 'Acme ' trim to one name, which the merge lets overwrite rather
    // than add — a quirk kept identical on both paths, not fixed on one of them.
    const rows: Row[] = [
      { type: 'expense', beneficiary: 'Zeta', amount: 10, date: '2026-03-01' },
      { type: 'expense', beneficiary: 'Alpha', amount: 10, date: '2026-03-02' },
      { type: 'expense', beneficiary: 'Mid', amount: 10, date: '2026-03-03' },
      { type: 'expense', beneficiary: 'Acme ', amount: 8, date: '2026-03-04' },
      { type: 'expense', beneficiary: 'Acme', amount: 7, date: '2026-03-05' },
      { type: 'income', payor: 'Acme', amount: 1, date: '2026-03-06' },
      { type: 'income', payor: ' Acme', amount: 2, date: '2026-03-07' },
    ];
    for (const row of rows) await insert({ ...row, profile_id: P_PLAIN });
    for (const [i, row] of rows.entries()) {
      const values = { ...row, profile_id: P_KEYED };
      if (i % 2 === 0) await insertSealed(values);
      else await insert(values);
    }

    // In a keyless run this is the original SQL, so the comparison below is SQL against JS.
    const plainRes = await SELF.fetch('https://example.com/api/counterparties', {
      headers: { Cookie: await cookieFor(U_PLAIN), 'X-Profile-Id': String(P_PLAIN) },
    });
    const keyedRes = await keyedGet('/api/counterparties', {
      Cookie: await cookieFor(U_KEYED),
      'X-Profile-Id': String(P_KEYED),
    });
    expect([plainRes.status, keyedRes.status]).toEqual([200, 200]);
    const plain = await plainRes.json();
    expect(await keyedRes.json()).toEqual(plain);
    expect(plain).toEqual([
      { name: 'Alpha', incoming: 0, outgoing: 10, net: -10, transaction_count: 1 },
      { name: 'Mid', incoming: 0, outgoing: 10, net: -10, transaction_count: 1 },
      { name: 'Zeta', incoming: 0, outgoing: 10, net: -10, transaction_count: 1 },
      { name: 'Acme', incoming: 1, outgoing: 8, net: -7, transaction_count: 3 },
    ]);
  });
});
