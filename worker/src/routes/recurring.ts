import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';

// Port of backend/routes/recurring.js + backend/repositories/recurringRepo.js.
// Table: recurring_transactions, LEFT JOINed to categories. Response shapes are
// kept identical (snake_case) to the Express backend.
export const recurringRoutes = new Hono<AppEnv>();

interface RecurringRow {
  id: number;
  description: string;
  amount: number;
  type: string;
  category_id: number | null;
  account_id: number | null;
  transfer_account_id: number | null;
  frequency: string;
  day_of_month: number | null;
  next_date: string | null;
  notes: string | null;
  active: number;
  category_name?: string | null;
  category_color?: string | null;
  category_type?: string | null;
}

recurringRoutes.get('/api/recurring', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all<RecurringRow>(
    c.env.DB,
    `
      SELECT r.*, c.name as category_name, c.color as category_color, c.type as category_type
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.profile_id = ? AND r.active = 1
      ORDER BY r.next_date ASC
    `,
    pid
  );
  return c.json(rows);
});

// IMPORTANT: /upcoming must come before /:id to avoid :id capturing "upcoming".
recurringRoutes.get('/api/recurring/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const recurring = await db.all<RecurringRow>(
    c.env.DB,
    `
      SELECT r.id, r.description, r.amount, r.type, r.frequency, r.day_of_month, r.next_date,
             c.name as category_name, c.color as category_color
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id
      WHERE r.profile_id = ? AND r.active = 1
    `,
    pid
  );

  interface UpcomingItem {
    id: number;
    description: string;
    amount: number;
    type: string;
    frequency: string;
    day_of_month: number | null;
    next_date: string;
    category_name?: string | null;
    category_color?: string | null;
  }

  const upcoming: UpcomingItem[] = [];
  for (const r of recurring) {
    let cursor = new Date(r.next_date || now.toISOString().split('T')[0]);
    if (cursor < now) {
      cursor = new Date(now.toISOString().split('T')[0]);
    }
    const maxDate = new Date(endDate.toISOString().split('T')[0]);

    while (cursor <= maxDate) {
      upcoming.push({
        id: r.id,
        description: r.description,
        amount: r.amount,
        type: r.type,
        frequency: r.frequency,
        day_of_month: r.day_of_month,
        next_date: cursor.toISOString().split('T')[0],
        category_name: r.category_name,
        category_color: r.category_color,
      });

      if (r.frequency === 'daily') {
        cursor.setDate(cursor.getDate() + 1);
      } else if (r.frequency === 'weekly') {
        cursor.setDate(cursor.getDate() + 7);
      } else if (r.frequency === 'monthly') {
        cursor.setMonth(cursor.getMonth() + 1);
        const day = r.day_of_month || cursor.getDate();
        cursor.setDate(
          Math.min(day, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate())
        );
      } else if (r.frequency === 'yearly') {
        cursor.setFullYear(cursor.getFullYear() + 1);
      } else {
        break;
      }
    }
  }

  upcoming.sort((a, b) => a.next_date.localeCompare(b.next_date));

  interface CategoryBucket {
    name: string;
    color?: string | null;
    total: number;
    items: UpcomingItem[];
  }
  const byCategory: Record<string, CategoryBucket> = {};
  let totalMonthly = 0;
  for (const item of upcoming) {
    const catKey = item.category_name || 'Uncategorized';
    if (!byCategory[catKey]) {
      byCategory[catKey] = { name: catKey, color: item.category_color, total: 0, items: [] };
    }
    byCategory[catKey]!.total += item.amount;
    byCategory[catKey]!.items.push(item);
    totalMonthly += item.amount;
  }

  const currencyRow = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT value FROM settings WHERE key = ? AND profile_id = ?',
    'local_currency',
    pid
  );
  const currency = currencyRow ? currencyRow.value : 'EUR';

  return c.json({
    transactions: upcoming.slice(0, 20),
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    totalMonthly,
    currency,
  });
});

recurringRoutes.get('/api/recurring/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const r = await db.first<RecurringRow>(
    c.env.DB,
    'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!r) throw new HttpError(404, 'Not found');
  return c.json(r);
});

recurringRoutes.post('/api/recurring', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const {
    description,
    amount,
    type,
    category_id,
    account_id,
    transfer_account_id,
    frequency,
    day_of_month,
    next_date,
    notes,
  } = b;
  // Validate ownership of any client-supplied account id (source or transfer dest).
  for (const acc of [account_id, transfer_account_id]) {
    if (acc != null && !(await db.accountBelongsToProfile(c.env.DB, Number(acc), pid))) {
      throw new HttpError(403, 'Account does not belong to this profile');
    }
  }
  const res = await db.insert(c.env.DB, 'recurring_transactions', {
    profile_id: pid,
    description: description || '',
    amount,
    type: type || 'expense',
    category_id: category_id || null,
    account_id: account_id || null,
    transfer_account_id: transfer_account_id || null,
    frequency: frequency || 'monthly',
    day_of_month: day_of_month || null,
    next_date: next_date || null,
    notes: notes || '',
  });
  return c.json({ id: res.meta.last_row_id });
});

