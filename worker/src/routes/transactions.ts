import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId, getProfileIds } from '../profile';
import { HttpError } from '../http';
import { validateTransactionCreate, validateTransactionUpdate } from '../validation';
import { recalcGoalsByCategory } from '../recalc-goals';
import * as db from '../db';

// Port of backend/routes/transactions.js + backend/repositories/transactionsRepo.js.
// Table: transactions (snake_case columns), LEFT JOINed to categories. The backend's
// toCamelCase() is an identity function, so rows/objects are returned unchanged.
// Profile scoping: single ops use `id = ? AND profile_id = ?`; list/summary reads
// span getProfileIds(c) (the Express `profile_id IN (...)`, expanded to placeholders).
export const transactionsRoutes = new Hono<AppEnv>();

interface TxRow {
  id: number;
  account_id: number | null;
  transfer_account_id: number | null;
  category_id: number | null;
  type: string | null;
  amount: number;
  amount_local?: number | null;
  profile_id: number;
  reconciled?: number | null;
  [key: string]: unknown;
}

/** Base-currency value used for all account-balance math (amount_local first). */
function baseAmount(tx: { amount: number; amount_local?: number | null }): number {
  return typeof tx.amount_local === 'number' ? tx.amount_local : tx.amount;
}

interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

// tagsRepo.getTagsForTransaction — tags joined through transaction_tags, scoped by profile.
async function getTagsForTransaction(
  d1: D1Database,
  transactionId: number | string,
  profileId: number
): Promise<TagRow[]> {
  return db.all<TagRow>(
    d1,
    `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN transaction_tags tt ON t.id = tt.tag_id
       WHERE tt.transaction_id = ? AND t.profile_id = ?
       ORDER BY t.name`,
    transactionId,
    profileId
  );
}

// recalcGoalsByCategory now lives in ../recalc-goals (shared with the savings-goals route
// so linking/creating a category goal recomputes immediately, not only on the next
// transaction change). It counts base-currency value, dated from each goal's tracking start.

