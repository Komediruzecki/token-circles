/**
 * The transactions routes with field encryption ON, whatever mode the suite runs in.
 *
 * description, beneficiary, payor and notes are sealed at rest once a deployment has a master key,
 * so the list's search, text sorts, window and count — and the summary's searched totals — run in
 * JS over opened rows instead of in SQL. The contract pinned here is that none of that is visible:
 * the same data answers every query exactly as the plaintext SQL path does, including a user whose
 * rows are a MIX of sealed and not-yet-backfilled plaintext, and nothing sealed ever leaves the API.
 *
 * Parity is checked against a twin: user B holds the same rows, all plaintext, read through a
 * deployment with NO key — the SQL path exactly as it ran before encryption existed. Hand-written
 * expectations back up the comparison, so two equally wrong answers cannot agree.
 *
 * Users here only ever go through KEYED (A) or never get a key at all (B): a user keyed under K and
 * then read without it gets a 503 by design, which one test below pins.
 */
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { issueSessionCookie } from '../src/auth';
import { DataKeyring } from '../src/data-keys';
import { openRows, sealForInsert } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K } as typeof env;
const KEYLESS = { ...env, DATA_KEK_1: undefined } as typeof env;

const A = 50001; // keyed: every even row sealed, every odd row still plaintext
const B = 50002; // keyless twin: the same rows, all plaintext
const ACCOUNT: Record<number, number> = { [A]: 50011, [B]: 50012 };
const BASE: Record<number, number> = { [A]: 500100, [B]: 500200 };
const cookies: Record<number, string> = {};

type Seed = [
  date: string,
  type: string,
  amount: number,
  amountLocal: number | null,
  description: string,
  beneficiary: string | null,
  payor: string | null,
  notes: string | null,
];

// Duplicates (0/8) exercise the id tiebreak; case (COFFEE / Coffee / coffee, apple) exercises
// BINARY order; '' and NULL exercise where empty and missing sort; row 2 carries amount_local.
const ROWS: Seed[] = [
  ['2026-01-05', 'expense', 12.5, null, 'Coffee Shop', 'Bean Bar', '', 'morning coffee'],
  ['2026-01-06', 'income', 1000, null, 'Salary', '', 'ACME Corp', ''],
  ['2026-01-07', 'expense', 40, 30, 'groceries', 'Market', '', null],
  ['2026-01-08', 'expense', 7.25, null, 'coffee beans', 'bean bar', null, 'Weekly'],
  ['2026-01-09', 'transfer', 200, null, 'Savings', '', '', 'to savings'],
  ['2026-01-10', 'expense', 3.1, null, 'COFFEE', '', '', ''],
  ['2026-01-11', 'expense', 15, null, 'Books', 'Bookshop', '', 'gift for coffee lover'],
  ['2026-01-12', 'income', 50.75, null, 'Refund', '', 'Bean Bar', ''],
  ['2026-01-12', 'expense', 9.99, null, 'Coffee Shop', 'Zebra', '', ''],
  ['2026-01-13', 'expense', 22, null, 'apple', '', '', ''],
  ['2026-01-14', 'expense', 5, null, '', 'Übermarkt', '', ''],
  ['2026-01-15', 'expense', 1, null, 'Bean Bar tab', 'x', 'y', ''],
];

