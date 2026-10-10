/**
 * The write tools: append plus curate. There is no update or delete of arbitrary records here
 * by design -- an agent acting on its own analysis should be able to add and to categorize,
 * and mistakes it makes should be additive and reversible.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';
import { BUDGET_MESSAGES } from '../../shared/budgetSchema';
import { defaultTagColor, TAG_MESSAGES } from '../../shared/tagSchema';

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
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version, plan) VALUES (?, 'w@example.com', 'pbkdf2$100000$x$y', 'password', 1, 'advanced')"
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

  it('create_transactions refuses an account that is not there, and adds nothing', async () => {
    unwrap(await call('create_account', { name: 'Wallet', currency: 'EUR' }));
    const row = (accountName: string, description: string) => ({
      date: '2026-03-06',
      description,
      amount: -5,
      type: 'expense',
      accountName,
    });

    const result = await call('create_transactions', {
      transactions: [row('wallet ', 'Known'), row('Revolut', 'Unknown'), row('N26', 'Other')],
    });

    expect(result.isError).toBe(true);
    const said: string = result.content[0].text;
    expect(said).toContain('This profile has no account named "Revolut" or "N26".');
    expect(said).toContain('"Wallet"');
    expect(said).toContain('create_account');
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM transactions WHERE profile_id = ?'
    )
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
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
      "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version, plan) VALUES (9699, 'o@example.com', 'pbkdf2$100000$x$y', 'password', 1, 'advanced')"
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

  // The tool took any positive number and any date-shaped text, so it stored 12.345 and
  // 2026-02-30, refused a budget of zero, and answered another profile's category with a 403
  // where the app answers a 400 at the category. It runs the app's checks now.
  it('upsert_budget checks a budget as the app does', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (96021, 'Food', 'expense', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    const refused = async (args: Record<string, unknown>): Promise<string> => {
      const result = await call('upsert_budget', args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      return result.content[0].text;
    };
    const food = { categoryId: 96021, startDate: '2026-03-01' };

    expect(await refused({ ...food, amount: 12.345 })).toBe(BUDGET_MESSAGES.amountCents);
    expect(await refused({ ...food, amount: -5 })).toBe(BUDGET_MESSAGES.amountNegative);
    expect(await refused({ ...food, amount: 10, startDate: '2026-02-30' })).toBe(
      BUDGET_MESSAGES.startDate
    );
    expect(await refused({ ...food, categoryId: 96099, amount: 10 })).toBe(
      BUDGET_MESSAGES.category
    );
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM budgets WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);

    expect(unwrap(await call('upsert_budget', { ...food, amount: 0 }))).toMatchObject({
      created: true,
      amount: 0,
    });
  });

  // Its month is the start date's month: a budget that starts on the 15th is March's budget, and
  // setting March's again changes it. Matched on the exact date, a second budget was added.
  it('upsert_budget changes the budget its month has, whatever day that one starts', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, type, profile_id) VALUES (96021, 'Food', 'expense', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    const created = unwrap(
      await call('upsert_budget', { categoryId: 96021, amount: 300, startDate: '2026-03-15' })
    );
    const updated = unwrap(
      await call('upsert_budget', { categoryId: 96021, amount: 350, startDate: '2026-03-01' })
    );
    expect(updated).toMatchObject({ id: created.id, created: false, amount: 350 });
    const march = await env.DB.prepare(
      "SELECT id, amount, start_date FROM budgets WHERE profile_id = ? AND start_date >= '2026-03-01' AND start_date < '2026-04-01'"
    )
      .bind(PROFILE_ID)
      .all();
    expect(march.results).toEqual([{ id: created.id, amount: 350, start_date: '2026-03-15' }]);
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

  // It wrote tags past the tag rules: a padded name was a second tag, a new one took no colour
  // from the palette, and a name of 100 characters was stored where the Tags page stops at 50.
  it('upsert_tag_rule finds a tag in any case or padding, and creates one by the tag rules', async () => {
    await env.DB.prepare('DELETE FROM tags WHERE profile_id = ?').bind(PROFILE_ID).run();
    const travel = { descriptionContains: ['rail'] };

    const first = unwrap(
      await call('upsert_tag_rule', { tagName: 'Travel', name: 'Trains', criteria: travel })
    );
    const twin = unwrap(
      await call('upsert_tag_rule', { tagName: '  travel ', name: 'Planes', criteria: travel })
    );

    expect(twin.tagId).toBe(first.tagId);
    const tags = await env.DB.prepare('SELECT name, color FROM tags WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .all();
    expect(tags.results).toEqual([{ name: 'Travel', color: defaultTagColor(0) }]);

    const long = await call('upsert_tag_rule', {
      tagName: 'Weekend trips to the seaside and the mountains in summer',
      name: 'Long',
      criteria: travel,
    });
    expect(long.isError).toBe(true);
    expect(long.content[0].text).toBe(TAG_MESSAGES.nameLength);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM tags WHERE profile_id = ?')
      .bind(PROFILE_ID)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
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
