/**
 * The MCP read tools and the v1 ingest over sealed rows, with a key forced on whatever mode the
 * suite runs in.
 *
 * Once rows can be sealed, SQL can no longer search, group or dedupe their text: list_transactions'
 * search, summarize_spending's merchant grouping and list_reference_data's counterparties move to
 * JS over opened rows. The property that matters is that nothing an agent sees changes. So the
 * same ledger is seeded twice -- once all plaintext for a user who never gets a key, once as a MIX
 * of sealed and plaintext rows (the backfill converts rows in its own time) -- and every answer
 * over the mix must equal the answer over plaintext. In a keyless run the plaintext answer comes
 * from the original SQL, so these tests compare the JS path against SQL directly.
 */
import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import app from '../src/index';
import { mintApiToken } from '../src/apitoken';
import { DataKeyring } from '../src/data-keys';
import { openRows, sealForInsert, type SealedTable } from '../src/sealed-rows';
import { signCapability } from '../src/signed-url';

const K = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const KEYED = { ...env, DATA_KEK_1: K };
const SECRET = 'test-jwt-secret-not-for-prod';

/** Never gets a key: only ever read. Asked through SELF and through KEYED. */
const PLAIN_USER = 52001;
const PLAIN_PROFILE = 52011;
/** Keyed, and only ever touched through KEYED. Every other row sealed. */
const MIXED_USER = 52002;
const MIXED_PROFILE = 52012;
/** Keyed; writes through create_transactions and the v1 ingest. */
const WRITE_USER = 52003;
const WRITE_PROFILE = 52013;

const tokens = new Map<number, string>();
type Via = 'self' | 'keyed';

async function call(
  via: Via,
  user: number,
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const req = new Request('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.get(user)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const res =
    via === 'keyed' ? await app.fetch(req, KEYED, createExecutionContext()) : await SELF.fetch(req);
  const body = (await res.json()) as any;
  if (body.result?.isError) throw new Error(body.result.content[0].text);
  if (!body.result) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body.result.structuredContent;
}

/** Raw D1 rows, opened under the forced key. */
async function keyedRows(
  table: SealedTable,
  owner: number,
  sql: string,
  ...params: unknown[]
): Promise<Record<string, unknown>[]> {
  const { results } = await env.DB.prepare(sql)
    .bind(...params)
    .all<Record<string, unknown>>();
  return openRows(new DataKeyring(KEYED), owner, table, results);
}

async function insert(table: string, values: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(values);
  await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  )
    .bind(...cols.map((c) => values[c]))
    .run();
}

interface Seed {
  date: string;
  description: string;
  beneficiary: string | null;
  amount: number;
  type: 'income' | 'expense';
}

// Same-date pairs exercise the id tiebreak through the cursor; -0.1/-0.2/-0.3 exercise SUM's
// exactness; mixed case and a non-ASCII name exercise search folding and BINARY order. No two
// merchants tie on ABS(total), whose tie order SQL leaves unspecified.
const LEDGER: Seed[] = [
  {
    date: '2026-05-01',
    description: 'Coffee Shop',
    beneficiary: 'Bean Bar',
    amount: -3.5,
    type: 'expense',
  },
  {
    date: '2026-05-01',
    description: 'coffee beans',
    beneficiary: '',
    amount: -12.1,
    type: 'expense',
  },
  { date: '2026-05-02', description: 'COFFEE', beneficiary: null, amount: -2.2, type: 'expense' },
  {
    date: '2026-05-02',
    description: 'Tea house',
    beneficiary: 'Bean Bar',
    amount: -4.4,
    type: 'expense',
  },
  { date: '2026-05-03', description: 'Kiosk', beneficiary: 'kiosk', amount: -0.1, type: 'expense' },
  { date: '2026-05-03', description: 'Kiosk', beneficiary: 'kiosk', amount: -0.2, type: 'expense' },
  { date: '2026-05-04', description: 'Kiosk', beneficiary: 'kiosk', amount: -0.3, type: 'expense' },
  {
    date: '2026-05-05',
    description: 'Salary May',
    beneficiary: 'Employer',
    amount: 2500,
    type: 'income',
  },
  {
    date: '2026-05-06',
    description: 'Coffee refund',
    beneficiary: 'Bean Bar',
    amount: 3.5,
    type: 'income',
  },
  {
    date: '2026-05-07',
    description: 'Books',
    beneficiary: 'Äpfel Verlag',
    amount: -20,
    type: 'expense',
  },
  { date: '2026-05-07', description: 'Books', beneficiary: 'B', amount: -21, type: 'expense' },
  { date: '2026-05-08', description: 'Market', beneficiary: 'a', amount: -30, type: 'expense' },
  {
    date: '2026-05-09',
    description: 'Market coffee corner',
    beneficiary: 'b',
    amount: -1.25,
    type: 'expense',
  },
  {
    date: '2026-05-10',
    description: 'Rent',
    beneficiary: 'Landlord',
    amount: -800,
    type: 'expense',
  },
];