async function cleanup(): Promise<void> {
  const profiles = '(50001, 50002)';
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id IN ${profiles})`
    ),
    env.DB.prepare(`DELETE FROM tag_rules WHERE profile_id IN ${profiles}`),
    env.DB.prepare(`DELETE FROM tags WHERE profile_id IN ${profiles}`),
    env.DB.prepare(`DELETE FROM transactions WHERE profile_id IN ${profiles}`),
    env.DB.prepare(`DELETE FROM accounts WHERE profile_id IN ${profiles}`),
    env.DB.prepare(`DELETE FROM profiles WHERE id IN ${profiles}`),
    env.DB.prepare(`DELETE FROM users WHERE id IN ${profiles}`),
  ]);
}

async function insertRow(user: number, id: number, seed: Seed, seal: boolean): Promise<void> {
  const [date, type, amount, amountLocal, description, beneficiary, payor, notes] = seed;
  const plain = { description, beneficiary, payor, notes };
  const text = seal
    ? await sealForInsert(new DataKeyring(KEYED), user, 'transactions', plain)
    : { ...plain, text_enc: 0 };
  await env.DB.prepare(
    `INSERT INTO transactions
       (id, profile_id, account_id, date, type, amount, amount_local,
        description, beneficiary, payor, notes, text_enc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user,
      ACCOUNT[user],
      date,
      type,
      amount,
      amountLocal,
      text.description,
      text.beneficiary,
      text.payor,
      text.notes,
      text.text_enc
    )
    .run();
}

beforeEach(async () => {
  await cleanup();
  for (const user of [A, B]) {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, ?, 'password', 1)"
      ).bind(user, `enc-${user}@example.com`),
      env.DB.prepare('INSERT INTO profiles (id, name, user_id) VALUES (?, ?, ?)').bind(
        user,
        'Primary',
        user
      ),
      env.DB.prepare(
        "INSERT INTO accounts (id, name, type, balance, starting_balance, profile_id) VALUES (?, 'Checking', 'giro', 0, 0, ?)"
      ).bind(ACCOUNT[user], user),
    ]);
    cookies[user] = (await issueSessionCookie(user, 'password', env)).split(';')[0];
  }
  for (let i = 0; i < ROWS.length; i++) {
    await insertRow(A, BASE[A] + i, ROWS[i], i % 2 === 0);
    await insertRow(B, BASE[B] + i, ROWS[i], false);
  }
});

async function call(
  user: number,
  path: string,
  init: RequestInit = {},
  deployment: typeof env = user === A ? KEYED : KEYLESS
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://example.com${path}`, {
      ...init,
      headers: {
        Cookie: cookies[user],
        'X-Profile-Id': String(user),
        'Content-Type': 'application/json',
      },
    }),
    deployment,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function json<T>(user: number, path: string, init: RequestInit = {}): Promise<T> {
  const res = await call(user, path, init);
  expect(res.status, `${path} as user ${user}`).toBe(200);
  return (await res.json()) as T;
}

/** Raw D1 rows for user A, with their stored (sealed) text and marker. */
async function stored(ids: number[]): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, description, beneficiary, payor, notes, text_enc FROM transactions
      WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
  )
    .bind(...ids)
    .all<Record<string, unknown>>();
  return results;
}

/** The same rows, opened under K — what the API should be showing for them. */
async function opened(ids: number[]): Promise<Record<string, unknown>[]> {
  return openRows(new DataKeyring(KEYED), A, 'transactions', await stored(ids), {
    keepMarker: true,
  });
}

type ListRow = Record<string, unknown> & { id: number };
type ListBody = { rows: ListRow[]; total: number; limit: number | null; offset: number };

function shape(user: number, body: ListBody) {
  return {
    total: body.total,
    limit: body.limit,
    offset: body.offset,
    rows: body.rows.map((r) => ({
      k: r.id - BASE[user],
      date: r.date,
      type: r.type,
      amount: r.amount,
      amount_local: r.amount_local,
      description: r.description,
      beneficiary: r.beneficiary,
      payor: r.payor,
      notes: r.notes,
      tags: r.tags,
    })),
  };
}

const keys = (body: ListBody) => body.rows.map((r) => r.id - BASE[A]);

describe('field encryption — the seed really is mixed', () => {
  it('stores even rows sealed and odd rows plaintext for the keyed user', async () => {
    const rows = await stored([BASE[A], BASE[A] + 1]);
    expect(rows[0].text_enc).toBe(1);
    expect(String(rows[0].description)).toMatch(/^tc1\./);
    expect(String(rows[0].notes)).toMatch(/^tc1\./);
    // '' stays unsealed on purpose, even in a sealed row.
    expect(rows[0].payor).toBe('');
    expect(rows[1]).toMatchObject({ text_enc: 0, description: 'Salary' });
  });
});

