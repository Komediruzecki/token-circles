/**
 * The backfill (src/backfill.ts): the only place an existing row changes form. It seals every
 * plaintext row in the database, so this file starts from empty sealed tables and leaves them
 * empty — otherwise it would hand keys to other test files' users in the shared D1.
 */
import { env } from 'cloudflare:test';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFieldEncryptionBackfill, sealStatements } from '../src/backfill';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { receiptBytes } from '../src/sealed-objects';
import { changesOf, openRows } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { DB: env.DB, RECEIPTS: env.RECEIPTS!, DATA_KEK_1: K };
const BIG = { ms: 60_000, rows: 5_000, receipts: 50 };
const U1 = 931;
const P1 = 9310;
const U2 = 932;
const P2 = 9320;
const P0 = 9330; // nobody owns it
type Row = Record<string, unknown>;

async function wipe(): Promise<void> {
  for (const t of ['receipts', 'transactions', 'recurring_transactions', 'bills']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?, ?)').bind(P1, P2, P0).run();
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U1, U2).run();
}

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (?, 'bf1@example.com', 'password')"
    ).bind(U1),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (?, 'bf2@example.com', 'password')"
    ).bind(U2),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'BF One', ?)").bind(P1, U1),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'BF Two', ?)").bind(P2, U2),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'BF Legacy', NULL)").bind(
      P0
    ),
  ]);
}

async function tx(profile: number, description: string, extra: Row = {}): Promise<number> {
  const values: Row = {
    profile_id: profile,
    description,
    amount: -10,
    type: 'expense',
    date: '2026-09-01',
    ...extra,
  };
  const cols = Object.keys(values);
  const res = await env.DB.prepare(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
  return Number(res.meta.last_row_id);
}

async function row(table: string, id: number): Promise<Row> {
  return (await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Row>())!;
}

beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await wipe();
  await seed();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await wipe();
});