beforeAll(async () => {
  for (const [uid, pid] of [
    [PLAIN_USER, PLAIN_PROFILE],
    [MIXED_USER, MIXED_PROFILE],
    [WRITE_USER, WRITE_PROFILE],
  ]) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version, plan) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 'advanced')"
    )
      .bind(uid, `sealed-${uid}@example.com`)
      .run();
    await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'S', ?)")
      .bind(pid, uid)
      .run();
    tokens.set(
      uid,
      (
        await mintApiToken(env.DB, uid, {
          name: 'sealed',
          scopes: ['read', 'write', 'import'],
          defaultProfileId: pid,
        })
      ).secret
    );
  }

  const ring = new DataKeyring(KEYED);
  for (const [i, row] of LEDGER.entries()) {
    const base = { ...row, currency: 'EUR', notes: `note ${i}`, payor: '' };
    await insert('transactions', { ...base, profile_id: PLAIN_PROFILE, text_enc: 0 });
    await insert(
      'transactions',
      i % 2 === 0
        ? await sealForInsert(ring, MIXED_USER, 'transactions', {
            ...base,
            profile_id: MIXED_PROFILE,
          })
        : { ...base, profile_id: MIXED_PROFILE, text_enc: 0 }
    );
  }
});

/** Every page of a list_transactions walk. */
async function walk(via: Via, user: number, args: Record<string, unknown>): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 30; i++) {
    const res: any = await call(via, user, 'list_transactions', {
      ...args,
      ...(cursor ? { cursor } : {}),
    });
    pages.push(res);
    cursor = res.nextCursor;
    if (!cursor) return pages;
  }
  throw new Error('list_transactions never stopped paging');
}

/** A page with the per-profile ids taken out, so two profiles' pages compare. */
const portable = (page: any) => ({
  totalCount: page.totalCount,
  truncated: page.truncated,
  hasCursor: page.nextCursor !== null,
  rows: page.rows.map(({ id: _id, ...rest }: any) => rest),
});

const SEARCHES: Record<string, unknown>[] = [
  { search: 'coffee', limit: 2 },
  { search: 'coffee', limit: 1 },
  { search: 'KIOSK', limit: 2 },
  { search: 'o', limit: 3 },
  { search: 'nothing like it', limit: 2 },
  { search: 'coffee', type: 'expense', from: '2026-05-02', limit: 1 },
  { search: 'books', maxAmount: -20.5, limit: 5 },
];

describe('sealed rows at rest', () => {
  it('stores the mixed ledger half sealed', async () => {
    const raw = await env.DB.prepare(
      'SELECT description, notes, text_enc FROM transactions WHERE profile_id = ? ORDER BY id'
    )
      .bind(MIXED_PROFILE)
      .all<{ description: string; notes: string; text_enc: number }>();
    expect(raw.results).toHaveLength(LEDGER.length);
    raw.results.forEach((r, i) => {
      expect(r.text_enc).toBe(i % 2 === 0 ? 1 : 0);
      expect(r.description.startsWith('tc1.')).toBe(i % 2 === 0);
      expect(r.notes.startsWith('tc1.')).toBe(i % 2 === 0);
    });
  });
});

