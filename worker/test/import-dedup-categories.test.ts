/**
 * Resolution-aware duplicate detection (audit A2) and confirm-before-create
 * categories (audit B5) for the worker import path (POST /api/import/execute).
 * Mirrors the serverless (IndexedDB) behavior so client and worker agree.
 *
 * Runs against the real worker in workerd via Miniflare (D1 from worker/migrations/).
 * Worker deps can't install in the CI sandbox — run locally with `pnpm -C worker test`.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueSessionCookie } from '../src/auth';

const USER = 710;
const PROFILE = 7100;
let cookie = '';

beforeEach(async () => {
  for (const t of [
    'transactions',
    'account_balance_history',
    'accounts',
    'categories',
    'profiles',
    'users',
  ]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, email, auth_provider, token_version) VALUES (?, 'dedup@example.com', 'password', 1)"
    ).bind(USER),
    env.DB.prepare('INSERT INTO profiles (id, user_id, name) VALUES (?, ?, ?)').bind(
      PROFILE,
      USER,
      'Main'
    ),
  ]);
  cookie = (await issueSessionCookie(USER, 'password', env)).split(';')[0];
});

function execute(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch('https://example.com/api/import/execute', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-Profile-Id': String(PROFILE),
    },
    body: JSON.stringify(body),
  });
}

async function allTxns(): Promise<
  {
    description: string;
    amount: number;
    type: string;
    account_id: number | null;
    category_id: number | null;
  }[]
> {
  const { results } = await env.DB.prepare(
    'SELECT description, amount, type, account_id, category_id FROM transactions WHERE profile_id = ?'
  )
    .bind(PROFILE)
    .all<{
      description: string;
      amount: number;
      type: string;
      account_id: number | null;
      category_id: number | null;
    }>();
  return results ?? [];
}

async function categoryNames(): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT name FROM categories WHERE profile_id = ?')
    .bind(PROFILE)
    .all<{ name: string }>();
  return (results ?? []).map((r) => r.name);
}

describe('worker import — resolution-aware duplicate detection (A2)', () => {
  it('imports two rows with the same date/description/amount but DIFFERENT accounts', async () => {
    const res = await execute({
      rows: [
        ['2026-06-01', 'Lunch', '-20', 'Cash'],
        ['2026-06-01', 'Lunch', '-20', 'Card'],
      ],
      mapping: { date: 0, description: 1, amount: 2, means_of_payment: 3 },
      // Flag both means-of-payment values as accounts so they are created + linked.
      categoryTypes: { Cash: 'account', Card: 'account' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; duplicates: number };
    expect(body.imported).toBe(2);
    expect(body.duplicates).toBe(0);

    const txns = await allTxns();
    expect(txns).toHaveLength(2);
    expect(new Set(txns.map((t) => t.account_id)).size).toBe(2);
  });

  it('imports an income and an expense of the same date/description/amount', async () => {
    const res = await execute({
      rows: [
        ['2026-06-02', 'Adjustment', '50'],
        ['2026-06-02', 'Adjustment', '-50'],
      ],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; duplicates: number };
    expect(body.imported).toBe(2);
    expect(body.duplicates).toBe(0);
    expect(new Set((await allTxns()).map((t) => t.type))).toEqual(new Set(['income', 'expense']));
  });

  it('flags a truly-identical row against an existing transaction and does not double-insert', async () => {
    const first = await execute({
      rows: [['2026-06-03', 'Bill', '-30']],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    expect(((await first.json()) as { imported: number }).imported).toBe(1);

    const second = await execute({
      rows: [['2026-06-03', 'Bill', '-30']],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    const body = (await second.json()) as { imported: number; duplicates: number };
    expect(body.imported).toBe(0);
    expect(body.duplicates).toBe(1);

    expect(await allTxns()).toHaveLength(1); // not double-inserted
  });

  it('keeps identical rows within one file because they may be genuine same-day repeats', async () => {
    const res = await execute({
      rows: [
        ['2026-06-04', 'Bill', '-30'],
        ['2026-06-04', 'Bill', '-30'],
      ],
      mapping: { date: 0, description: 1, amount: 2 },
    });
    const body = (await res.json()) as {
      imported: number;
      duplicates: number;
      duplicate_indices: number[];
    };
    expect(body.imported).toBe(2);
    expect(body.duplicates).toBe(0);
    expect(body.duplicate_indices).toEqual([]);
    expect(await allTxns()).toHaveLength(2);
  });
});

describe('worker import — confirm before creating categories (B5)', () => {
  const MAPPING = { date: 0, description: 1, amount: 2, category: 3 };
  const ROWS = [
    ['2026-07-01', 'Apples', '-10', 'Groceries'],
    ['2026-07-02', 'Widget', '-15', 'Junk'],
  ];

  it('creates only approved categories; unapproved rows import uncategorized', async () => {
    const res = await execute({
      rows: ROWS,
      mapping: MAPPING,
      approvedCategories: ['Groceries'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number };
    expect(body.imported).toBe(2);

    const names = await categoryNames();
    expect(names).toContain('Groceries');
    expect(names).not.toContain('Junk');

    const txns = await allTxns();
    const widget = txns.find((t) => t.description === 'Widget')!;
    const apples = txns.find((t) => t.description === 'Apples')!;
    expect(widget.category_id).toBeNull(); // uncategorized, not skipped
    expect(apples.category_id).not.toBeNull();
  });

  it('auto-creates ALL categories when the field is absent (backward-compat)', async () => {
    const res = await execute({ rows: ROWS, mapping: MAPPING });
    const body = (await res.json()) as { categories_created: number };
    expect(body.categories_created).toBe(2);

    const names = await categoryNames();
    expect(names).toContain('Groceries');
    expect(names).toContain('Junk');
  });

  it('preview (dry_run) reports the distinct new categories without mutating', async () => {
    await env.DB.prepare(
      "INSERT INTO categories (name, type, color, icon, profile_id) VALUES ('Groceries', 'expense', '#fff', 'tag', ?)"
    )
      .bind(PROFILE)
      .run();

    const res = await execute({
      rows: [
        ['2026-07-01', 'Apples', '-10', 'Groceries'], // existing → not new
        ['2026-07-02', 'Widget', '-15', 'Junk'], // new
        ['2026-07-03', 'Gadget', '-5', 'Junk'], // same new value → distinct
      ],
      mapping: MAPPING,
      dry_run: true,
    });
    const body = (await res.json()) as { new_categories: string[]; imported: number };
    expect(body.new_categories).toEqual(['Junk']);
    // Nothing inserted in dry-run.
    expect(await allTxns()).toHaveLength(0);
    expect(await categoryNames()).toEqual(['Groceries']);
  });
});

describe('worker import — configured account currency', () => {
  const accountCurrency = async (name: string): Promise<string | null> => {
    const account = await env.DB.prepare(
      'SELECT currency FROM accounts WHERE profile_id = ? AND name = ?'
    )
      .bind(PROFILE, name)
      .first<{ currency: string }>();
    return account?.currency ?? null;
  };

  const transactionCurrency = async (description: string): Promise<string | null> => {
    const transaction = await env.DB.prepare(
      'SELECT currency FROM transactions WHERE profile_id = ? AND description = ?'
    )
      .bind(PROFILE, description)
      .first<{ currency: string }>();
    return transaction?.currency ?? null;
  };

  it('normalizes the configured currency for imported accounts and currency-less rows', async () => {
    const res = await execute({
      rows: [['2026-07-20', 'Opening deposit', '200', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      defaultCurrency: ' chf ',
    });
    expect(res.status).toBe(200);
    expect(await accountCurrency('Savings')).toBe('CHF');
    expect(await transactionCurrency('Opening deposit')).toBe('CHF');
  });

  it('falls back to EUR when the configured currency is malformed', async () => {
    const res = await execute({
      rows: [['2026-07-20', 'Opening deposit', '200', 'Savings']],
      mapping: { date: 0, description: 1, amount: 2, category: 3 },
      categoryTypes: { Savings: 'account' },
      defaultCurrency: 'not-a-currency',
    });
    expect(res.status).toBe(200);
    expect(await accountCurrency('Savings')).toBe('EUR');
    expect(await transactionCurrency('Opening deposit')).toBe('EUR');
  });
});
