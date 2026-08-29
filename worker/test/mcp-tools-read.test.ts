/**
 * The read tools, and the two properties that keep them from ruining a caller's context:
 * every list caps at MAX_ROWS, and summarize_spending aggregates server-side so the agent
 * never pages thousands of rows to compute a sum.
 */
import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { mintApiToken } from '../src/apitoken';

const USER_ID = 9400;
const PROFILE_ID = 9401;
let secret = '';

async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await SELF.fetch('https://api.example.com/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as any;
  if (body.result?.isError) throw new Error(body.result.content[0].text);
  return body.result.structuredContent;
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash, auth_provider, token_version) VALUES (?, 'read@example.com', 'pbkdf2$100000$x$y', 'password', 1)"
  )
    .bind(USER_ID)
    .run();
  await env.DB.prepare("INSERT OR IGNORE INTO profiles (id, name, user_id) VALUES (?, 'Read', ?)")
    .bind(PROFILE_ID, USER_ID)
    .run();
  await env.DB.prepare(
    "INSERT INTO accounts (id, name, type, currency, balance, profile_id) VALUES (94010, 'Checking', 'giro', 'EUR', 1000, ?)"
  )
    .bind(PROFILE_ID)
    .run();
  await env.DB.prepare(
    "INSERT INTO categories (id, name, type, profile_id) VALUES (94020, 'Groceries', 'expense', ?)"
  )
    .bind(PROFILE_ID)
    .run();

  // Three groceries expenses in January, one in February, plus one income.
  const rows: [string, string, number, string, number | null][] = [
    ['2026-01-05', 'Market', -20, 'expense', 94020],
    ['2026-01-15', 'Market', -30, 'expense', 94020],
    ['2026-01-25', 'Market', -50, 'expense', 94020],
    ['2026-02-05', 'Market', -10, 'expense', 94020],
    ['2026-01-01', 'Salary', 2000, 'income', null],
  ];
  for (const [date, description, amount, type, category] of rows) {
    await env.DB.prepare(
      'INSERT INTO transactions (date, description, amount, type, currency, account_id, category_id, profile_id) VALUES (?, ?, ?, ?, ?, 94010, ?, ?)'
    )
      .bind(date, description, amount, type, 'EUR', category, PROFILE_ID)
      .run();
  }

  secret = (
    await mintApiToken(env.DB, USER_ID, {
      name: 'read',
      scopes: ['read'],
      defaultProfileId: PROFILE_ID,
    })
  ).secret;
});

describe('read tools', () => {
  it('list_transactions filters by date, type and category', async () => {
    const all = await call('list_transactions', {});
    expect(all.totalCount).toBe(5);
    expect(all.truncated).toBe(false);

    const january = await call('list_transactions', { from: '2026-01-01', to: '2026-01-31' });
    expect(january.totalCount).toBe(4);

    const expenses = await call('list_transactions', { type: 'expense' });
    expect(expenses.totalCount).toBe(4);

    const groceries = await call('list_transactions', { categoryIds: [94020] });
    expect(groceries.totalCount).toBe(4);

    const search = await call('list_transactions', { search: 'Salary' });
    expect(search.rows).toHaveLength(1);
    expect(search.rows[0].description).toBe('Salary');
  });

  it('list_transactions paginates and reports truncation at the cap', async () => {
    const page = await call('list_transactions', { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).not.toBeNull();

    const next = await call('list_transactions', { limit: 2, cursor: page.nextCursor });
    expect(next.rows).toHaveLength(2);
    expect(next.rows[0].id).not.toBe(page.rows[0].id);
  });

  it('list_transactions refuses a limit over the hard cap', async () => {
    await expect(call('list_transactions', { limit: 5000 })).rejects.toThrow(/argument/i);
  });

  it('summarize_spending aggregates by category and by month', async () => {
    const byCategory = await call('summarize_spending', {
      from: '2026-01-01',
      to: '2026-01-31',
      groupBy: 'category',
    });
    const groceries = byCategory.groups.find((g: any) => g.key === 'Groceries');
    expect(groceries.total).toBeCloseTo(-100);
    expect(groceries.count).toBe(3);

    const byMonth = await call('summarize_spending', { groupBy: 'month', type: 'expense' });
    const january = byMonth.groups.find((g: any) => g.key === '2026-01');
    expect(january.total).toBeCloseTo(-100);
    expect(byMonth.groups.find((g: any) => g.key === '2026-02').total).toBeCloseTo(-10);
  });

  it('list_reference_data returns accounts, categories and tags together', async () => {
    const ref = await call('list_reference_data', {});
    expect(ref.accounts.map((a: any) => a.name)).toContain('Checking');
    expect(ref.categories.map((x: any) => x.name)).toContain('Groceries');
    expect(Array.isArray(ref.tags)).toBe(true);
  });

  it('get_overview reports balances and month totals', async () => {
    const overview = await call('get_overview', { month: '2026-01' });
    expect(overview.accounts).toHaveLength(1);
    expect(overview.netWorth).toBeCloseTo(1000);
    expect(overview.month.income).toBeCloseTo(2000);
    expect(overview.month.expense).toBeCloseTo(-100);
  });

  it('get_budgets_and_goals returns budgets with spend against them', async () => {
    await env.DB.prepare(
      "INSERT INTO budgets (id, category_id, amount, period, start_date, profile_id) VALUES (94030, 94020, 150, 'monthly', '2026-01-01', ?)"
    )
      .bind(PROFILE_ID)
      .run();
    const result = await call('get_budgets_and_goals', { month: '2026-01' });
    const budget = result.budgets.find((b: any) => b.id === 94030);
    expect(budget.amount).toBe(150);
    expect(budget.spent).toBeCloseTo(100);
    expect(budget.remaining).toBeCloseTo(50);
  });
});