describe('list_transactions over sealed rows', () => {
  it('returns plaintext and no marker', async () => {
    const res = await call('keyed', MIXED_USER, 'list_transactions', { limit: 100 });
    expect(res.totalCount).toBe(LEDGER.length);
    expect(JSON.stringify(res)).not.toContain('tc1.');
    for (const row of res.rows) expect(row).not.toHaveProperty('text_enc');
    const byDescription = res.rows.map((r: any) => r.description).sort();
    expect(byDescription).toEqual(LEDGER.map((r) => r.description).sort());
    expect(res.rows.map((r: any) => r.notes).sort()).toEqual(
      LEDGER.map((_, i) => `note ${i}`).sort()
    );
  });

  it('search in JS pages exactly as the SQL LIKE did, over plaintext rows', async () => {
    for (const args of SEARCHES) {
      expect(await walk('keyed', PLAIN_USER, args), JSON.stringify(args)).toEqual(
        await walk('self', PLAIN_USER, args)
      );
    }
  });

  it('search over a mix of sealed and plaintext rows matches the plaintext answer', async () => {
    for (const args of SEARCHES) {
      const mixed = (await walk('keyed', MIXED_USER, args)).map(portable);
      const plain = (await walk('self', PLAIN_USER, args)).map(portable);
      expect(mixed, JSON.stringify(args)).toEqual(plain);
    }
    const coffee = await call('keyed', MIXED_USER, 'list_transactions', { search: 'coffee' });
    expect(coffee.totalCount).toBe(5);
    expect(coffee.rows.map((r: any) => r.description)).toEqual([
      'Market coffee corner',
      'Coffee refund',
      'COFFEE',
      'coffee beans',
      'Coffee Shop',
    ]);
  });

  it('an unsearched listing keeps its SQL window and still opens every row', async () => {
    const mixed = (await walk('keyed', MIXED_USER, { limit: 4 })).map(portable);
    const plain = (await walk('self', PLAIN_USER, { limit: 4 })).map(portable);
    expect(mixed).toEqual(plain);
  });

  it('refuses a malformed cursor on the JS path too', async () => {
    await expect(
      call('keyed', MIXED_USER, 'list_transactions', { search: 'coffee', cursor: 'nope' })
    ).rejects.toThrow(/cursor/i);
  });
});

describe('summarize_spending by merchant over sealed rows', () => {
  it('groups sealed and plaintext rows of one merchant together, exactly as SQL did', async () => {
    for (const args of [
      { groupBy: 'merchant' },
      { groupBy: 'merchant', limit: 3 },
      { groupBy: 'merchant', type: 'expense', from: '2026-05-02', to: '2026-05-09' },
    ]) {
      const plain = await call('self', PLAIN_USER, 'summarize_spending', args);
      expect(await call('keyed', PLAIN_USER, 'summarize_spending', args)).toEqual(plain);
      expect(await call('keyed', MIXED_USER, 'summarize_spending', args)).toEqual(plain);
    }

    const all = await call('keyed', MIXED_USER, 'summarize_spending', { groupBy: 'merchant' });
    expect(all.groups.map((g: any) => g.key)).toEqual([
      'Employer',
      'Landlord',
      'a',
      'B',
      'Äpfel Verlag',
      // beneficiary '' and NULL both fall back to the description.
      'coffee beans',
      'Bean Bar',
      'COFFEE',
      'b',
      'kiosk',
    ]);
    const bean = all.groups.find((g: any) => g.key === 'Bean Bar');
    expect(bean.count).toBe(3);
    expect(bean.total).toBeCloseTo(-4.4);
    // Kiosk's rows alternate sealed/plaintext; one group, not three.
    expect(all.groups.find((g: any) => g.key === 'kiosk').count).toBe(3);
  });

  it('leaves the other groupings on SQL', async () => {
    const plain = await call('self', PLAIN_USER, 'summarize_spending', { groupBy: 'month' });
    expect(await call('keyed', MIXED_USER, 'summarize_spending', { groupBy: 'month' })).toEqual(
      plain
    );
  });
});