// D1 caps bound variables at ~100 per statement. Split an id list into chunks small enough that
// `chunk.length + extra` placeholders stay under that ceiling (extra = profile-id + SET binds).
function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── GET /api/transactions — main list with filters + categories LEFT JOIN ─────
transactionsRoutes.get('/api/transactions', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const categoryIdsQ = c.req.query('category_ids');
  const type = c.req.query('type');
  const search = c.req.query('search');
  const reconciled = c.req.query('reconciled');
  const accountId = c.req.query('account_id');
  const sort = c.req.query('sort');
  const order = c.req.query('order');
  const limit = c.req.query('limit');
  const offset = c.req.query('offset');
  // TODO: tag_ids filter (transaction_tags subquery) not ported yet.

  // Build the shared WHERE fragment (used by both the row query and the count query).
  const where: string[] = [];
  const params: unknown[] = [];
  if (startDate) {
    where.push('t.date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('t.date <= ?');
    params.push(endDate);
  }
  if (categoryIdsQ) {
    const ids = categoryIdsQ
      .split(',')
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id))
      .slice(0, 80); // cap to stay under D1's ~100 bound-variable limit on the IN-list
    if (ids.length > 0) {
      where.push(`t.category_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  // transactionsRepo.list also supports a single account_id filter (FROM or TO).
  if (accountId) {
    const aid = parseInt(accountId, 10);
    if (!isNaN(aid)) {
      where.push('(t.account_id = ? OR t.transfer_account_id = ?)');
      params.push(aid, aid);
    }
  }
  if (search) {
    where.push(
      '(t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)'
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (reconciled !== undefined) {
    if (reconciled === '0' || reconciled === 'false') {
      where.push('(t.reconciled = 0 OR t.reconciled IS NULL)');
    } else if (reconciled === '1' || reconciled === 'true') {
      where.push('t.reconciled = 1');
    }
  }
  const whereSql = where.length ? ` AND ${where.join(' AND ')}` : '';

  // Receipt join: one receipt per transaction (upload replaces the previous one), so a
  // LEFT JOIN stays 1:1. Exposing receipt_id/receipt_name lets the table show the chip.
  let sql = `
    SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
           r.id as receipt_id, r.original_name as receipt_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    LEFT JOIN receipts r ON r.transaction_id = t.id AND r.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause})${whereSql}
  `;

  // ORDER BY (allowlisted columns; category_name maps to c.name).
  const sortCols = [
    'date',
    'amount',
    'description',
    'category_name',
    'type',
    'beneficiary',
    'payor',
  ];
  if (sort && sortCols.includes(sort)) {
    const sortCol = sort === 'category_name' ? 'c.name' : `t.${sort}`;
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortOrder}, t.id ${sortOrder}`;
  } else {
    sql += ' ORDER BY t.date DESC, t.id DESC';
  }

  if (limit) {
    const lim = parseInt(limit, 10);
    sql += ` LIMIT ${isNaN(lim) ? 50 : Math.min(lim, 1000)}`;
  }
  if (offset) {
    const off = parseInt(offset, 10);
    if (!isNaN(off)) sql += ` OFFSET ${off}`;
  }

  const rows = await db.all<TxRow>(c.env.DB, sql, ...pids, ...params);

  // Attach tags in ONE query (was N+1 — a tag query per row, which made large pages time out:
  // ~4800 transactions = ~4800 sequential tag SELECTs).
  if (rows.length) {
    const profPh = pids.map(() => '?').join(',');
    // Profile-scoped (NOT a per-row IN list of every id) so we never exceed D1's bound-variable
    // limit. transaction_tags is small (only tagged rows exist), so this stays one cheap query.
    const tagRows = await db.all<TagRow & { transaction_id: number }>(
      c.env.DB,
      `SELECT tt.transaction_id, t.id, t.name, t.color
         FROM tags t
         JOIN transaction_tags tt ON t.id = tt.tag_id
         JOIN transactions tx ON tx.id = tt.transaction_id
         WHERE tx.profile_id IN (${profPh})
         ORDER BY t.name`,
      ...pids
    );
    const byTx = new Map<number, TagRow[]>();
    for (const tr of tagRows) {
      const list = byTx.get(tr.transaction_id) ?? [];
      list.push({ id: tr.id, name: tr.name, color: tr.color });
      byTx.set(tr.transaction_id, list);
    }
    for (const row of rows) (row as Record<string, unknown>).tags = byTx.get(row.id) ?? [];
  }

  const countSql = `SELECT COUNT(*) as c FROM transactions t WHERE t.profile_id IN (${inClause})${whereSql}`;
  const countRow = await db.first<{ c: number }>(c.env.DB, countSql, ...pids, ...params);
  const total = countRow?.c ?? 0;

  return c.json({
    rows,
    total,
    limit: limit ? parseInt(limit, 10) : total,
    offset: offset ? parseInt(offset, 10) : 0,
  });
});

