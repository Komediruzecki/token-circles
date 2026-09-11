/**
 * The free text migration 0033 seals — notes on accounts, goals, housing, holdings and loan
 * prepayments, the patterns auto-categorization learns, and tag-rule criteria — with field
 * encryption FORCED on, whatever mode the suite runs in: stored sealed, returned as plaintext by
 * every route that returns it, and edited in whichever form the row is in.
 *
 * U writes only through KEYED, so its key is always under K. U2 never gets a key: it writes through
 * KEYLESS and is read through both.
 */
import app from '../src/index';
import { createExecutionContext, env } from 'cloudflare:test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';
import { exportBackup, restoreBackup } from '../src/backup';
import { DataKeyring } from '../src/data-keys';
import { TEXT_PREFIX } from '../src/field-crypto';
import { openRows, type SealedTable } from '../src/sealed-rows';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };
const { DATA_KEK_1: _suiteKek, ...KEYLESS } = env as typeof env & { DATA_KEK_1?: string };

const U = 58101; // holds a data key, under K
const P = 58111;
const U2 = 58102; // never gets a key
const P2 = 58112;

type Row = Record<string, any>;
type Env = typeof KEYED | typeof KEYLESS;

const cookies: Record<number, string> = {};

// Children before their parents: savings_goals and category_mappings reference categories, and
// tag_rules references tags.
const PROFILE_TABLES = [
  'category_mappings',
  'savings_goals',
  'retirement_goals',
  'housings',
  'portfolio_holdings',
  'tag_rules',
  'accounts',
  'transactions',
  'tags',
  'categories',
  'loans',
  'settings',
];

/** Every row of both users, in every profile they hold — a restore gives U new profile ids. */
async function purge(): Promise<void> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM profiles WHERE user_id IN (?, ?) OR id IN (?, ?)'
  )
    .bind(U, U2, P, P2)
    .all<{ id: number }>();
  for (const { id } of results) {
    await env.DB.prepare(
      'DELETE FROM loan_prepayments WHERE loan_id IN (SELECT id FROM loans WHERE profile_id = ?)'
    )
      .bind(id)
      .run();
    await env.DB.prepare(
      'DELETE FROM transaction_tags WHERE transaction_id IN (SELECT id FROM transactions WHERE profile_id = ?)'
    )
      .bind(id)
      .run();
    for (const t of PROFILE_TABLES) {
      await env.DB.prepare(`DELETE FROM ${t} WHERE profile_id = ?`).bind(id).run();
    }
    await env.DB.prepare('DELETE FROM profiles WHERE id = ?').bind(id).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(U, U2).run();
}

beforeEach(async () => {
  await purge();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'sealed-notes@example.com', 'password', 1, 'basic')"
    ).bind(U),
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version, plan) VALUES (?, 'sealed-notes-2@example.com', 'password', 1, 'basic')"
    ).bind(U2),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(P, U),
    env.DB.prepare("INSERT INTO profiles (id, user_id, name) VALUES (?, ?, 'Main')").bind(P2, U2),
  ]);
  cookies[U] = (await issueSessionCookie(U, 'password', env)).split(';')[0];
  cookies[U2] = (await issueSessionCookie(U2, 'password', env)).split(';')[0];
});

// The D1 is shared: rows sealed under K must not outlive this file.
afterAll(purge);

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  opts: { user?: number; env?: Env } = {}
): Promise<Response> {
  const user = opts.user ?? U;
  return app.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: {
        Cookie: cookies[user]!,
        'Content-Type': 'application/json',
        'X-Profile-Id': String(user === U ? P : P2),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    opts.env ?? KEYED,
    createExecutionContext()
  );
}

/** A 2xx body — and proof that no response carries the marker or ciphertext. */
async function json<T = Row>(res: Promise<Response>): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect(r.status, text).toBeLessThan(300);
  expect(text).not.toContain('text_enc');
  expect(text).not.toContain(TEXT_PREFIX);
  return JSON.parse(text) as T;
}

async function stored(table: SealedTable, id: number): Promise<Row> {
  return (await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<Row>())!;
}

/** The stored row opened under K, marker kept. */
async function opened(table: SealedTable, id: number): Promise<Row> {
  const [row] = await openRows(new DataKeyring(KEYED), U, table, [await stored(table, id)], {
    keepMarker: true,
  });
  return row;
}

const isSealed = (v: unknown) => typeof v === 'string' && v.startsWith(TEXT_PREFIX);