describe('field-encryption backfill', () => {
  it('does nothing at all without a master key', async () => {
    const id = await tx(P1, 'Pharmacy');
    expect(await runFieldEncryptionBackfill({ DB: env.DB, RECEIPTS: env.RECEIPTS! })).toBeNull();
    expect(await row('transactions', id)).toMatchObject({ text_enc: 0, description: 'Pharmacy' });
  });

  it('seals every owned row in all three tables, and each opens to exactly what it was', async () => {
    const texts = { beneficiary: 'Ljekarna d.o.o.', payor: 'Main', notes: 'prescription' };
    const a = await tx(P1, 'Pharmacy', texts);
    const b = await tx(P1, 'Rent');
    const c = await tx(P2, 'Salary');
    const rec = Number(
      (
        await env.DB.prepare(
          "INSERT INTO recurring_transactions (profile_id, description, amount, notes) VALUES (?, 'Gym', -30, 'monthly')"
        )
          .bind(P1)
          .run()
      ).meta.last_row_id
    );
    const bill = Number(
      (
        await env.DB.prepare(
          "INSERT INTO bills (profile_id, name, amount, due_date, notes) VALUES (?, 'Electricity', 55, '2026-09-15', 'HEP')"
        )
          .bind(P1)
          .run()
      ).meta.last_row_id
    );

    const stats = await runFieldEncryptionBackfill(KEYED, BIG);
    expect(stats).toMatchObject({
      sealed: { transactions: 3, recurring_transactions: 1, bills: 1, receipts: 0 },
      missed: 0,
      failedOwners: [],
      complete: true,
    });

    const ring = new DataKeyring(KEYED);
    const stored = await row('transactions', a);
    expect(stored.text_enc).toBe(1);
    for (const col of ['description', 'beneficiary', 'payor', 'notes']) {
      expect(String(stored[col]).startsWith(TEXT_PREFIX)).toBe(true);
    }
    expect((await openRows(ring, U1, 'transactions', [stored]))[0]).toMatchObject({
      description: 'Pharmacy',
      ...texts,
    });
    expect(
      (await openRows(ring, U1, 'transactions', [await row('transactions', b)]))[0].description
    ).toBe('Rent');
    expect(
      (await openRows(ring, U2, 'transactions', [await row('transactions', c)]))[0].description
    ).toBe('Salary');
    expect(
      (
        await openRows(ring, U1, 'recurring_transactions', [
          await row('recurring_transactions', rec),
        ])
      )[0]
    ).toMatchObject({
      description: 'Gym',
      notes: 'monthly',
    });
    expect((await openRows(ring, U1, 'bills', [await row('bills', bill)]))[0]).toMatchObject({
      name: 'Electricity',
      notes: 'HEP',
    });
  });

  it('leaves rows on a profile nobody owns as plaintext — there is no key to seal them under', async () => {
    const legacy = await tx(P0, 'Legacy row');
    await runFieldEncryptionBackfill(KEYED, BIG);
    expect(await row('transactions', legacy)).toMatchObject({
      text_enc: 0,
      description: 'Legacy row',
    });
  });

  it('is idempotent: a second run seals nothing', async () => {
    await tx(P1, 'Once');
    await runFieldEncryptionBackfill(KEYED, BIG);
    const again = await runFieldEncryptionBackfill(KEYED, BIG);
    expect(again!.sealed).toEqual({
      transactions: 0,
      recurring_transactions: 0,
      bills: 0,
      receipts: 0,
    });
  });

  it('stops at its row budget and resumes where it stopped', async () => {
    for (let i = 0; i < 5; i++) await tx(P1, `row ${i}`);
    const small = { ...BIG, rows: 2 };
    expect((await runFieldEncryptionBackfill(KEYED, small))!).toMatchObject({
      sealed: { transactions: 2 },
      complete: false,
    });
    expect((await runFieldEncryptionBackfill(KEYED, small))!.sealed.transactions).toBe(2);
    expect((await runFieldEncryptionBackfill(KEYED, BIG))!).toMatchObject({
      sealed: { transactions: 1 },
      complete: true,
    });
  });

  it('does not overwrite a row edited after it was read: the compare-and-set misses, then a later run seals the edit', async () => {
    const id = await tx(P1, 'Original');
    const rows = (
      await env.DB.prepare(
        'SELECT t.id, p.user_id AS owner, t.description, t.beneficiary, t.payor, t.notes FROM transactions t JOIN profiles p ON p.id = t.profile_id WHERE t.id = ?'
      )
        .bind(id)
        .all<Row & { id: number; owner: number }>()
    ).results;
    const ring = new DataKeyring(KEYED);
    const statements = await sealStatements(ring, 'transactions', rows, new Set());

    await env.DB.prepare("UPDATE transactions SET description = 'Edited meanwhile' WHERE id = ?")
      .bind(id)
      .run();
    expect(changesOf(await env.DB.batch(statements))).toBe(0);
    expect(await row('transactions', id)).toMatchObject({
      text_enc: 0,
      description: 'Edited meanwhile',
    });

    await runFieldEncryptionBackfill(KEYED, BIG);
    const [opened] = await openRows(ring, U1, 'transactions', [await row('transactions', id)]);
    expect(opened.description).toBe('Edited meanwhile');
  });

  it('skips a user whose key cannot be produced, and still seals everyone else', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mine = await tx(P1, 'Seal me');
    const theirs = await tx(P2, 'Leave me');
    await env.DB.prepare("UPDATE users SET dek_wrapped = 'dk1.1.AAAA.AAAA' WHERE id = ?")
      .bind(U2)
      .run();
    const stats = await runFieldEncryptionBackfill(KEYED, BIG);
    expect(stats!.failedOwners).toEqual([U2]);
    expect(stats!.complete).toBe(false);
    expect((await row('transactions', mine)).text_enc).toBe(1);
    expect(await row('transactions', theirs)).toMatchObject({
      text_enc: 0,
      description: 'Leave me',
    });
  });

  it("does not let a user whose key fails use up every run's budget", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // U2's rows come first by id, and there are more of them than one run's budget.
    for (let i = 0; i < 4; i++) await tx(P2, `stuck ${i}`);
    const mine = await tx(P1, 'Seal me');
    await env.DB.prepare("UPDATE users SET dek_wrapped = 'dk1.1.AAAA.AAAA' WHERE id = ?")
      .bind(U2)
      .run();
    const stats = await runFieldEncryptionBackfill(KEYED, { ...BIG, rows: 2 });
    expect(stats!.sealed.transactions).toBe(1);
    expect((await row('transactions', mine)).text_enc).toBe(1);
  });

  it('reseals a receipt under a new key, swaps the row to it, and deletes the plaintext original', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(3000));
    const key = `${P1}/bf-receipt.png`;
    await env.RECEIPTS!.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
    const rid = Number(
      (
        await env.DB.prepare(
          "INSERT INTO receipts (filename, original_name, file_type, file_size, storage_path, profile_id) VALUES (?, 'r.png', 'image/png', ?, ?, ?)"
        )
          .bind(key, bytes.length, key, P1)
          .run()
      ).meta.last_row_id
    );

    const stats = await runFieldEncryptionBackfill(KEYED, BIG);
    expect(stats!.sealed.receipts).toBe(1);
    const stored = await row('receipts', rid);
    expect(stored.enc).toBe(1);
    expect(String(stored.storage_path).startsWith(`${key}.sealed-`)).toBe(true);
    expect(stored.filename).toBe(key); // the /file/:filename route still finds it
    expect(await env.RECEIPTS!.get(key)).toBeNull();

    const sealedObj = await env.RECEIPTS!.get(String(stored.storage_path));
    const head = new Uint8Array(await sealedObj!.arrayBuffer()).slice(0, 4);
    expect(new TextDecoder().decode(head)).toBe('TCE1');
    const again = await env.RECEIPTS!.get(String(stored.storage_path));
    expect(await receiptBytes(new DataKeyring(KEYED), U1, again!, 1)).toEqual(bytes);
    await env.RECEIPTS!.delete(String(stored.storage_path));
  });

  it('leaves a receipt whose object is missing exactly as it was', async () => {
    const rid = Number(
      (
        await env.DB.prepare(
          "INSERT INTO receipts (filename, original_name, file_type, file_size, storage_path, profile_id) VALUES ('gone', 'g.png', 'image/png', 1, ?, ?)"
        )
          .bind(`${P1}/does-not-exist.png`, P1)
          .run()
      ).meta.last_row_id
    );
    await runFieldEncryptionBackfill(KEYED, BIG);
    expect(await row('receipts', rid)).toMatchObject({
      enc: 0,
      storage_path: `${P1}/does-not-exist.png`,
    });
  });

  it('re-wraps data keys onto the newest master key and reports the rotation', async () => {
    // Versions no other test file uses: every other file's key is under DATA_KEK_1, which these
    // envs lack, so each one is counted as stale and left exactly as it is.
    const before = { DB: env.DB, RECEIPTS: env.RECEIPTS!, DATA_KEK_7: K };
    const rotating = {
      ...before,
      DATA_KEK_8: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    };
    await new DataKeyring(before).forWrite(U1);
    const others = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE dek_wrapped IS NOT NULL AND id NOT IN (?, ?)'
    )
      .bind(U1, U2)
      .first<{ n: number }>())!.n;

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stats = await runFieldEncryptionBackfill(rotating, BIG);
    expect(stats).toMatchObject({
      rewrapped: 1,
      rewrapFailed: others,
      staleKeys: others,
      complete: others === 0,
    });
    expect(String((await row('users', U1)).dek_wrapped)).toMatch(/^dk1\.8\./);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(`rewrapped=1 rewrapFailed=${others} staleKeys=${others}`)
    );
  });
});