// ── GET /api/transactions/summary — income/expense totals ─────────────────────
// Registered before /api/transactions/:id so it isn't shadowed.
transactionsRoutes.get('/api/transactions/summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const categoryIdsQ = c.req.query('category_ids');
  const type = c.req.query('type');
  const search = c.req.query('search');

  let sql = `
    SELECT
      SUM(t.amount) as total_amount,
      SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as total_expense,
      SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_income,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    WHERE t.profile_id IN (${inClause})
  `;
  const params: unknown[] = [...pids];
  if (startDate) {
    sql += ' AND t.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND t.date <= ?';
    params.push(endDate);
  }
  if (categoryIdsQ) {
    const ids = categoryIdsQ
      .split(',')
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id))
      .slice(0, 80); // cap to stay under D1's ~100 bound-variable limit on the IN-list
    if (ids.length > 0) {
      sql += ` AND t.category_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }
  if (type) {
    sql += ' AND t.type = ?';
    params.push(type);
  }
  if (search) {
    sql +=
      ' AND (t.description LIKE ? OR t.beneficiary LIKE ? OR t.payor LIKE ? OR t.notes LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  const result = await db.first<{
    total_amount: number | null;
    total_expense: number | null;
    total_income: number | null;
    count: number | null;
  }>(c.env.DB, sql, ...params);

  return c.json({
    total_amount: result?.total_amount || 0,
    total_expense: result?.total_expense || 0,
    total_expenses: result?.total_expense || 0, // Support plural form
    total_income: result?.total_income || 0,
    net_balance: (result?.total_income || 0) - (result?.total_expense || 0),
    count: result?.count || 0,
  });
});

// ── PUT /api/transactions/bulk — bulk update/delete across many ids ───────────
// Registered before /api/transactions/:id so it isn't shadowed.
transactionsRoutes.put('/api/transactions/bulk', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const b = (await c.req.json()) as Record<string, any>;
  // Support both 'ids' and 'transactionIds' field names.
  const ids: unknown[] = b.ids || b.transactionIds || [];
  const action: string = b.action || b._method || 'update';
  const data: Record<string, any> = b.data || b;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new HttpError(400, 'No transaction IDs provided');
  }
  if (ids.length > 1000) {
    throw new HttpError(400, 'Cannot update more than 1000 transactions at once');
  }

  // D1 allows ~100 bound variables per statement; chunk the id list (reserving room for the
  // profile-id binds and, on UPDATE, the SET binds) so large selections don't trip
  // "too many SQL variables".
  const idChunks = chunkIds(ids, Math.max(1, 90 - pids.length));

  if (typeof action === 'string' && action.toLowerCase() === 'delete') {
    let deleted = 0;
    const affectedCategories = new Set<number>();
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      // Reverse account balance effects before deleting. Mirrors the single-DELETE handler so
      // transfer/income rows stored with account_id NULL (money credited only to
      // transfer_account_id) are reversed too — the old `if (!tx.account_id) continue` skipped them.
      const txRows = await db.all<TxRow>(
        c.env.DB,
        `SELECT id, category_id, account_id, transfer_account_id, type, amount, amount_local
           FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`,
        ...pids,
        ...chunk
      );
      const stmts: D1PreparedStatement[] = [];
      for (const tx of txRows) {
        if (tx.category_id) affectedCategories.add(tx.category_id);
        const v = baseAmount(tx);
        if (tx.account_id) {
          if (tx.type === 'transfer' && tx.transfer_account_id) {
            stmts.push(
              c.env.DB.prepare(
                `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
              ).bind(v, tx.account_id, ...pids),
              c.env.DB.prepare(
                `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
              ).bind(v, tx.transfer_account_id, ...pids)
            );
          } else if (tx.type === 'transfer') {
            stmts.push(
              c.env.DB.prepare(
                `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
              ).bind(v, tx.account_id, ...pids)
            );
          } else if (tx.type === 'income' || tx.type === 'expense') {
            const delta = tx.type === 'income' ? -v : v;
            stmts.push(
              c.env.DB.prepare(
                `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
              ).bind(delta, tx.account_id, ...pids)
            );
          }
        } else if (tx.transfer_account_id && tx.type === 'transfer') {
          stmts.push(
            c.env.DB.prepare(
              `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
            ).bind(v, tx.transfer_account_id, ...pids)
          );
        }
      }
      // Reversals and the delete for this chunk commit atomically; the DELETE is pushed last so its
      // changes count is the final result in the batch.
      stmts.push(
        c.env.DB.prepare(
          `DELETE FROM transactions WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`
        ).bind(...pids, ...chunk)
      );
      const results = await c.env.DB.batch(stmts);
      deleted += results[results.length - 1].meta.changes ?? 0;
    }
    // Keep linked savings-goal progress in sync (the single-DELETE path does this too).
    for (const cat of affectedCategories) await recalcGoalsByCategory(c.env.DB, cat, pids);
    return c.json({ ok: true, deleted });
  }

  if (typeof action === 'string' && action.toLowerCase() === 'update') {
    if (!data || typeof data !== 'object') {
      throw new HttpError(400, 'No update data provided');
    }

    const allowedFields = [
      'category_id',
      'type',
      'description',
      'beneficiary',
      'payor',
      'notes',
      'reconciled',
    ];
    const updates: string[] = [];
    const setParams: unknown[] = [];

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        if (field === 'category_id') {
          updates.push('category_id = ?');
          setParams.push(
            data.category_id === null || data.category_id === ''
              ? null
              : parseInt(data.category_id, 10)
          );
        } else if (field === 'reconciled') {
          // Convert boolean to integer for SQLite.
          updates.push('reconciled = ?');
          setParams.push(data.reconciled ? 1 : 0);
        } else if (field === 'type') {
          if (!['income', 'expense', 'transfer'].includes(data.type)) {
            throw new HttpError(400, 'Invalid type. Must be income, expense, or transfer');
          }
          updates.push('type = ?');
          setParams.push(data.type);
        } else {
          updates.push(`${field} = ?`);
          setParams.push(data[field] || '');
        }
      }
    }

    if (updates.length === 0) {
      throw new HttpError(400, 'No valid fields to update');
    }

    updates.push("updated_at = datetime('now')");

    let updated = 0;
    for (const chunk of idChunks) {
      const placeholders = chunk.map(() => '?').join(',');
      const result = await db.run(
        c.env.DB,
        `UPDATE transactions SET ${updates.join(', ')} WHERE profile_id IN (${inClause}) AND id IN (${placeholders})`,
        ...setParams,
        ...pids,
        ...chunk
      );
      updated += result.meta.changes ?? 0;
    }
    return c.json({ ok: true, updated });
  }

  throw new HttpError(400, "Invalid action. Must be 'delete' or 'update'");
});

