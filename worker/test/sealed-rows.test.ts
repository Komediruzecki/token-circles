/**
 * The helpers every read and write path goes through (src/sealed-rows.ts), against real D1.
 * The race test is the one that matters most: it proves an edit racing the backfill lands in
 * whatever form the row is in when it runs, and never leaves plaintext inside a sealed row.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataKeyring, DataKeyUnavailableError } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import {
  changesOf,
  MUST_NAME_ON_INSERT,
  openRows,
  SEALED_COLUMNS,
  sealedUpdate,
  sealForInsert,
  textMatches,
} from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const keyed = () => new DataKeyring({ DB: env.DB, DATA_KEK_1: K });
const unkeyed = () => new DataKeyring({ DB: env.DB });
const U = 921;
const P = 9210;
const U2 = 922;
const P2 = 9220;
const TEXT = ['description', 'beneficiary', 'payor', 'notes'] as const;
type Row = Record<string, unknown>;

async function insertTx(ring: DataKeyring, owner: number, values: Row): Promise<number> {
  const row = await sealForInsert(ring, owner, 'transactions', values);
  const cols = Object.keys(row);
  const res = await env.DB.prepare(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => row[c]))
    .run();
  return Number(res.meta.last_row_id);
}

async function raw(id: number): Promise<Row> {
  return (await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<Row>())!;
}

async function insertPlain(values: Row): Promise<number> {
  const cols = Object.keys(values);
  const res = await env.DB.prepare(
    `INSERT INTO transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
  return Number(res.meta.last_row_id);
}

const BASE = { profile_id: P, amount: -42.17, type: 'expense', date: '2026-09-10' };
const TEXTS = {
  description: 'LIDL HR 0123 ZAGREB',
  beneficiary: 'Lidl Hrvatska d.o.o.',
  payor: 'Main account',
  notes: 'groceries for the week',
};

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM transactions WHERE profile_id IN (?, ?)').bind(P, P2).run();
  await env.DB.prepare('DELETE FROM profiles WHERE id IN (?, ?)').bind(P, P2).run();
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U, U2).run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (?, 'sr1@example.com', 'password')"
    ).bind(U),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider) VALUES (?, 'sr2@example.com', 'password')"
    ).bind(U2),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'SR One', ?)").bind(P, U),
    env.DB.prepare("INSERT INTO profiles (id, name, user_id) VALUES (?, 'SR Two', ?)").bind(P2, U2),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sealForInsert', () => {
  it('seals every text column when the owner has a key, and leaves amounts readable', async () => {
    const id = await insertTx(keyed(), U, { ...BASE, ...TEXTS });
    const stored = await raw(id);
    expect(stored.text_enc).toBe(1);
    for (const c of TEXT) {
      expect(String(stored[c]).startsWith(TEXT_PREFIX)).toBe(true);
      expect(String(stored[c])).not.toContain(TEXTS[c].slice(0, 6));
    }
    expect(stored.amount).toBe(-42.17);
    const [opened] = await openRows(keyed(), U, 'transactions', [stored]);
    for (const c of TEXT) expect(opened[c]).toBe(TEXTS[c]);
    expect('text_enc' in opened).toBe(false);
  });

  it('with no master key, stores plaintext at text_enc 0 — exactly as before', async () => {
    const id = await insertTx(unkeyed(), U, { ...BASE, ...TEXTS });
    const stored = await raw(id);
    expect(stored.text_enc).toBe(0);
    expect(stored.description).toBe(TEXTS.description);
  });

  it('leaves an omitted text column at its default, which opens as empty rather than failing', async () => {
    const id = await insertTx(keyed(), U, { ...BASE, description: 'Only this' });
    const stored = await raw(id);
    expect(stored.text_enc).toBe(1);
    expect(stored.notes).toBe('');
    const [opened] = await openRows(keyed(), U, 'transactions', [stored]);
    expect(opened).toMatchObject({ description: 'Only this', notes: '', payor: '' });
  });
});

describe('sealed columns and their defaults', () => {
  it('refuses to leave out a sealed column whose default is not empty', async () => {
    // tag_rules.criteria defaults to '{}': left out, that would sit unsealed in a row marked sealed.
    for (const ring of [keyed(), unkeyed()]) {
      await expect(
        sealForInsert(ring, U, 'tag_rules', { profile_id: P, tag_id: 1, name: 'rule' })
      ).rejects.toThrow('tag_rules.criteria');
    }
  });

  it('knows every sealed column whose default is not empty', async () => {
    const found: string[] = [];
    for (const [table, columns] of Object.entries(SEALED_COLUMNS)) {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
        name: string;
        dflt_value: string | null;
      }>();
      for (const column of columns) {
        const dflt = results.find((r) => r.name === column)?.dflt_value ?? null;
        if (dflt !== null && dflt !== "''" && dflt.toUpperCase() !== 'NULL') {
          found.push(`${table}.${column}`);
        }
      }
    }
    const listed = Object.entries(MUST_NAME_ON_INSERT).flatMap(([table, columns]) =>
      columns.map((column) => `${table}.${column}`)
    );
    expect(found.sort()).toEqual(listed.sort());
  });
});

describe('openRows', () => {
  it('passes plaintext rows through untouched and drops the marker', async () => {
    const id = await insertPlain({ ...BASE, ...TEXTS });
    const [opened] = await openRows(keyed(), U, 'transactions', [await raw(id)]);
    expect(opened.description).toBe(TEXTS.description);
    expect('text_enc' in opened).toBe(false);
  });

  it('opens rows that span owners, given the owner per row', async () => {
    const a = await insertTx(keyed(), U, { ...BASE, description: 'mine' });
    const b = await insertTx(keyed(), U2, { ...BASE, profile_id: P2, description: 'theirs' });
    const rows = [await raw(a), await raw(b)];
    const opened = await openRows(
      keyed(),
      (r) => (r.profile_id === P ? U : U2),
      'transactions',
      rows
    );
    expect(opened.map((r) => r.description)).toEqual(['mine', 'theirs']);
  });

  it("refuses to open one user's row under another user's key", async () => {
    const b = await insertTx(keyed(), U2, { ...BASE, profile_id: P2, description: 'theirs' });
    await keyed().forWrite(U);
    await expect(openRows(keyed(), U, 'transactions', [await raw(b)])).rejects.toThrow(
      /failed authentication/
    );
  });

  it('opens a sealed column selected under an alias', async () => {
    const id = await insertTx(keyed(), U, { ...BASE, description: 'Aliased' });
    const row = (await env.DB.prepare(
      'SELECT description AS tx_description, text_enc FROM transactions WHERE id = ?'
    )
      .bind(id)
      .first<Row>())!;
    const [opened] = await openRows(keyed(), U, 'transactions', [row], {
      aliases: { description: 'tx_description' },
    });
    expect(opened.tx_description).toBe('Aliased');
  });

  it('still opens rows selected without text_enc, and logs the SELECT that forgot it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await insertTx(keyed(), U, { ...BASE, description: 'sealed one' });
    const p = await insertPlain({ ...BASE, description: 'plain one' });
    const rows = (
      await env.DB.prepare(
        'SELECT id, description, notes FROM transactions WHERE id IN (?, ?) ORDER BY id'
      )
        .bind(s, p)
        .all<Row>()
    ).results;
    const opened = await openRows(keyed(), U, 'transactions', rows);
    expect(opened.map((r) => r.description)).toEqual(['sealed one', 'plain one']);
    expect(warn).toHaveBeenCalled();
  });

  it('fails closed on a row selected without text_enc when its key cannot be produced', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await insertTx(keyed(), U, { ...BASE, description: 'sealed one' });
    const rows = (
      await env.DB.prepare('SELECT id, description FROM transactions WHERE id = ?')
        .bind(s)
        .all<Row>()
    ).results;
    await expect(openRows(unkeyed(), U, 'transactions', rows)).rejects.toBeInstanceOf(
      DataKeyUnavailableError
    );
  });

  it('keeps a plaintext value that merely looks sealed exactly as it is', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await keyed().forWrite(U);
    const p = await insertPlain({ ...BASE, description: 'tc1.not.really' });
    const row = (await env.DB.prepare('SELECT description FROM transactions WHERE id = ?')
      .bind(p)
      .first<Row>())!;
    const [opened] = await openRows(keyed(), U, 'transactions', [row]);
    expect(opened.description).toBe('tc1.not.really');
  });
});

describe('sealedUpdate', () => {
  it('writes a sealed row sealed and a plaintext row plaintext — one row each time', async () => {
    const s = await insertTx(keyed(), U, { ...BASE, ...TEXTS });
    const p = await insertPlain({ ...BASE, ...TEXTS });

    const onSealed = await sealedUpdate(
      keyed(),
      U,
      'transactions',
      { description: 'New', amount: 5 },
      'id = ?',
      [s]
    );
    expect(changesOf(await env.DB.batch(onSealed))).toBe(1);
    const sealedRow = await raw(s);
    expect(String(sealedRow.description).startsWith(TEXT_PREFIX)).toBe(true);
    expect(sealedRow.amount).toBe(5);
    expect((await openRows(keyed(), U, 'transactions', [sealedRow]))[0].description).toBe('New');

    const onPlain = await sealedUpdate(
      keyed(),
      U,
      'transactions',
      { description: 'New' },
      'id = ?',
      [p]
    );
    expect(changesOf(await env.DB.batch(onPlain))).toBe(1);
    const plainRow = await raw(p);
    expect(plainRow.text_enc).toBe(0);
    expect(plainRow.description).toBe('New');
  });

  it('lands in the right form when the backfill flips the row between building and running it', async () => {
    const p = await insertPlain({ ...BASE, ...TEXTS });
    const edit = await sealedUpdate(keyed(), U, 'transactions', { notes: 'edited' }, 'id = ?', [p]);

    // The backfill converts the row in between.
    const cur = await raw(p);
    const flip = await sealForInsert(keyed(), U, 'transactions', {
      description: cur.description,
      beneficiary: cur.beneficiary,
      payor: cur.payor,
      notes: cur.notes,
    });
    await env.DB.prepare(
      'UPDATE transactions SET description = ?, beneficiary = ?, payor = ?, notes = ?, text_enc = 1 WHERE id = ? AND text_enc = 0'
    )
      .bind(flip.description, flip.beneficiary, flip.payor, flip.notes, p)
      .run();

    expect(changesOf(await env.DB.batch(edit))).toBe(1);
    const after = await raw(p);
    expect(after.text_enc).toBe(1);
    for (const c of TEXT) expect(String(after[c]).startsWith(TEXT_PREFIX)).toBe(true);
    const [opened] = await openRows(keyed(), U, 'transactions', [after]);
    expect(opened).toMatchObject({ ...TEXTS, notes: 'edited' });
  });

  it('is a single statement, blind to text_enc, when no sealed column changes', async () => {
    const s = await insertTx(keyed(), U, { ...BASE, description: 'x' });
    const stmts = await sealedUpdate(keyed(), U, 'transactions', { amount: 9 }, 'id = ?', [s]);
    expect(stmts).toHaveLength(1);
    expect(changesOf(await env.DB.batch(stmts))).toBe(1);
  });

  it('with no key, sends the plain form only — which misses a sealed row instead of corrupting it', async () => {
    const p = await insertPlain({ ...BASE, profile_id: P2, description: 'plain' });
    const stmts = await sealedUpdate(
      unkeyed(),
      U2,
      'transactions',
      { description: 'edited' },
      'id = ?',
      [p]
    );
    expect(stmts).toHaveLength(1);
    await env.DB.prepare('UPDATE transactions SET text_enc = 1 WHERE id = ?').bind(p).run();
    expect(changesOf(await env.DB.batch(stmts))).toBe(0);
    expect((await raw(p)).description).toBe('plain');
  });

  it('refuses to write plaintext for a user who has a key when the master key is gone', async () => {
    const s = await insertTx(keyed(), U, { ...BASE, description: 'x' });
    await expect(
      sealedUpdate(unkeyed(), U, 'transactions', { description: 'leak' }, 'id = ?', [s])
    ).rejects.toBeInstanceOf(DataKeyUnavailableError);
  });
});

describe('non-text values', () => {
  // D1 binds a JS number or boolean as REAL and the TEXT column renders it ('1234.0'); a key must
  // not change what is stored, or a keyed and a keyless deployment disagree about the same input.
  const VALUES = [1234, 12.5, 0.1, -7, 1e21, true, false];

  it('seals, on insert, exactly what the column stores without a key', async () => {
    for (const v of VALUES) {
      // U2 never gets a key; U does. A keyless write for a user with a key is refused by design.
      const plainId = await insertTx(unkeyed(), U2, {
        ...BASE,
        profile_id: P2,
        description: v,
        notes: v,
      });
      const sealedId = await insertTx(keyed(), U, { ...BASE, description: v, notes: v });
      const sealed = await raw(sealedId);
      expect(String(sealed.description).startsWith(TEXT_PREFIX)).toBe(true);
      const [plain] = await openRows(unkeyed(), U2, 'transactions', [await raw(plainId)]);
      const [opened] = await openRows(keyed(), U, 'transactions', [sealed]);
      expect(typeof plain.description, String(v)).toBe('string');
      expect([opened.description, opened.notes], String(v)).toEqual([
        plain.description,
        plain.notes,
      ]);
    }
    const [one] = await openRows(unkeyed(), U2, 'transactions', [
      await raw(await insertTx(unkeyed(), U2, { ...BASE, profile_id: P2, description: 1234 })),
    ]);
    expect(one.description).toBe('1234.0');
  });

  it('seals, on update, exactly what the column stores without a key', async () => {
    for (const v of VALUES) {
      const plainId = await insertTx(unkeyed(), U2, { ...BASE, profile_id: P2, ...TEXTS });
      const sealedId = await insertTx(keyed(), U, { ...BASE, ...TEXTS });
      for (const [ring, owner, id] of [
        [unkeyed(), U2, plainId],
        [keyed(), U, sealedId],
      ] as const) {
        await env.DB.batch(
          await sealedUpdate(ring, owner, 'transactions', { description: v }, 'id = ?', [id])
        );
      }
      const [plain] = await openRows(unkeyed(), U2, 'transactions', [await raw(plainId)]);
      const [opened] = await openRows(keyed(), U, 'transactions', [await raw(sealedId)]);
      expect(opened.description, String(v)).toBe(plain.description);
    }
  });
});

describe('textMatches', () => {
  it('matches a query the way D1 does: a lone surrogate as the U+FFFD stored in its place', async () => {
    const d1 = await env.DB.prepare("SELECT ('caf' || char(65533)) LIKE ('%' || ? || '%') AS hit")
      .bind('caf\ud800')
      .first<{ hit: number }>();
    expect(d1?.hit).toBe(1);
    const stored = `caf${String.fromCodePoint(0xfffd)}`; // what D1 stores for 'caf\ud800'
    expect(textMatches({ description: stored }, ['description'], 'caf\ud800')).toBe(true);
  });

  it('folds case across Unicode and takes % and _ literally', () => {
    expect(textMatches({ description: 'Čevapi Ž' }, ['description'], 'čeVAPI')).toBe(true);
    expect(textMatches({ description: '50% off' }, ['description'], '%')).toBe(true);
    expect(textMatches({ description: 'abc' }, ['description'], '_')).toBe(false);
    expect(
      textMatches({ description: null, notes: 'Pharmacy' }, ['description', 'notes'], 'pharm')
    ).toBe(true);
    expect(textMatches({ description: 'anything' }, ['description'], '')).toBe(true);
  });
});