describe('GET /api/transactions — sealed rows answer exactly like plaintext SQL', () => {
  const QUERIES = [
    '',
    '?search=coffee',
    '?search=COFFEE&sort=description&order=asc',
    '?search=bean',
    '?search=bean&limit=2',
    '?search=bean&limit=2&offset=1',
    '?search=bean&offset=2',
    '?search=bar&type=expense',
    '?search=e&sort=amount&order=asc',
    '?search=coffee&startDate=2026-01-06&endDate=2026-01-12',
    '?search=coffee&limit=abc',
    '?search=nothing-matches-this',
    '?sort=description&order=asc',
    '?sort=description&order=desc',
    '?sort=description',
    '?sort=beneficiary&order=asc',
    '?sort=beneficiary&order=desc&limit=4',
    '?sort=payor&order=asc',
    '?sort=payor&order=desc',
    '?sort=payor&order=asc&limit=3&offset=2',
    '?sort=payor&order=desc&limit=2&type=expense&startDate=2026-01-07',
    '?sort=description&limit=0',
    '?sort=beneficiary&limit=-1&offset=3',
    '?sort=description&offset=10',
    '?sort=amount&order=asc&limit=3',
    '?limit=5&offset=2',
  ];

  for (const q of QUERIES) {
    it(`matches the plaintext path for "${q || '(no query)'}"`, async () => {
      const keyed = await json<ListBody>(A, `/api/transactions${q}`);
      const plain = await json<ListBody>(B, `/api/transactions${q}`);
      expect(shape(A, keyed)).toEqual(shape(B, plain));
      for (const row of keyed.rows) {
        expect(row).not.toHaveProperty('text_enc');
        for (const f of ['description', 'beneficiary', 'payor', 'notes']) {
          expect(String(row[f] ?? '')).not.toMatch(/^tc1\./);
        }
      }
    });
  }

  it('searches all four fields, case-insensitively, in the default date order', async () => {
    const body = await json<ListBody>(A, '/api/transactions?search=coffee');
    expect(keys(body)).toEqual([8, 6, 5, 3, 0]);
    expect(body.total).toBe(5);
  });

  it('sorts text by code unit (BINARY), ties by id in the same direction', async () => {
    const asc = await json<ListBody>(A, '/api/transactions?sort=description&order=asc');
    expect(keys(asc)).toEqual([10, 11, 6, 5, 0, 8, 7, 1, 4, 9, 3, 2]);
    const desc = await json<ListBody>(A, '/api/transactions?sort=description&order=desc');
    expect(keys(desc)).toEqual([2, 3, 9, 4, 1, 7, 8, 0, 5, 6, 11, 10]);
  });

  it('puts NULL first ascending, then empty strings, then text', async () => {
    const body = await json<ListBody>(A, '/api/transactions?sort=payor&order=asc');
    expect(keys(body)).toEqual([3, 0, 2, 4, 5, 6, 8, 9, 10, 1, 7, 11]);
  });

  it('windows and counts the searched set, not the table', async () => {
    const body = await json<ListBody>(A, '/api/transactions?search=bean&limit=2&offset=1');
    // bean: 0 (beneficiary), 3 (description + beneficiary), 7 (payor), 11 (description)
    expect(body.total).toBe(4);
    expect(keys(body)).toEqual([7, 3]);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });
});