// ── Reconciliation routes ─────────────────────────────────────────────────────
// Registered before /api/transactions/:id so they aren't shadowed.

// POST /api/transactions/reconcile/bulk — bulk reconcile by date range.
transactionsRoutes.post('/api/transactions/reconcile/bulk', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const { startDate, endDate } = b;
  if (!startDate || !endDate) throw new HttpError(400, 'startDate and endDate are required');

  const result = await db.run(
    c.env.DB,
    `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
     WHERE profile_id = ? AND date >= ? AND date <= ? AND reconciled = 0`,
    pid,
    startDate,
    endDate
  );
  return c.json({
    message: `${result.meta.changes} transactions reconciled`,
    count: result.meta.changes,
  });
});

// GET /api/transactions/reconcile/summary — reconciliation status summary.
transactionsRoutes.get('/api/transactions/reconcile/summary', requireAuth, async (c) => {
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const summary = await db.first(
    c.env.DB,
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN reconciled = 1 THEN 1 ELSE 0 END) as reconciled_count,
      SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN 1 ELSE 0 END) as unreconciled_count,
      SUM(CASE WHEN reconciled = 0 OR reconciled IS NULL THEN amount ELSE 0 END) as unreconciled_total
     FROM transactions WHERE profile_id IN (${inClause})`,
    ...pids
  );
  return c.json(summary);
});

// PUT /api/transactions/reconcile-batch — batch mark reconciled by id list.
transactionsRoutes.put('/api/transactions/reconcile-batch', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const transaction_ids: unknown[] = b.transaction_ids;
  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    throw new HttpError(400, 'transaction_ids array is required');
  }
  const placeholders = transaction_ids.map(() => '?').join(',');
  const result = await db.run(
    c.env.DB,
    `UPDATE transactions SET reconciled = 1, reconciled_at = datetime('now')
     WHERE id IN (${placeholders}) AND profile_id = ?`,
    ...transaction_ids,
    pid
  );
  return c.json({
    message: `${result.meta.changes} transactions reconciled`,
    updated: result.meta.changes,
  });
});

// ── POST /api/transactions — create ───────────────────────────────────────────
transactionsRoutes.post('/api/transactions', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const b = (await c.req.json()) as Record<string, any>;
  validateTransactionCreate(b);
  const {
    description,
    amount,
    date,
    beneficiary,
    payor,
    category_id,
    currency,
    amount_local,
    means_of_payment,
    exchange_rate,
    type,
    notes,
    account_id,
    transfer_account_id,
  } = b;

  // Business rule: income amounts must be positive.
  if (Number(amount) < 0 && type === 'income') {
    throw new HttpError(400, 'Income amount must be positive');
  }

  const resolvedDate = date || new Date().toISOString().split('T')[0];

  // Resolve account_id from means_of_payment (FROM) if not explicitly provided.
  let resolvedAccountId: number | null = account_id || null;
  let resolvedTransferAccountId: number | null = transfer_account_id || null;
  if (!resolvedAccountId && means_of_payment) {
    const matched = await db.first<{ id: number }>(
      c.env.DB,
      `SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) AND profile_id IN (${inClause})`,
      String(means_of_payment).trim(),
      ...pids
    );
    if (matched) resolvedAccountId = matched.id;
  }
  // Resolve transfer_account_id from category if the category name matches an account.
  if (!resolvedTransferAccountId && category_id) {
    const cat = await db.first<{ name: string }>(
      c.env.DB,
      `SELECT name FROM categories WHERE id = ? AND profile_id IN (${inClause})`,
      category_id,
      ...pids
    );
    if (cat) {
      const matched = await db.first<{ id: number }>(
        c.env.DB,
        `SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) AND profile_id IN (${inClause})`,
        String(cat.name).trim(),
        ...pids
      );
      if (matched) resolvedTransferAccountId = matched.id;
    }
  }

  // Persist the row and its balance side effects atomically. The INSERT is first in the batch so
  // its generated id can be read back from the batch result.
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO transactions (description, amount, date, beneficiary, payor, category_id, currency, amount_local, means_of_payment, exchange_rate, type, notes, profile_id, account_id, transfer_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      description,
      amount,
      resolvedDate,
      beneficiary || '',
      payor || '',
      category_id || null,
      currency || 'USD',
      amount_local ?? amount,
      means_of_payment || '',
      exchange_rate || 1.0,
      type || 'expense',
      notes || '',
      pid,
      resolvedAccountId,
      resolvedTransferAccountId
    ),
  ];

  // Auto-update linked account balances using the base-currency value so balances
  // stay in one currency even for foreign-currency transactions.
  const balanceValue = amount_local ?? amount;
  if (resolvedAccountId && type === 'transfer' && resolvedTransferAccountId) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(balanceValue, resolvedAccountId, ...pids),
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(balanceValue, resolvedTransferAccountId, ...pids)
    );
  } else if (resolvedAccountId && type === 'transfer') {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(balanceValue, resolvedAccountId, ...pids)
    );
  } else if (resolvedAccountId && (type === 'income' || type === 'expense')) {
    const delta = type === 'income' ? balanceValue : -balanceValue;
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(delta, resolvedAccountId, ...pids)
    );
  }
  // If account_id is null but transfer_account_id is set, money flows TO that account.
  if (
    !resolvedAccountId &&
    resolvedTransferAccountId &&
    (type === 'income' || type === 'transfer')
  ) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(balanceValue, resolvedTransferAccountId, ...pids)
    );
  }

  const [insertResult] = await c.env.DB.batch(stmts);

  // Return the created transaction with all fields including timestamps.
  const created = await db.first<TxRow>(
    c.env.DB,
    'SELECT * FROM transactions WHERE id = ? AND profile_id = ?',
    insertResult.meta.last_row_id,
    pid
  );

  // Recalculate linked goal progress.
  if (category_id) await recalcGoalsByCategory(c.env.DB, category_id, pids);

  return c.json(created);
});

// ── GET /api/transactions/:id ─────────────────────────────────────────────────
transactionsRoutes.get('/api/transactions/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');

  const tx = await db.first<Record<string, unknown>>(
    c.env.DB,
    `
    SELECT t.*, c.name as category_name, c.color as category_color,
           r.id as receipt_id, r.original_name as receipt_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id AND c.profile_id = t.profile_id
    LEFT JOIN receipts r ON r.transaction_id = t.id AND r.profile_id = t.profile_id
    WHERE t.id = ? AND t.profile_id = ?
    `,
    id,
    pid
  );
  if (!tx) throw new HttpError(404, 'Transaction not found');

  tx.tags = await getTagsForTransaction(c.env.DB, id, pid);

  // Express remaps category_name -> category, then drops category_name.
  tx.category = (tx.category_name as string | null) || null;
  delete tx.category_name;
  return c.json(tx);
});

// ── PUT /api/transactions/:id — update ────────────────────────────────────────
transactionsRoutes.put('/api/transactions/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const id = c.req.param('id');
  const b = (await c.req.json()) as Record<string, any>;
  validateTransactionUpdate(b);
  const {
    description,
    amount,
    date,
    beneficiary,
    payor,
    category_id,
    currency,
    amount_local,
    means_of_payment,
    exchange_rate,
    type,
    notes,
    reconciled,
    account_id,
    transfer_account_id,
  } = b;

  // Fetch old transaction for account balance reversal.
  const oldTx = await db.first<TxRow>(
    c.env.DB,
    'SELECT account_id, transfer_account_id, type, amount FROM transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );

  const updates: string[] = [];
  const params: unknown[] = [];
  let hasUpdate = false;

  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
    hasUpdate = true;
  }
  if (amount !== undefined) {
    updates.push('amount = ?');
    params.push(amount);
    hasUpdate = true;
  }
  if (date !== undefined) {
    updates.push('date = ?');
    params.push(date);
    hasUpdate = true;
  }
  if (beneficiary !== undefined) {
    updates.push('beneficiary = ?');
    params.push(beneficiary || '');
    hasUpdate = true;
  }
  if (payor !== undefined) {
    updates.push('payor = ?');
    params.push(payor || '');
    hasUpdate = true;
  }
  if (category_id !== undefined) {
    updates.push('category_id = ?');
    params.push(category_id || null);
    hasUpdate = true;
  }
  if (currency !== undefined) {
    updates.push('currency = ?');
    params.push(currency);
    hasUpdate = true;
  }
  if (amount_local !== undefined) {
    updates.push('amount_local = ?');
    params.push(amount_local ?? amount);
    hasUpdate = true;
  }
  if (means_of_payment !== undefined) {
    updates.push('means_of_payment = ?');
    params.push(means_of_payment || '');
    hasUpdate = true;
  }
  if (exchange_rate !== undefined) {
    updates.push('exchange_rate = ?');
    params.push(exchange_rate || 1.0);
    hasUpdate = true;
  }
  if (type !== undefined) {
    updates.push('type = ?');
    params.push(type);
    hasUpdate = true;
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    params.push(notes || '');
    hasUpdate = true;
  }
  if (reconciled !== undefined) {
    updates.push('reconciled = ?');
    updates.push("reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE reconciled_at END");
    params.push(reconciled ? 1 : 0);
    params.push(reconciled ? 1 : 0);
    hasUpdate = true;
  }
  if (account_id !== undefined) {
    updates.push('account_id = ?');
    params.push(account_id || null);
    hasUpdate = true;
  }
  if (transfer_account_id !== undefined) {
    updates.push('transfer_account_id = ?');
    params.push(transfer_account_id || null);
    hasUpdate = true;
  }

  if (!hasUpdate) throw new HttpError(400, 'No valid fields provided for update');

  // The pre-fetched oldTx shares the UPDATE's WHERE clause, so a missing row means 404 — check it
  // up front so the reverse / row-update / re-apply run as one atomic batch. Previously these were
  // separate awaited writes with a hand-rolled "undo on 0 changes" compensation; a failure or
  // eviction between them permanently drifted account balances.
  if (!oldTx) throw new HttpError(404, 'Not found');

  updates.push("updated_at = datetime('now')");
  params.push(id, pid);

  const stmts: D1PreparedStatement[] = [];

  // Reverse old transaction effect on old account(s).
  if (oldTx.account_id) {
    if (oldTx.type === 'transfer' && oldTx.transfer_account_id) {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(oldTx.amount, oldTx.account_id, ...pids),
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(oldTx.amount, oldTx.transfer_account_id, ...pids)
      );
    } else if (oldTx.type === 'transfer') {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(oldTx.amount, oldTx.account_id, ...pids)
      );
    } else if (oldTx.type === 'income' || oldTx.type === 'expense') {
      const oldDelta = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(oldDelta, oldTx.account_id, ...pids)
      );
    }
  }
  // Reverse old transfer TO effect (money added to transfer_account_id).
  if (oldTx.transfer_account_id && oldTx.type === 'transfer' && !oldTx.account_id) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(oldTx.amount, oldTx.transfer_account_id, ...pids)
    );
  }

  // Update the transaction row itself.
  stmts.push(
    c.env.DB.prepare(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND profile_id = ?`
    ).bind(...params)
  );

  // Apply new transaction effect on account(s).
  const newAccountId = account_id !== undefined ? account_id || null : oldTx.account_id;
  const newTransferAccountId =
    transfer_account_id !== undefined ? transfer_account_id || null : oldTx.transfer_account_id;
  const newType = type !== undefined ? type : oldTx.type;
  const newAmount = amount !== undefined ? amount : oldTx.amount;
  if (newAccountId) {
    if (newType === 'transfer' && newTransferAccountId) {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(newAmount, newAccountId, ...pids),
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(newAmount, newTransferAccountId, ...pids)
      );
    } else if (newType === 'transfer') {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(newAmount, newAccountId, ...pids)
      );
    } else if (newType === 'income' || newType === 'expense') {
      const newDelta = newType === 'income' ? newAmount : -newAmount;
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(newDelta, newAccountId, ...pids)
      );
    }
  }
  if (!newAccountId && newTransferAccountId && newType === 'transfer') {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(newAmount, newTransferAccountId, ...pids)
    );
  }

  await c.env.DB.batch(stmts);

  // Recalculate linked goal progress.
  if (category_id !== undefined) await recalcGoalsByCategory(c.env.DB, category_id || null, pids);

  return c.json({ ok: true });
});