describe('summarize_spending by merchant: ties', () => {
  const TIE_PLAIN = [52004, 52014] as const;
  const TIE_MIXED = [52005, 52015] as const;
  // Five merchants tie on ABS(total) = 5, so which of them survive a LIMIT is decided by the tie
  // order alone — which SQLite gives key DESCENDING, not the GROUP BY order one would guess.
  const TIES: Seed[] = [
    { date: '2026-06-01', description: 'x', beneficiary: 'zeta', amount: -5, type: 'expense' },
    { date: '2026-06-02', description: 'x', beneficiary: 'alpha', amount: 5, type: 'income' },
    { date: '2026-06-03', description: 'x', beneficiary: 'mid', amount: -5, type: 'expense' },
    { date: '2026-06-04', description: 'Beta', beneficiary: null, amount: 5, type: 'income' },
    { date: '2026-06-05', description: 'beta', beneficiary: '', amount: -5, type: 'expense' },
    { date: '2026-06-06', description: 'x', beneficiary: 'Big', amount: -50, type: 'expense' },
  ];

  beforeAll(async () => {
    const ring = new DataKeyring(KEYED);
    for (const [uid, pid] of [TIE_PLAIN, TIE_MIXED]) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version, plan) VALUES (?, ?, 'pbkdf2$100000$x$y', 'password', 1, 'advanced')"
      )
        .bind(uid, `sealed-${uid}@example.com`)
        .run();
      await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'T', ?)")
        .bind(pid, uid)
        .run();
      tokens.set(
        uid,
        (
          await mintApiToken(env.DB, uid, {
            name: 'ties',
            scopes: ['read'],
            defaultProfileId: pid,
          })
        ).secret
      );
    }
    for (const [i, row] of TIES.entries()) {
      const base = { ...row, currency: 'EUR', notes: '', payor: '' };
      await insert('transactions', { ...base, profile_id: TIE_PLAIN[1], text_enc: 0 });
      await insert(
        'transactions',
        i % 2 === 0
          ? await sealForInsert(ring, TIE_MIXED[0], 'transactions', {
              ...base,
              profile_id: TIE_MIXED[1],
            })
          : { ...base, profile_id: TIE_MIXED[1], text_enc: 0 }
      );
    }
  });

  it('orders tied merchants as SQL does, so a LIMIT keeps the same ones', async () => {
    for (const args of [{ groupBy: 'merchant' }, { groupBy: 'merchant', limit: 3 }]) {
      const plain = await call('self', TIE_PLAIN[0], 'summarize_spending', args);
      expect(await call('keyed', TIE_PLAIN[0], 'summarize_spending', args)).toEqual(plain);
      expect(await call('keyed', TIE_MIXED[0], 'summarize_spending', args)).toEqual(plain);
    }
    const all = await call('keyed', TIE_MIXED[0], 'summarize_spending', { groupBy: 'merchant' });
    expect(all.groups.map((g: any) => g.key)).toEqual([
      'Big',
      'zeta',
      'mid',
      'beta',
      'alpha',
      'Beta',
    ]);
  });
});

describe('list_reference_data counterparties over sealed rows', () => {
  it('dedupes across forms, drops empty names and sorts in BINARY order', async () => {
    const plain = await call('self', PLAIN_USER, 'list_reference_data', {});
    const mixed = await call('keyed', MIXED_USER, 'list_reference_data', {});
    expect(mixed.counterparties).toEqual(plain.counterparties);
    expect(mixed.counterparties.map((c: any) => c.name)).toEqual([
      'B',
      'Bean Bar',
      'Employer',
      'Landlord',
      'a',
      'b',
      'kiosk',
      'Äpfel Verlag',
    ]);
  });
});