async function insert(sql: string, ...params: unknown[]): Promise<number> {
  return Number(
    (
      await env.DB.prepare(sql)
        .bind(...params)
        .run()
    ).meta.last_row_id
  );
}

describe('notes with encryption on', () => {
  it('accounts: sealed on create and on edit, text in every read and in the export', async () => {
    const { id } = await json<{ id: number }>(
      call('POST', '/api/accounts', { name: 'Giro', notes: 'joint account', starting_balance: 100 })
    );
    expect((await stored('accounts', id)).text_enc).toBe(1);
    expect(isSealed((await stored('accounts', id)).notes)).toBe(true);
    expect(await json<Row[]>(call('GET', '/api/accounts'))).toEqual([
      expect.objectContaining({ id, notes: 'joint account' }),
    ]);
    expect(await json(call('GET', `/api/accounts/${id}`))).toMatchObject({
      notes: 'joint account',
    });
    expect(await json<Row[]>(call('GET', '/api/export/accounts?format=json'))).toEqual([
      expect.objectContaining({ name: 'Giro', notes: 'joint account' }),
    ]);

    await json(call('PUT', `/api/accounts/${id}`, { notes: 'closed in May' }));
    expect(await opened('accounts', id)).toMatchObject({ text_enc: 1, notes: 'closed in May' });
    // An edit that leaves notes out leaves them as they are.
    await json(call('PUT', `/api/accounts/${id}`, { name: 'Main giro' }));
    expect(await opened('accounts', id)).toMatchObject({
      name: 'Main giro',
      notes: 'closed in May',
    });
  });

  it('accounts: a row the backfill has not reached is edited as plaintext and read as it is', async () => {
    await new DataKeyring(KEYED).forWrite(U);
    const id = await insert(
      "INSERT INTO accounts (name, notes, profile_id) VALUES ('Cash', 'wallet', ?)",
      P
    );
    await json(call('PUT', `/api/accounts/${id}`, { notes: 'kitchen drawer' }));
    expect(await stored('accounts', id)).toMatchObject({ text_enc: 0, notes: 'kitchen drawer' });
    expect(await json(call('GET', `/api/accounts/${id}`))).toMatchObject({
      notes: 'kitchen drawer',
    });
  });

  it('savings and retirement goals: sealed on create and on edit, text in every read', async () => {
    const { id: goal } = await json<{ id: number }>(
      call('POST', '/api/savings-goals', {
        name: 'Trip',
        target_amount: 900,
        notes: 'shared with partner',
      })
    );
    expect(isSealed((await stored('savings_goals', goal)).notes)).toBe(true);
    expect(await json<Row[]>(call('GET', '/api/savings-goals'))).toEqual([
      expect.objectContaining({ id: goal, notes: 'shared with partner' }),
    ]);
    await json(call('PUT', `/api/savings-goals/${goal}`, { notes: 'booked' }));
    await json(call('PUT', `/api/savings-goals/${goal}`, { name: 'Summer trip' }));
    expect(await opened('savings_goals', goal)).toMatchObject({
      text_enc: 1,
      name: 'Summer trip',
      notes: 'booked',
    });
    expect((await call('PUT', '/api/savings-goals/999999', { notes: 'x' })).status).toBe(404);

    const { id: pension } = await json<{ id: number }>(
      call('POST', '/api/retirement-goals', {
        name: 'Pension',
        target_amount: 100000,
        notes: 'second pillar',
      })
    );
    expect(isSealed((await stored('retirement_goals', pension)).notes)).toBe(true);
    expect((await json<{ goals: Row[] }>(call('GET', '/api/retirement-goals'))).goals).toEqual([
      expect.objectContaining({ id: pension, notes: 'second pillar' }),
    ]);
    await json(
      call('PUT', `/api/retirement-goals/${pension}`, {
        name: 'Pension',
        target_amount: 120000,
        current_amount: 5000,
        notes: 'third pillar too',
      })
    );
    expect(await opened('retirement_goals', pension)).toMatchObject({
      text_enc: 1,
      target_amount: 120000,
      notes: 'third pillar too',
    });
  });

  it('housing and holdings: sealed on create and on edit, text in every read', async () => {
    const { id: home } = await json<{ id: number }>(
      call('POST', '/api/housing', {
        property_name: 'Flat',
        monthly_amount: 700,
        notes: 'heating included',
      })
    );
    expect(isSealed((await stored('housings', home)).notes)).toBe(true);
    expect((await json<{ housings: Row[] }>(call('GET', '/api/housing'))).housings).toEqual([
      expect.objectContaining({ id: home, notes: 'heating included' }),
    ]);
    await json(
      call('PUT', `/api/housing/${home}`, {
        property_name: 'Flat',
        monthly_amount: 750,
        notes: 'heating extra',
      })
    );
    expect(await opened('housings', home)).toMatchObject({
      text_enc: 1,
      monthly_amount: 750,
      notes: 'heating extra',
    });

    const holding = await json<Row>(
      call('POST', '/api/portfolio/holdings', {
        ticker: 'vwce',
        shares: 10,
        purchase_price: 100,
        purchase_date: '2026-01-02',
        notes: 'monthly plan',
      })
    );
    expect(holding).toMatchObject({ ticker: 'VWCE', notes: 'monthly plan' });
    expect(isSealed((await stored('portfolio_holdings', holding.id)).notes)).toBe(true);
    expect(await json<Row[]>(call('GET', '/api/portfolio/holdings'))).toEqual([
      expect.objectContaining({ notes: 'monthly plan' }),
    ]);
    expect(
      (await json<{ holdings: Row[] }>(call('GET', '/api/portfolio/summary'))).holdings
    ).toEqual([expect.objectContaining({ notes: 'monthly plan' })]);
    // An edit that leaves notes out must not send the stored — sealed — value back to be sealed.
    expect(
      await json(call('PUT', `/api/portfolio/holdings/${holding.id}`, { shares: 12 }))
    ).toMatchObject({ shares: 12, notes: 'monthly plan' });
    expect(await opened('portfolio_holdings', holding.id)).toMatchObject({ notes: 'monthly plan' });
    expect(
      await json(call('PUT', `/api/portfolio/holdings/${holding.id}`, { notes: 'sold half' }))
    ).toMatchObject({ shares: 12, notes: 'sold half' });
  });

  it('loan prepayments: sealed on create, text in the loan and in its schedule', async () => {
    const { id: loan } = await json<{ id: number }>(
      call('POST', '/api/loans', {
        name: 'Car',
        principal: 10000,
        interest_rate: 5,
        start_date: '2026-01-01',
        term_months: 24,
      })
    );
    const { id: prepayment } = await json<{ id: number }>(
      call('POST', `/api/loans/${loan}/prepayments`, { month: 3, amount: 500, note: 'bonus' })
    );
    expect(isSealed((await stored('loan_prepayments', prepayment)).note)).toBe(true);
    expect(
      (await json<{ prepayments: Row[] }>(call('GET', `/api/loans/${loan}`))).prepayments
    ).toEqual([expect.objectContaining({ month: 3, note: 'bonus' })]);
    expect(JSON.stringify(await json(call('POST', `/api/loans/${loan}/calculate`, {})))).toContain(
      '"note":"bonus"'
    );
  });

  it('learned category patterns: sealed, and found again by value to count a second use', async () => {
    const category = await insert(
      "INSERT INTO categories (name, type, profile_id) VALUES ('Food', 'expense', ?)",
      P
    );
    const first = await json(
      call('POST', '/api/categories/mappings', { pattern: 'market', category_id: category })
    );
    expect(first).toMatchObject({ ok: true, use_count: 1 });
    expect(isSealed((await stored('category_mappings', first.id)).pattern)).toBe(true);
    // Equal text seals to unequal ciphertext: this lookup can no longer happen in SQL.
    expect(
      await json(
        call('POST', '/api/categories/mappings', { pattern: ' market ', category_id: category })
      )
    ).toMatchObject({ id: first.id, use_count: 2 });
    expect(await json<Row[]>(call('GET', '/api/categories/mappings'))).toEqual([
      expect.objectContaining({
        id: first.id,
        pattern: 'market',
        use_count: 2,
        category_name: 'Food',
      }),
    ]);

    // The learned pattern is what matches this transaction, so it has to be opened to match.
    const tx = await insert(
      "INSERT INTO transactions (profile_id, description, amount, type, date) VALUES (?, 'MARKET 42', -12, 'expense', '2026-09-01')",
      P
    );
    expect(
      JSON.stringify(
        await json(call('POST', '/api/categories/auto-map', { transaction_ids: [tx] }))
      )
    ).toContain(`"proposed_category_id":${category}`);
    await json(
      call('POST', '/api/categories/apply-mappings', {
        mappings: [{ transaction_id: tx, category_id: category, pattern: 'Market' }],
      })
    );
    expect(await json<Row[]>(call('GET', '/api/categories/mappings'))).toEqual([
      expect.objectContaining({ id: first.id, use_count: 3 }),
    ]);

    // One request that learns the same pattern twice: the second finds the first in memory and
    // bumps it, instead of inserting a copy.
    await json(
      call('POST', '/api/categories/apply-mappings', {
        mappings: [
          { transaction_id: tx, category_id: category, pattern: 'Market!' },
          { transaction_id: tx, category_id: category, pattern: 'Bakery' },
          { transaction_id: tx, category_id: category, pattern: 'BAKERY' },
        ],
      })
    );
    const learned = await json<Row[]>(call('GET', '/api/categories/mappings'));
    expect(learned.map((m) => [m.pattern, m.use_count]).sort()).toEqual([
      ['bakery', 2],
      ['market', 4],
    ]);
  });

  it('tag rules: criteria sealed on save and on edit, parsed on read, and still applied', async () => {
    const tag = await insert("INSERT INTO tags (name, profile_id) VALUES ('Bakery', ?)", P);
    const rule = await json(
      call('POST', '/api/tags/rules', {
        tag_id: tag,
        name: 'bread',
        criteria: { match: 'all', description: 'pastry' },
      })
    );
    expect(rule.criteria).toMatchObject({ description: 'pastry' });
    expect(isSealed((await stored('tag_rules', rule.id)).criteria)).toBe(true);

    await json(
      call('PUT', `/api/tags/rules/${rule.id}`, {
        name: 'bread',
        criteria: { match: 'all', description: 'bakery' },
      })
    );
    expect(isSealed((await stored('tag_rules', rule.id)).criteria)).toBe(true);
    expect(await json<Row[]>(call('GET', '/api/tags/rules'))).toEqual([
      expect.objectContaining({
        id: rule.id,
        criteria: expect.objectContaining({ description: 'bakery' }),
      }),
    ]);
    expect((await call('PUT', '/api/tags/rules/999999', { name: 'x', criteria: {} })).status).toBe(
      404
    );

    const { id: tx } = await json<{ id: number }>(
      call('POST', '/api/transactions', {
        description: 'Corner Bakery',
        amount: 4,
        date: '2026-09-02',
        type: 'expense',
      })
    );
    const { results } = await env.DB.prepare(
      'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?'
    )
      .bind(tx)
      .all();
    expect(results).toEqual([{ tag_id: tag }]);
  });

  it('a user with no key: all of it stays plaintext, and reads the same through either env', async () => {
    const category = await insert(
      "INSERT INTO categories (name, type, profile_id) VALUES ('Food', 'expense', ?)",
      P2
    );
    const plain = { user: U2, env: KEYLESS };
    const { id: account } = await json<{ id: number }>(
      call('POST', '/api/accounts', { name: 'Giro', notes: 'plain note' }, plain)
    );
    const mapping = await json(
      call('POST', '/api/categories/mappings', { pattern: 'market', category_id: category }, plain)
    );
    await json(
      call('POST', '/api/categories/mappings', { pattern: 'market', category_id: category }, plain)
    );
    expect(await stored('accounts', account)).toMatchObject({ text_enc: 0, notes: 'plain note' });
    expect(await stored('category_mappings', mapping.id)).toMatchObject({
      text_enc: 0,
      pattern: 'market',
      use_count: 2,
    });
    for (const via of [KEYED, KEYLESS]) {
      const as = { user: U2, env: via };
      expect(await json(call('GET', `/api/accounts/${account}`, undefined, as))).toMatchObject({
        notes: 'plain note',
      });
      expect(await json<Row[]>(call('GET', '/api/categories/mappings', undefined, as))).toEqual([
        expect.objectContaining({ pattern: 'market', use_count: 2 }),
      ]);
    }
    // The same repeated-pattern request on the SQL path: the same answer.
    await json(
      call(
        'POST',
        '/api/categories/apply-mappings',
        {
          mappings: [
            { transaction_id: 0, category_id: category, pattern: 'Bakery' },
            { transaction_id: 0, category_id: category, pattern: 'bakery' },
          ],
        },
        plain
      )
    );
    const learned = await json<Row[]>(call('GET', '/api/categories/mappings', undefined, plain));
    expect(learned.map((m) => [m.pattern, m.use_count]).sort()).toEqual([
      ['bakery', 2],
      ['market', 2],
    ]);
    const key = await env.DB.prepare('SELECT dek_wrapped FROM users WHERE id = ?').bind(U2).first();
    expect(key).toEqual({ dek_wrapped: null });
  });

  it('a backup carries the text and never the ciphertext, and a restore seals it again', async () => {
    const category = await insert(
      "INSERT INTO categories (name, type, profile_id) VALUES ('Food', 'expense', ?)",
      P
    );
    const tag = await insert("INSERT INTO tags (name, profile_id) VALUES ('Bakery', ?)", P);
    await json(call('POST', '/api/accounts', { name: 'Giro', notes: 'joint account' }));
    await json(
      call('POST', '/api/savings-goals', { name: 'Trip', target_amount: 900, notes: 'shared' })
    );
    await json(
      call('POST', '/api/retirement-goals', {
        name: 'Pension',
        target_amount: 100000,
        notes: 'second pillar',
      })
    );
    await json(
      call('POST', '/api/housing', { property_name: 'Flat', monthly_amount: 700, notes: 'heating' })
    );
    await json(
      call('POST', '/api/portfolio/holdings', {
        ticker: 'VWCE',
        shares: 10,
        purchase_price: 100,
        purchase_date: '2026-01-02',
        notes: 'monthly plan',
      })
    );
    const { id: loan } = await json<{ id: number }>(
      call('POST', '/api/loans', {
        name: 'Car',
        principal: 10000,
        interest_rate: 5,
        start_date: '2026-01-01',
        term_months: 24,
      })
    );
    await json(
      call('POST', `/api/loans/${loan}/prepayments`, { month: 3, amount: 500, note: 'bonus' })
    );
    await json(
      call('POST', '/api/categories/mappings', { pattern: 'market', category_id: category })
    );
    await json(
      call('POST', '/api/tags/rules', {
        tag_id: tag,
        name: 'bread',
        criteria: { match: 'all', description: 'bakery' },
      })
    );

    const data = await exportBackup(KEYED as never, U, [P]);
    const file = JSON.stringify(data);
    expect(file).not.toContain(TEXT_PREFIX);
    expect(file).not.toContain('text_enc');
    expect(data.accounts[0]).toMatchObject({ notes: 'joint account' });
    expect(data.goals[0]).toMatchObject({ notes: 'shared' });
    expect(data.retirementGoals[0]).toMatchObject({ notes: 'second pillar' });
    expect(data.housings[0]).toMatchObject({ notes: 'heating' });
    expect(data.portfolioHoldings[0]).toMatchObject({ notes: 'monthly plan' });
    expect(data.loanPrepayments[0]).toMatchObject({ note: 'bonus' });
    expect(data.categoryMappings[0]).toMatchObject({ pattern: 'market' });
    expect(String(data.tagRules[0].criteria)).toContain('"description":"bakery"');

    const { first_profile_id: restored } = await restoreBackup(KEYED as never, U, data);
    const ring = new DataKeyring(KEYED);
    const cases: [SealedTable, string, string, string][] = [
      ['accounts', 'notes', 'joint account', 'SELECT * FROM accounts WHERE profile_id = ?'],
      ['savings_goals', 'notes', 'shared', 'SELECT * FROM savings_goals WHERE profile_id = ?'],
      [
        'retirement_goals',
        'notes',
        'second pillar',
        'SELECT * FROM retirement_goals WHERE profile_id = ?',
      ],
      ['housings', 'notes', 'heating', 'SELECT * FROM housings WHERE profile_id = ?'],
      [
        'portfolio_holdings',
        'notes',
        'monthly plan',
        'SELECT * FROM portfolio_holdings WHERE profile_id = ?',
      ],
      [
        'loan_prepayments',
        'note',
        'bonus',
        'SELECT lp.* FROM loan_prepayments lp JOIN loans l ON l.id = lp.loan_id WHERE l.profile_id = ?',
      ],
      [
        'category_mappings',
        'pattern',
        'market',
        'SELECT * FROM category_mappings WHERE profile_id = ?',
      ],
    ];
    for (const [table, column, text, sql] of cases) {
      const { results } = await env.DB.prepare(sql).bind(restored).all<Row>();
      expect(results, table).toHaveLength(1);
      expect(results[0].text_enc, table).toBe(1);
      expect(isSealed(results[0][column]), table).toBe(true);
      expect((await openRows(ring, U, table, results))[0][column], table).toBe(text);
    }
    const { results: rules } = await env.DB.prepare('SELECT * FROM tag_rules WHERE profile_id = ?')
      .bind(restored)
      .all<Row>();
    expect(isSealed(rules[0].criteria)).toBe(true);
    expect(String((await openRows(ring, U, 'tag_rules', rules))[0].criteria)).toContain(
      '"description":"bakery"'
    );
  });
});