// ── DELETE /api/transactions/:id ──────────────────────────────────────────────
transactionsRoutes.delete('/api/transactions/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');
  const id = c.req.param('id');

  // Fetch full tx before delete for account reversal and goal recalc.
  const tx = await db.first<TxRow>(
    c.env.DB,
    'SELECT category_id, account_id, transfer_account_id, type, amount, amount_local FROM transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );

  // The pre-fetched row shares the DELETE's WHERE clause, so a missing row means 404 — check it
  // up front so the balance reversal and the delete can commit as one atomic batch.
  if (!tx) throw new HttpError(404, 'Not found');

  const v = baseAmount(tx);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM transactions WHERE id = ? AND profile_id = ?').bind(id, pid),
  ];
  // Reverse transaction effect on linked account(s).
  if (tx.account_id) {
    if (tx.type === 'transfer' && tx.transfer_account_id) {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(v, tx.account_id, ...pids),
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(v, tx.transfer_account_id, ...pids)
      );
    } else if (tx.type === 'transfer') {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(v, tx.account_id, ...pids)
      );
    } else if (tx.type === 'income' || tx.type === 'expense') {
      const delta = tx.type === 'income' ? -v : v;
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id IN (${inClause})`
        ).bind(delta, tx.account_id, ...pids)
      );
    }
  }
  // Reverse transfer TO effect (remove money added to transfer_account_id).
  if (tx.transfer_account_id && tx.type === 'transfer' && !tx.account_id) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET balance = balance - ? WHERE id = ? AND profile_id IN (${inClause})`
      ).bind(v, tx.transfer_account_id, ...pids)
    );
  }

  await c.env.DB.batch(stmts);

  if (tx.category_id) await recalcGoalsByCategory(c.env.DB, tx.category_id, pids);

  return c.json({ ok: true });
});