describe('get_overview over sealed bills', () => {
  it('opens upcoming bill names and hides the marker', async () => {
    const ring = new DataKeyring(KEYED);
    await insert(
      'bills',
      await sealForInsert(ring, MIXED_USER, 'bills', {
        name: 'Internet',
        notes: 'fibre',
        amount: 30,
        due_date: '2099-01-01',
        profile_id: MIXED_PROFILE,
      })
    );
    await insert('bills', {
      name: 'Water',
      amount: 12,
      due_date: '2099-02-01',
      profile_id: MIXED_PROFILE,
      text_enc: 0,
    });
    const raw = await env.DB.prepare(
      "SELECT name FROM bills WHERE profile_id = ? AND due_date = '2099-01-01'"
    )
      .bind(MIXED_PROFILE)
      .first<{ name: string }>();
    expect(raw?.name.startsWith('tc1.')).toBe(true);

    const overview = await call('keyed', MIXED_USER, 'get_overview', {});
    expect(overview.upcomingBills.map((b: any) => [b.name, b.amount, b.due_date])).toEqual([
      ['Internet', 30, '2099-01-01'],
      ['Water', 12, '2099-02-01'],
    ]);
    for (const bill of overview.upcomingBills) expect(bill).not.toHaveProperty('text_enc');
  });
});

describe('goals and tag rules through a keyed deployment', () => {
  it('get_budgets_and_goals opens goal notes, and upsert_tag_rule seals criteria', async () => {
    await insert(
      'savings_goals',
      await sealForInsert(new DataKeyring(KEYED), MIXED_USER, 'savings_goals', {
        name: 'Bike',
        target_amount: 800,
        notes: 'gravel frame',
        profile_id: MIXED_PROFILE,
      })
    );
    const { savingsGoals } = await call('keyed', MIXED_USER, 'get_budgets_and_goals', {});
    expect(savingsGoals).toEqual([
      expect.objectContaining({ name: 'Bike', notes: 'gravel frame' }),
    ]);
    for (const goal of savingsGoals) expect(goal).not.toHaveProperty('text_enc');

    const criteriaOf = async (id: number): Promise<Record<string, unknown>> => {
      const raw = await env.DB.prepare('SELECT criteria FROM tag_rules WHERE id = ?')
        .bind(id)
        .first<{ criteria: string }>();
      expect(raw!.criteria.startsWith('tc1.')).toBe(true);
      const [rule] = await keyedRows(
        'tag_rules',
        MIXED_USER,
        'SELECT criteria, text_enc FROM tag_rules WHERE id = ?',
        id
      );
      return JSON.parse(String(rule.criteria));
    };
    const created = await call('keyed', MIXED_USER, 'upsert_tag_rule', {
      tagName: 'bikes',
      name: 'Bike shop',
      criteria: { description: 'cycle' },
    });
    expect(created.created).toBe(true);
    expect(await criteriaOf(created.ruleId)).toMatchObject({ description: 'cycle' });
    const updated = await call('keyed', MIXED_USER, 'upsert_tag_rule', {
      tagName: 'bikes',
      name: 'Bike shop',
      criteria: { description: 'bicycle' },
    });
    expect(updated).toMatchObject({ ruleId: created.ruleId, created: false });
    expect(await criteriaOf(created.ruleId)).toMatchObject({ description: 'bicycle' });
  });
});