describe('GET /api/transactions/summary — searched totals match', () => {
  const QUERIES = [
    '',
    '?search=coffee',
    '?search=bean&type=expense',
    '?search=market',
    '?search=e&startDate=2026-01-07',
    '?search=nothing-matches-this',
    '?type=income',
  ];

  for (const q of QUERIES) {
    it(`matches the plaintext aggregate for "${q || '(no query)'}"`, async () => {
      const keyed = await json<Record<string, number>>(A, `/api/transactions/summary${q}`);
      const plain = await json<Record<string, number>>(B, `/api/transactions/summary${q}`);
      expect(keyed).toEqual(plain);
    });
  }

  it('sums base-currency values of the matched rows', async () => {
    const coffee = await json<Record<string, number>>(A, '/api/transactions/summary?search=coffee');
    expect(coffee.count).toBe(5);
    expect(coffee.total_income).toBe(0);
    expect(coffee.total_expense).toBeCloseTo(12.5 + 7.25 + 3.1 + 15 + 9.99, 10);
    // Row 2 is 40 in its own currency and 30 in the base one; the summary counts the 30.
    const market = await json<Record<string, number>>(A, '/api/transactions/summary?search=market');
    expect(market).toMatchObject({ count: 1, total_amount: 30, total_expense: 30 });
  });
});

describe('fails closed', () => {
  it('refuses a keyed user on a deployment without the key, instead of serving ciphertext', async () => {
    const res = await call(A, '/api/transactions', {}, KEYLESS);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toMatch(/tc1\./);
  });
});

describe('POST /api/transactions — sealed at rest, plaintext out', () => {
  it('seals the text fields, returns them opened, and GET /:id agrees', async () => {
    const created = await json<Record<string, unknown>>(A, '/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Latte',
        amount: 4.5,
        type: 'expense',
        account_id: ACCOUNT[A],
        beneficiary: 'Cafe',
        notes: 'oat milk',
        date: '2026-02-01',
      }),
    });
    expect(created).toMatchObject({
      description: 'Latte',
      beneficiary: 'Cafe',
      payor: '',
      notes: 'oat milk',
    });
    expect(created).not.toHaveProperty('text_enc');

    const [raw] = await stored([created.id as number]);
    expect(raw.text_enc).toBe(1);
    expect(String(raw.description)).toMatch(/^tc1\./);
    expect(String(raw.beneficiary)).toMatch(/^tc1\./);
    expect(String(raw.notes)).toMatch(/^tc1\./);
    expect(raw.payor).toBe('');

    const got = await json<Record<string, unknown>>(A, `/api/transactions/${created.id}`);
    expect(got).toMatchObject({ description: 'Latte', beneficiary: 'Cafe', notes: 'oat milk' });
    expect(got).not.toHaveProperty('text_enc');
  });

  it('hands the tag rules the opened row, so a text rule still tags the new transaction', async () => {
    const tag = await env.DB.prepare(
      "INSERT INTO tags (profile_id, name, color) VALUES (?, 'Caffeine', '#000000')"
    )
      .bind(A)
      .run();
    const tagId = Number(tag.meta.last_row_id);
    await env.DB.prepare(
      'INSERT INTO tag_rules (profile_id, tag_id, name, criteria, auto_apply) VALUES (?, ?, ?, ?, 1)'
    )
      .bind(
        A,
        tagId,
        'Lattes',
        JSON.stringify({ match: 'all', description: 'latte', descriptionMode: 'contains' })
      )
      .run();

    const created = await json<{ id: number }>(A, '/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Morning Latte',
        amount: 4,
        type: 'expense',
        account_id: ACCOUNT[A],
      }),
    });
    const link = await env.DB.prepare(
      'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?'
    )
      .bind(created.id)
      .first<{ tag_id: number }>();
    expect(link?.tag_id).toBe(tagId);
  });
});