recurringRoutes.put('/api/recurring/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first<RecurringRow>(
    c.env.DB,
    'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Not found');
  const b = (await c.req.json()) as Record<string, any>;
  const {
    description,
    amount,
    type,
    category_id,
    account_id,
    transfer_account_id,
    frequency,
    day_of_month,
    next_date,
    notes,
    active,
  } = b;
  // Validate ownership of any client-supplied account id (source or transfer dest).
  for (const acc of [account_id, transfer_account_id]) {
    if (acc != null && !(await db.accountBelongsToProfile(c.env.DB, Number(acc), pid))) {
      throw new HttpError(403, 'Account does not belong to this profile');
    }
  }
  await db.update(
    c.env.DB,
    'recurring_transactions',
    {
      description: description ?? '',
      amount: amount ?? 0,
      type: type ?? 'expense',
      category_id: category_id ?? null,
      account_id: account_id ?? null,
      transfer_account_id: transfer_account_id ?? null,
      frequency: frequency ?? 'monthly',
      day_of_month: day_of_month ?? null,
      next_date: next_date ?? null,
      notes: notes ?? '',
      active: active ?? 1,
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  );
  return c.json({ ok: true });
});

recurringRoutes.delete('/api/recurring/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  await db.del(
    c.env.DB,
    'recurring_transactions',
    'id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  return c.json({ ok: true });
});

// "Process due": materializes a transaction from the recurring rule and advances next_date.
// Executed in one atomic D1 batch: INSERT the transaction, adjust the linked account
// balance (if account_id is set), and advance the next_date — so a mid-flight failure
// cannot create a transaction without updating the balance.
recurringRoutes.post('/api/recurring/:id/populate', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const r = await db.first<RecurringRow>(
    c.env.DB,
    'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!r) throw new HttpError(404, 'Not found');

  const todayStr = new Date().toISOString().split('T')[0];

  // Idempotency guard: if next_date is already in the future, the current
  // period was already populated (or hasn't arrived yet). Either way,
  // prevent double-population from creating duplicate transactions.
  if (r.next_date && r.next_date > todayStr) {
    throw new HttpError(409, 'Recurring transaction already populated for current period');
  }

  const date = r.next_date || todayStr;

  // Advance next_date past the populated period. EVERY frequency must move the
  // date forward — if it stalls (e.g. daily/biweekly falling through to no-op),
  // next_date stays <= today and the idempotency guard above never trips, so the
  // rule can be populated repeatedly and each run debits the account again.
  const next = new Date(date);
  if (r.frequency === 'daily') next.setDate(next.getDate() + 1);
  else if (r.frequency === 'weekly') next.setDate(next.getDate() + 7);
  else if (r.frequency === 'biweekly') next.setDate(next.getDate() + 14);
  else if (r.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1); // monthly + safe default: always advance.
  const nextStr = next.toISOString().split('T')[0];

  const stmts: D1PreparedStatement[] = [];

  // 1. Insert the transaction, including account_id / transfer_account_id if set.
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, account_id, transfer_account_id, date, notes, beneficiary, payor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      pid,
      r.description,
      r.amount,
      r.type,
      r.category_id,
      r.account_id ?? null,
      r.transfer_account_id ?? null,
      date,
      r.notes || '',
      '',
      ''
    )
  );

  // 2. Adjust account balances, mirroring the serverless computeBalanceDeltas
  //    (frontend/src/core/storage/idb.ts) exactly:
  //      - transfer with From (account_id) + To (transfer_account_id): debit From, credit To;
  //      - income/expense with an account: move that one account;
  //      - a transfer missing a leg makes NO change (money can't vanish);
  //      - an account-less recurring is a pure reminder (no balance change).
  const bal = (delta: number, accId: number) =>
    c.env.DB.prepare(
      'UPDATE accounts SET balance = balance + ? WHERE id = ? AND profile_id = ?'
    ).bind(delta, accId, pid);
  if (r.account_id != null) {
    if (r.type === 'transfer' && r.transfer_account_id != null) {
      stmts.push(bal(-r.amount, r.account_id), bal(r.amount, r.transfer_account_id));
    } else if (r.type === 'income' || r.type === 'expense') {
      stmts.push(bal(r.type === 'income' ? r.amount : -r.amount, r.account_id));
    }
  } else if (
    r.transfer_account_id != null &&
    (r.type === 'income' || r.type === 'transfer')
  ) {
    stmts.push(bal(r.amount, r.transfer_account_id));
  }

  // 3. Advance next_date.
  stmts.push(
    c.env.DB.prepare(
      'UPDATE recurring_transactions SET next_date = ? WHERE id = ? AND profile_id = ?'
    ).bind(nextStr, id, pid)
  );

  const results = await c.env.DB.batch(stmts);
  const txLastRowId = results[0]?.meta?.last_row_id;

  return c.json({
    ok: true,
    transactionId: txLastRowId,
    next_date: nextStr,
  });
});