describe('writes through a keyed deployment', () => {
  const batch = [
    { date: '2026-06-01', description: 'Latte', amount: -4, beneficiary: 'Cafe', notes: 'oat' },
    { date: '2026-06-02', description: 'Groceries', amount: -40, beneficiary: 'Shop' },
    { date: '2026-06-03', description: 'Refund', amount: 9, type: 'income' },
  ];

  it('create_transactions seals, lists back plaintext, and dedupes a re-send', async () => {
    const first = await call('keyed', WRITE_USER, 'create_transactions', { transactions: batch });
    expect(first.imported).toBe(3);

    const raw = await env.DB.prepare(
      'SELECT description, beneficiary, notes, text_enc FROM transactions WHERE profile_id = ?'
    )
      .bind(WRITE_PROFILE)
      .all<{ description: string; beneficiary: string; notes: string; text_enc: number }>();
    expect(raw.results.every((r) => r.text_enc === 1)).toBe(true);
    expect(raw.results.every((r) => r.description.startsWith('tc1.'))).toBe(true);
    const latte = raw.results.find((r) => r.notes !== '' && r.notes !== null);
    expect(latte?.beneficiary.startsWith('tc1.')).toBe(true);
    expect(latte?.notes.startsWith('tc1.')).toBe(true);

    const again = await call('keyed', WRITE_USER, 'create_transactions', { transactions: batch });
    expect(again).toMatchObject({ imported: 0, duplicates: 3 });

    const found = await call('keyed', WRITE_USER, 'list_transactions', { search: 'latte' });
    expect(found.totalCount).toBe(1);
    expect(found.rows[0]).toMatchObject({
      description: 'Latte',
      beneficiary: 'Cafe',
      notes: 'oat',
    });
  });

  it('the v1 ingest seals rows and dedupes a re-run with a fresh importId', async () => {
    const sig = await signCapability(
      { tokenId: 't', userId: WRITE_USER, profileId: WRITE_PROFILE, purpose: 'import' },
      SECRET
    );
    const upload = async (importId: string) => {
      const form = new FormData();
      const csv = ['Date,Description,Amount', '2026-07-02,Espresso bar,-3.50'].join('\n');
      form.append('file', new File([csv], 'statement.csv', { type: 'text/csv' }));
      const qs = new URLSearchParams({ sig, mode: 'commit', importId });
      const res = await app.fetch(
        new Request(`https://api.example.com/api/v1/import?${qs}`, { method: 'POST', body: form }),
        KEYED,
        createExecutionContext()
      );
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, any>;
    };

    expect((await upload('v1-sealed-a')).imported).toBe(1);
    const raw = await env.DB.prepare(
      "SELECT description, text_enc FROM transactions WHERE profile_id = ? AND import_id = 'v1-sealed-a'"
    )
      .bind(WRITE_PROFILE)
      .first<{ description: string; text_enc: number }>();
    expect(raw?.text_enc).toBe(1);
    expect(raw?.description.startsWith('tc1.')).toBe(true);
    const opened = await keyedRows(
      'transactions',
      WRITE_USER,
      "SELECT description, text_enc FROM transactions WHERE profile_id = ? AND import_id = 'v1-sealed-a'",
      WRITE_PROFILE
    );
    expect(opened).toEqual([{ description: 'Espresso bar' }]);

    const rerun = await upload('v1-sealed-b');
    expect(rerun).toMatchObject({ imported: 0, duplicates: 1 });
  });

  it('the v1 snapshot ships plaintext with no markers', async () => {
    const sig = await signCapability(
      { tokenId: 't', userId: WRITE_USER, profileId: WRITE_PROFILE, purpose: 'snapshot' },
      SECRET
    );
    const res = await app.fetch(
      new Request(`https://api.example.com/api/v1/snapshot?sig=${sig}`),
      KEYED,
      createExecutionContext()
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('tc1.');
    expect(text).not.toContain('text_enc');
    const body = JSON.parse(text) as { transactions: { description: string }[] };
    expect(body.transactions.map((t) => t.description).sort()).toEqual(
      ['Espresso bar', 'Groceries', 'Latte', 'Refund'].sort()
    );
  });
});
