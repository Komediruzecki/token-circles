import { z } from 'zod';
import { defineTool, guardSize, MAX_ROWS } from './registry';
import { HttpError } from '../http';
import { signCapability, CAPABILITY_TTL_SECONDS } from '../signed-url';
import * as db from '../db';

/** Every tool accepts this; rpc.ts reads `profileId` off the parsed args to resolve the profile. */
import { profileArg, DATE, MONTH } from './args';

// Read tools. Start every session with whoami: it is what turns "the user's account" into ids
// the other tools can be called with.

defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'Identify the account this token belongs to: user id, plan, every profile (id, name, base currency), the scopes this token carries, and which profile calls default to. Call this first - every other tool takes an optional profileId, and this is where the ids come from.',
  scope: 'read',
  input: z.object({}).strict(),
  handler: async (c, _args, profileId) => {
    const userId = c.get('userId');
    const user = await db.first<{ email: string; plan: string | null }>(
      c.env.DB,
      'SELECT email, plan FROM users WHERE id = ?',
      userId
    );
    const profiles = await db.all<{ id: number; name: string }>(
      c.env.DB,
      'SELECT id, name FROM profiles WHERE user_id = ? ORDER BY id',
      userId
    );
    // Scoped to this user's own profiles. Unfiltered, this read every account's currency row
    // and only happened to look right because the map is keyed by profile id -- a foreign row
    // whose id collided would have been reported as the user's own.
    const ids = profiles.map((p) => p.id);
    const currencies = ids.length
      ? await db.all<{ profile_id: number; value: string }>(
          c.env.DB,
          `SELECT profile_id, value FROM settings
             WHERE key = 'currency' AND profile_id IN (${ids.map(() => '?').join(',')})`,
          ...ids
        )
      : [];
    const byProfile = new Map(currencies.map((r) => [r.profile_id, r.value]));
    return {
      userId,
      email: user?.email ?? null,
      plan: user?.plan ?? 'free',
      scopes: c.get('token')?.scopes ?? [],
      activeProfileId: profileId,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        baseCurrency: byProfile.get(p.id) ?? 'EUR',
      })),
    };
  },
});

