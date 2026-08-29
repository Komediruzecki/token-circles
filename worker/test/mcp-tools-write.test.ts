/**
 * The write tools: append plus curate. There is no update or delete of arbitrary records here
 * by design -- an agent acting on its own analysis should be able to add and to categorize,
 * and mistakes it makes should be additive and reversible.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';

const USER_ID = 9600;
const PROFILE_ID = 9601;
let secret = '';
let readOnly = '';

async function call(
  name: string,
  args: Record<string, unknown> = {},
  token = secret
): Promise<any> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return ((await res.json()) as any).result;
}

const unwrap = (r: any): any => {
  if (r?.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
};

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'w@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'W', ?)")
    .bind(PROFILE_ID, USER_ID)
    .run();
  secret = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'w',
      scopes: ['read', 'write'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
  readOnly = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'ro',
      scopes: ['read'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
});

describe('write tools', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(PROFILE_ID).run();
    await env.DB.prepare('DELETE FROM tag_rules WHERE profile_id = ?').bind(PROFILE_ID).run();
    await env.DB.prepare('DELETE FROM budgets WHERE profile_id = ?').bind(PROFILE_ID).run();
  });

  it('create_account then create_transactions, with duplicates reported', async () => {
    const account = unwrap(
      await call('create_account', { name: 'Savings', type: 'savings', currency: 'EUR' })
    );
    expect(account.id).toBeGreaterThan(0);

    const rows = [
      {
        date: '2026-03-01',
        description: 'Book',
        amount: -12.5,
        type: 'expense',
        accountName: 'Savings',
      },
      {
        date: '2026-03-02',
        description: 'Coffee',
        amount: -3.2,
        type: 'expense',
        accountName: 'Savings',
      },
    ];
    const first = unwrap(await call('create_transactions', { transactions: rows }));
    expect(first.imported).toBe(2);

    const again = unwrap(await call('create_transactions', { transactions: rows }));
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(2);

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?'
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('create_transactions attaches rows to the named account', async () => {
    const account = unwrap(await call('create_account', { name: 'Current', currency: 'EUR' }));
    unwrap(
      await call('create_transactions', {
        transactions: [
          {
            date: '2026-03-05',
            description: 'Linked',
            amount: -5,
            type: 'expense',
            accountName: 'Current',
          },
        ],
      })
    );
    const row = await env.DB.prepare(
      "SELECT account_id FROM transactions WHERE profile_id = ? AND description = 'Linked'"
    )
      .bind(PROFILE_ID)
      .first<{ account_id: number | null }>();
    expect(row?.account_id).toBe(account.id);
  });

  it('categorize_transactions updates only the named ids in this profile', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (96020, 'Books', 'expense', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    await env.DB.prepare(
      "INSERT INTO transactions (id, date, description, amount, type, currency, profile_id) VALUES (96001, '2026-03-01', 'Book', -12.5, 'expense', 'EUR', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    await env.DB.prepare(
      "INSERT INTO transactions (id, date, description, amount, type, currency, profile_id) VALUES (96002, '2026-03-02', 'Coffee', -3.2, 'expense', 'EUR', ?)"
    )
      .bind(PROFILE_ID)
      .run();

    const out = unwrap(
      await call('categorize_transactions', { transactionIds: [96001], categoryId: 96020 })
    );
    expect(out.updated).toBe(1);

    const book = await env.DB.prepare(
      'SELECT category_id FROM transactions WHERE id = 96001'
    ).first<{ category_id: number | null }>();
    const coffee = await env.DB.prepare(
      'SELECT category_id FROM transactions WHERE id = 96002'
    ).first<{ category_id: number | null }>();
    expect(book?.category_id).toBe(96020);
    expect(coffee?.category_id).toBeNull();
  });

  it('categorize_transactions refuses a category from another profile', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (9699, 'o@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (9699, 'Other', 9699)"
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (96999, 'Foreign', 'expense', 9699)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO transactions (id, date, description, amount, type, currency, profile_id) VALUES (96003, '2026-03-01', 'x', -1, 'expense', 'EUR', ?)"
    )
      .bind(PROFILE_ID)
      .run();

    const result = await call('categorize_transactions', {
      transactionIds: [96003],
      categoryId: 96999,
    });
    expect(result.isError).toBe(true);
    const row = await env.DB.prepare(
      'SELECT category_id FROM transactions WHERE id = 96003'
    ).first<{ category_id: number | null }>();
    expect(row?.category_id).toBeNull();
  });

  it('upsert_budget creates then updates in place', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (96021, 'Food', 'expense', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    const created = unwrap(
      await call('upsert_budget', { categoryId: 96021, amount: 300, startDate: '2026-03-01' })
    );
    expect(created.created).toBe(true);

    const updated = unwrap(
      await call('upsert_budget', { categoryId: 96021, amount: 350, startDate: '2026-03-01' })
    );
    expect(updated.created).toBe(false);
    expect(updated.id).toBe(created.id);

    const row = await env.DB.prepare('SELECT amount FROM budgets WHERE id = ?')
      .bind(created.id)
      .first<{ amount: number }>();
    expect(row?.amount).toBe(350);
  });

  it('upsert_tag_rule creates the tag if it does not exist', async () => {
    const out = unwrap(
      await call('upsert_tag_rule', {
        tagName: 'subscriptions',
        name: 'Streaming services',
        criteria: { descriptionContains: ['netflix', 'spotify'] },
      })
    );
    expect(out.tagId).toBeGreaterThan(0);
    const rule = await env.DB.prepare('SELECT name, criteria FROM tag_rules WHERE id = ?')
      .bind(out.ruleId)
      .first<{ name: string; criteria: string }>();
    expect(rule?.name).toBe('Streaming services');
    expect(JSON.parse(rule!.criteria).descriptionContains).toContain('netflix');
  });

  it('every write tool refuses a read-only token', async () => {
    for (const name of [
      'create_transactions',
      'create_account',
      'categorize_transactions',
      'upsert_tag_rule',
      'upsert_budget',
    ]) {
      const result = await call(name, {}, readOnly);
      expect(result.isError, `${name} accepted a read-only token`).toBe(true);
      expect(result.content[0].text).toContain('write');
    }
  });
});