// ── DELETE /api/transactions — delete all for the active profile ──────────────
transactionsRoutes.delete('/api/transactions', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const pids = await getProfileIds(c);
  const inClause = pids.map(() => '?').join(',');

  // Delete all rows and reset balances atomically.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM transactions WHERE profile_id = ?').bind(pid),
    // Reset all account balances to starting_balance since all transactions are deleted.
    c.env.DB.prepare(
      `UPDATE accounts SET balance = COALESCE(starting_balance, 0) WHERE profile_id IN (${inClause})`
    ).bind(...pids),
  ]);
  return c.json({ ok: true, message: 'All transactions deleted' });
});

// ── PATCH /api/transactions/:id/reconcile — toggle reconciled + reconciled_at ─
transactionsRoutes.patch('/api/transactions/:id/reconcile', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first<{ id: number; reconciled: number | null }>(
    c.env.DB,
    'SELECT id, reconciled FROM transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Transaction not found');

  const newStatus = existing.reconciled ? 0 : 1;
  await db.run(
    c.env.DB,
    "UPDATE transactions SET reconciled = ?, reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND profile_id = ?",
    newStatus,
    newStatus,
    id,
    pid
  );
  return c.json({
    id: parseInt(id, 10),
    reconciled: newStatus,
    reconciled_at: newStatus ? new Date().toISOString() : null,
  });
});