describe('PUT /api/transactions/:id — each row keeps its form', () => {
  const sealedId = BASE[A]; // row 0, sealed
  const plainId = BASE[A] + 1; // row 1, plaintext

  it('writes ciphertext into a sealed row and plaintext into a plaintext row', async () => {
    for (const id of [sealedId, plainId]) {
      await json(A, `/api/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ description: `renamed ${id}`, notes: null }),
      });
    }
    const [s, p] = await stored([sealedId, plainId]);
    expect(s.text_enc).toBe(1);
    expect(String(s.description)).toMatch(/^tc1\./);
    expect(s.notes).toBe(''); // notes || '' — and '' is never sealed
    // Not converted: a row changes form only in the backfill.
    expect(p).toMatchObject({ text_enc: 0, description: `renamed ${plainId}`, notes: '' });

    const [os] = await opened([sealedId]);
    expect(os.description).toBe(`renamed ${sealedId}`);
    const got = await json<Record<string, unknown>>(A, `/api/transactions/${sealedId}`);
    expect(got.description).toBe(`renamed ${sealedId}`);
  });

  it('leaves the sealed columns byte-for-byte alone when no text field is edited', async () => {
    const [before] = await stored([sealedId]);
    await json(A, `/api/transactions/${sealedId}`, {
      method: 'PUT',
      body: JSON.stringify({ amount: 99 }),
    });
    const [after] = await stored([sealedId]);
    expect(after).toEqual(before);
  });

  it('writes no text when the concurrency guard refuses the edit', async () => {
    const [before] = await stored([sealedId]);
    // A rival edit to the amount lands between this PUT's read of the row and its batch.
    const racing = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (stmts: D1PreparedStatement[]) => {
            await target
              .prepare('UPDATE transactions SET amount = amount + 1 WHERE id = ?')
              .bind(sealedId)
              .run();
            return target.batch(stmts);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const res = await call(
      A,
      `/api/transactions/${sealedId}`,
      { method: 'PUT', body: JSON.stringify({ amount: 77, description: 'lost the race' }) },
      { ...KEYED, DB: racing } as typeof env
    );
    expect(res.status).toBe(409);
    const [after] = await stored([sealedId]);
    expect(after.description).toBe(before.description);
    expect((await opened([sealedId]))[0].description).toBe('Coffee Shop');
  });

  it("never writes text into another user's row", async () => {
    const res = await call(A, `/api/transactions/${BASE[B]}`, {
      method: 'PUT',
      body: JSON.stringify({ description: 'hijack' }),
    });
    expect(res.status).toBe(404);
    const [twin] = await stored([BASE[B]]);
    expect(twin).toMatchObject({ text_enc: 0, description: 'Coffee Shop' });
  });
});

describe('PUT /api/transactions/bulk — sealed and plaintext rows together', () => {
  it('updates both forms, keeps each in its form, and counts every row', async () => {
    const ids = [BASE[A], BASE[A] + 1, BASE[A] + 2, BASE[A] + 3];
    const res = await json<{ updated: number }>(A, '/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids, action: 'update', data: { notes: 'bulk note', reconciled: 1 } }),
    });
    expect(res.updated).toBe(4);
    const raw = await stored(ids);
    expect(raw.map((r) => r.text_enc)).toEqual([1, 0, 1, 0]);
    expect(String(raw[0].notes)).toMatch(/^tc1\./);
    expect(raw[1].notes).toBe('bulk note');
    expect((await opened(ids)).map((r) => r.notes)).toEqual([
      'bulk note',
      'bulk note',
      'bulk note',
      'bulk note',
    ]);
    const list = await json<ListBody>(A, '/api/transactions?search=bulk%20note');
    expect(keys(list).sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it('chunks a large selection under the bind limit', async () => {
    const extra: number[] = [];
    for (let i = 0; i < 100; i++) {
      const id = BASE[A] + 1000 + i;
      extra.push(id);
      await insertRow(
        A,
        id,
        ['2026-03-01', 'expense', 1, null, `bulk ${i}`, '', '', ''],
        i % 2 === 0
      );
    }
    const res = await json<{ updated: number }>(A, '/api/transactions/bulk', {
      method: 'PUT',
      body: JSON.stringify({ ids: extra, action: 'update', data: { description: 'same' } }),
    });
    expect(res.updated).toBe(100);
    const rows = await opened(extra);
    expect(rows.every((r) => r.description === 'same')).toBe(true);
    expect(rows.filter((r) => r.text_enc === 1)).toHaveLength(50);
  });
});