defineTool({
  name: 'list_transactions',
  title: 'List transactions',
  description:
    'Search transactions with filters and cursor pagination. Returns { rows, nextCursor, totalCount, truncated }. Use this to look at individual transactions; to compute totals use summarize_spending instead, which aggregates server-side and costs a fraction of the tokens.',
  scope: 'read',
  input: z
    .object({
      ...profileArg,
      from: z.string().regex(DATE).optional().describe('Inclusive start date, YYYY-MM-DD.'),
      to: z.string().regex(DATE).optional().describe('Inclusive end date, YYYY-MM-DD.'),
      accountIds: z.array(z.number().int()).max(50).optional(),
      categoryIds: z.array(z.number().int()).max(50).optional(),
      type: z.enum(['income', 'expense', 'transfer']).optional(),
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
      search: z.string().max(200).optional().describe('Substring match on description.'),
      limit: z.number().int().min(1).max(MAX_ROWS).default(100),
      cursor: z.string().nullish().describe('nextCursor from a previous call.'),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const where: string[] = ['t.profile_id = ?'];
    const params: unknown[] = [profileId];
    const add = (sql: string, ...p: unknown[]) => {
      where.push(sql);
      params.push(...p);
    };
    if (args.from) add('t.date >= ?', args.from);
    if (args.to) add('t.date <= ?', args.to);
    if (args.type) add('t.type = ?', args.type);
    if (args.minAmount !== undefined) add('t.amount >= ?', args.minAmount);
    if (args.maxAmount !== undefined) add('t.amount <= ?', args.maxAmount);
    if (args.search) add('t.description LIKE ?', `%${args.search}%`);
    if (args.accountIds?.length) {
      add(`t.account_id IN (${args.accountIds.map(() => '?').join(',')})`, ...args.accountIds);
    }
    if (args.categoryIds?.length) {
      add(`t.category_id IN (${args.categoryIds.map(() => '?').join(',')})`, ...args.categoryIds);
    }

    const total = await db.first<{ n: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS n FROM transactions t WHERE ${where.join(' AND ')}`,
      ...params
    );

    // Keyset pagination on (date DESC, id DESC): stable under concurrent inserts, unlike OFFSET.
    const cursorParams: unknown[] = [];
    let cursorSql = '';
    if (args.cursor) {
      const [date, id] = String(args.cursor).split('|');
      if (!date || !id) throw new HttpError(400, 'Malformed cursor.');
      cursorSql = ' AND (t.date < ? OR (t.date = ? AND t.id < ?))';
      cursorParams.push(date, date, Number(id));
    }

    const rows = await db.all<Record<string, unknown>>(
      c.env.DB,
      `SELECT t.id, t.date, t.description, t.amount, t.amount_local, t.currency, t.type,
              t.account_id, t.transfer_account_id, t.category_id, c.name AS category,
              t.beneficiary, t.payor, t.notes, t.reconciled
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id AND c.profile_id = t.profile_id
        WHERE ${where.join(' AND ')}${cursorSql}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ?`,
      ...params,
      ...cursorParams,
      // One row past the page. Comparing the page against totalCount instead cannot tell a full
      // last page from a full middle one -- with 18 rows at limit 6, page 3 still saw 18 > 6 and
      // reported more to come, handing the caller a cursor that returns nothing.
      args.limit + 1
    );

    const hasMore = rows.length > args.limit;
    const page = hasMore ? rows.slice(0, args.limit) : rows;
    const last = page[page.length - 1] as { date?: string; id?: number } | undefined;
    return guardSize({
      rows: page,
      totalCount: total?.n ?? 0,
      truncated: hasMore,
      nextCursor: hasMore && last ? `${last.date}|${last.id}` : null,
    });
  },
});

defineTool({
  name: 'summarize_spending',
  title: 'Summarize spending',
  description:
    'Aggregate transactions server-side into totals grouped by category, merchant, month or account, over an optional date range. Prefer this over list_transactions whenever you want sums, averages or rankings - it returns tens of rows where listing would return thousands.',
  scope: 'read',
  input: z
    .object({
      ...profileArg,
      from: z.string().regex(DATE).optional(),
      to: z.string().regex(DATE).optional(),
      type: z.enum(['income', 'expense', 'transfer']).optional(),
      groupBy: z.enum(['category', 'merchant', 'month', 'account']).default('category'),
      limit: z.number().int().min(1).max(MAX_ROWS).default(100),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    // Fixed SQL fragments chosen by an enum -- never interpolated from caller input.
    const GROUPS = {
      category: "COALESCE(c.name, 'Uncategorized')",
      merchant: "COALESCE(NULLIF(t.beneficiary, ''), t.description)",
      month: 'substr(t.date, 1, 7)',
      account: "COALESCE(a.name, 'No account')",
    } as const;
    const keyExpr = GROUPS[args.groupBy];

    const where: string[] = ['t.profile_id = ?'];
    const params: unknown[] = [profileId];
    if (args.from) {
      where.push('t.date >= ?');
      params.push(args.from);
    }
    if (args.to) {
      where.push('t.date <= ?');
      params.push(args.to);
    }
    if (args.type) {
      where.push('t.type = ?');
      params.push(args.type);
    }

    const groups = await db.all<{ key: string; total: number; count: number; avg: number }>(
      c.env.DB,
      `SELECT ${keyExpr} AS key,
              SUM(COALESCE(t.amount_local, t.amount)) AS total,
              COUNT(*) AS count,
              AVG(COALESCE(t.amount_local, t.amount)) AS avg
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id AND c.profile_id = t.profile_id
         LEFT JOIN accounts a ON a.id = t.account_id AND a.profile_id = t.profile_id
        WHERE ${where.join(' AND ')}
        GROUP BY ${keyExpr}
        ORDER BY ABS(SUM(COALESCE(t.amount_local, t.amount))) DESC
        LIMIT ?`,
      ...params,
      args.limit
    );

    return guardSize({
      groupBy: args.groupBy,
      from: args.from ?? null,
      to: args.to ?? null,
      groups,
      grandTotal: groups.reduce((sum, g) => sum + (g.total ?? 0), 0),
    });
  },
});

defineTool({
  name: 'list_reference_data',
  title: 'List reference data',
  description:
    'Every account, category, tag and counterparty for the profile, in one call. Call this before any write: creating or categorizing a transaction needs these ids.',
  scope: 'read',
  input: z.object({ ...profileArg }).strict(),
  handler: async (c, _args, profileId) => {
    const q = <T>(sql: string) => db.all<T>(c.env.DB, sql, profileId);
    return guardSize({
      accounts: await q<Record<string, unknown>>(
        'SELECT id, name, bank_name, type, currency, balance FROM accounts WHERE profile_id = ? ORDER BY name'
      ),
      categories: await q<Record<string, unknown>>(
        'SELECT id, name, type, parent_id, tax_deductible FROM categories WHERE profile_id = ? ORDER BY name'
      ),
      tags: await q<Record<string, unknown>>(
        'SELECT id, name, color FROM tags WHERE profile_id = ? ORDER BY name'
      ),
      counterparties: await q<Record<string, unknown>>(
        "SELECT DISTINCT beneficiary AS name FROM transactions WHERE profile_id = ? AND beneficiary <> '' ORDER BY name LIMIT 200"
      ),
    });
  },
});

defineTool({
  name: 'get_overview',
  title: 'Account overview',
  description:
    'A one-call orientation: every account with its balance, total net worth, and income, expense and net for a month. Start here before drilling into transactions.',
  scope: 'read',
  input: z
    .object({
      ...profileArg,
      month: z.string().regex(MONTH).optional().describe('YYYY-MM. Defaults to the current month.'),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const month = args.month ?? new Date().toISOString().slice(0, 7);
    const accounts = await db.all<{ id: number; name: string; currency: string; balance: number }>(
      c.env.DB,
      'SELECT id, name, currency, balance FROM accounts WHERE profile_id = ? ORDER BY name',
      profileId
    );
    const totals = await db.all<{ type: string; total: number }>(
      c.env.DB,
      `SELECT t.type, SUM(COALESCE(t.amount_local, t.amount)) AS total
         FROM transactions t
        WHERE t.profile_id = ? AND substr(t.date, 1, 7) = ?
        GROUP BY t.type`,
      profileId,
      month
    );
    const of = (type: string) => totals.find((r) => r.type === type)?.total ?? 0;
    const bills = await db.all<Record<string, unknown>>(
      c.env.DB,
      `SELECT id, name, amount, due_date FROM bills
        WHERE profile_id = ? AND due_date >= date('now')
        ORDER BY due_date LIMIT 10`,
      profileId
    );
    return guardSize({
      monthKey: month,
      accounts,
      netWorth: accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0),
      month: { income: of('income'), expense: of('expense'), net: of('income') + of('expense') },
      upcomingBills: bills,
    });
  },
});

defineTool({
  name: 'get_budgets_and_goals',
  title: 'Budgets and goals',
  description:
    'Budgets with what has been spent against them for a month, plus savings goals and loans. This is where to look before recommending a change to a budget.',
  scope: 'read',
  input: z.object({ ...profileArg, month: z.string().regex(MONTH).optional() }).strict(),
  handler: async (c, args, profileId) => {
    const month = args.month ?? new Date().toISOString().slice(0, 7);
    const budgets = await db.all<{
      id: number;
      category_id: number;
      category: string | null;
      amount: number;
      period: string;
      spent: number;
    }>(
      c.env.DB,
      `SELECT b.id, b.category_id, c.name AS category, b.amount, b.period,
              COALESCE((
                SELECT ABS(SUM(COALESCE(t.amount_local, t.amount)))
                  FROM transactions t
                 WHERE t.profile_id = b.profile_id
                   AND t.category_id = b.category_id
                   AND substr(t.date, 1, 7) = ?
              ), 0) AS spent
         FROM budgets b
         LEFT JOIN categories c ON c.id = b.category_id AND c.profile_id = b.profile_id
        WHERE b.profile_id = ?
        ORDER BY b.id`,
      month,
      profileId
    );
    return guardSize({
      month,
      budgets: budgets.map((b) => ({ ...b, remaining: (b.amount ?? 0) - (b.spent ?? 0) })),
      savingsGoals: await db.all(
        c.env.DB,
        'SELECT * FROM savings_goals WHERE profile_id = ? ORDER BY id',
        profileId
      ),
      loans: await db.all(
        c.env.DB,
        'SELECT * FROM loans WHERE profile_id = ? ORDER BY id',
        profileId
      ),
    });
  },
});

defineTool({
  name: 'export_snapshot',
  title: 'Export a full snapshot',
  description:
    'Get a short-lived URL that downloads the entire profile as one JSON file: transactions, accounts, categories, budgets, goals, loans. Use this when you want to run your own analysis locally - curl it to a file and work on the file. It returns a URL rather than the data because a whole account will not fit in a tool result. Receipt image bytes are excluded by default; pass includeReceiptFiles for a true full backup.',
  scope: 'read',
  input: z
    .object({
      ...profileArg,
      includeReceiptFiles: z
        .boolean()
        .default(false)
        .describe('Embed base64 receipt scans. Off by default - they are large and rarely useful.'),
    })
    .strict(),
  handler: async (c, args, profileId) => {
    const secret = c.env.JWT_SECRET;
    if (!secret) throw new HttpError(503, 'Server is not configured for signed downloads.');
    const sig = await signCapability(
      {
        tokenId: c.get('token')?.tokenId ?? 'unknown',
        userId: c.get('userId'),
        profileId,
        purpose: 'snapshot',
      },
      secret
    );
    const origin = c.env.API_PUBLIC_ORIGIN ?? new URL(c.req.url).origin;
    const qs = new URLSearchParams({ sig });
    if (args.includeReceiptFiles) qs.set('includeReceiptFiles', 'true');
    const downloadUrl = `${origin}/api/v1/snapshot?${qs}`;
    return {
      downloadUrl,
      expiresInSeconds: CAPABILITY_TTL_SECONDS,
      curl: `curl -fsSL "${downloadUrl}" -o snapshot.json`,
      guidance:
        'Download it, then analyse the file locally. Do not paste the contents back through a tool call.',
    };
  },
});
