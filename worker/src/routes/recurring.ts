import { Hono, type Context } from 'hono';
import { transactionInvariantError } from '../../../shared/transactionInvariant';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { keyringFor } from '../data-keys';
import { openRows, sealForInsert, sealedUpdate } from '../sealed-rows';

// Port of backend/routes/recurring.js + backend/repositories/recurringRepo.js.
// Table: recurring_transactions, LEFT JOINed to categories. Response shapes are
// kept identical (snake_case) to the Express backend.
export const recurringRoutes = new Hono<AppEnv>();

// A type alias rather than an interface, so rows satisfy openRows' Record<string, unknown>.
type RecurringRow = {
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
};

// recurring_transactions.description and .notes are sealed at rest under the owner's data key
// (sealed-rows.ts). getProfileId only ever returns the requesting user's profiles, so
// c.get('userId') is the key owner. Open straight after the query, before any JS reads them.
function openRecurring(c: Context<AppEnv>, rows: RecurringRow[]): Promise<RecurringRow[]> {
  return openRows(keyringFor(c), c.get('userId'), 'recurring_transactions', rows);
}

recurringRoutes.get('/api/recurring', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await openRecurring(
    c,
    await db.all<RecurringRow>(
      c.env.DB,
      `
      SELECT r.*, c.name as category_name, c.color as category_color, c.type as category_type
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id AND c.profile_id = r.profile_id
      WHERE r.profile_id = ? AND r.active = 1
      ORDER BY r.next_date ASC
    `,
      pid
    )
  );
  return c.json(rows);
});

// IMPORTANT: /upcoming must come before /:id to avoid :id capturing "upcoming".
recurringRoutes.get('/api/recurring/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const recurring = await openRecurring(
    c,
    await db.all<RecurringRow>(
      c.env.DB,
      `
      SELECT r.id, r.description, r.amount, r.type, r.frequency, r.day_of_month, r.next_date,
             r.text_enc, c.name as category_name, c.color as category_color
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id AND c.profile_id = r.profile_id
      WHERE r.profile_id = ? AND r.active = 1
    `,
      pid
    )
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
    'currency',
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
  const [r] = await openRecurring(
    c,
    await db.all<RecurringRow>(
      c.env.DB,
      'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
      c.req.param('id'),
      pid
    )
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
  if (
    category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, Number(category_id), pid))
  ) {
    throw new HttpError(403, 'Category does not belong to this profile');
  }
  const normalizedType = type || 'expense';
  const normalizedTransferAccountId = normalizedType === 'transfer' ? transfer_account_id : null;
  const invariantError = transactionInvariantError({
    type: normalizedType,
    amount,
    account_id,
    transfer_account_id: normalizedTransferAccountId,
  });
  if (invariantError) throw new HttpError(400, invariantError);
  const res = await db.insert(
    c.env.DB,
    'recurring_transactions',
    await sealForInsert(keyringFor(c), c.get('userId'), 'recurring_transactions', {
      profile_id: pid,
      description: description || '',
      amount,
      type: normalizedType,
      category_id: category_id || null,
      account_id: account_id || null,
      transfer_account_id: normalizedTransferAccountId || null,
      frequency: frequency || 'monthly',
      day_of_month: day_of_month || null,
      next_date: next_date || null,
      notes: notes || '',
    })
  );
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
  // description and notes are sealed and take no part in validation, so they stay out of
  // `effective` (existing's may be ciphertext) and are handled at the UPDATE below.
  const effective = {
    amount: b.amount ?? existing.amount,
    type: b.type ?? existing.type,
    category_id: b.category_id === undefined ? existing.category_id : b.category_id,
    account_id: b.account_id === undefined ? existing.account_id : b.account_id,
    transfer_account_id:
      b.transfer_account_id === undefined ? existing.transfer_account_id : b.transfer_account_id,
    frequency: b.frequency ?? existing.frequency,
    day_of_month: b.day_of_month === undefined ? existing.day_of_month : b.day_of_month,
    next_date: b.next_date === undefined ? existing.next_date : b.next_date,
    active: b.active ?? existing.active,
  };
  if (effective.type !== 'transfer') effective.transfer_account_id = null;
  // Validate ownership of any client-supplied account id (source or transfer dest).
  for (const acc of [effective.account_id, effective.transfer_account_id]) {
    if (acc != null && !(await db.accountBelongsToProfile(c.env.DB, Number(acc), pid))) {
      throw new HttpError(403, 'Account does not belong to this profile');
    }
  }
  if (
    effective.category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, Number(effective.category_id), pid))
  ) {
    throw new HttpError(403, 'Category does not belong to this profile');
  }
  const invariantError = transactionInvariantError(effective);
  if (invariantError) throw new HttpError(400, invariantError);
  // Writing back the stored description/notes when the body leaves them out was a no-op, so they
  // are left out of the SET instead (sealedUpdate skips undefined) and the stored form, sealed or
  // plain, is never opened or rewritten here. The one exception keeps the old coercion of a NULL
  // notes to '' — safe to decide from the raw row, since NULL is never sealed. A value the body
  // does carry is written by sealedUpdate in whichever form the row is in.
  await db.batch(
    c.env.DB,
    await sealedUpdate(
      keyringFor(c),
      c.get('userId'),
      'recurring_transactions',
      {
        description: b.description ?? undefined,
        amount: effective.amount,
        type: effective.type,
        category_id: effective.category_id,
        account_id: effective.account_id,
        transfer_account_id: effective.transfer_account_id,
        frequency: effective.frequency,
        day_of_month: effective.day_of_month,
        next_date: effective.next_date,
        notes: b.notes !== undefined ? (b.notes ?? '') : existing.notes === null ? '' : undefined,
        active: effective.active,
      },
      'id = ? AND profile_id = ?',
      [id, pid]
    )
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
  const [r] = await openRecurring(
    c,
    await db.all<RecurringRow>(
      c.env.DB,
      'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
      id,
      pid
    )
  );
  if (!r) throw new HttpError(404, 'Not found');
  const invariantError = transactionInvariantError(r);
  if (invariantError) throw new HttpError(400, invariantError);

  const todayStr = new Date().toISOString().split('T')[0];

  // Pre-flight, for the message. It is NOT what makes this safe: reading next_date and then
  // writing leaves a window in which another request does the same, and both then populate the
  // same period — two identical transactions, the account debited twice. The guard carried by
  // every statement below is what closes it.
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

  // The generated transaction inherits the profile's base currency and carries
  // amount_local = amount, matching the create handler (amount_local ?? amount) and the
  // serverless populate. Without this the INSERT omitted currency (defaulting to the
  // schema's 'USD') and amount_local (NULL), so the same rule produced a USD row here but a
  // base-currency row on the client (audit M-02). The recurring amount is already in the
  // base currency (the rule has no currency/rate), so amount_local == amount.
  const currencyRow = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT value FROM settings WHERE key = ? AND profile_id = ?',
    'currency',
    pid
  );
  const baseCurrency = currencyRow?.value || 'EUR';

  const stmts: D1PreparedStatement[] = [];

  // Every statement is conditional on `next_date` still being what we read. A batch is one
  // transaction, so a competing batch either commits entirely before this one — in which case
  // next_date has already moved and nothing here matches — or entirely after, and sees ours.
  // The statement that moves next_date goes LAST, so the writes before it still see the pre-state.
  const guard = `(SELECT COUNT(*) FROM recurring_transactions
                   WHERE id = ?1 AND profile_id = ?2 AND next_date IS ?3) = 1`;
  const claim = [id, pid, r.next_date ?? null] as const;

  // 1. Insert the transaction, including account_id / transfer_account_id if set. Its text is
  //    sealed afresh for the transactions table from the rule's opened plaintext: additional data
  //    binds every value to its own table and column, so the rule's ciphertext would never open
  //    there. beneficiary and payor stay the literal '' — empty is stored unsealed in either form.
  const text = await sealForInsert(keyringFor(c), c.get('userId'), 'transactions', {
    description: r.description,
    notes: r.notes || '',
  });
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, account_id, transfer_account_id, date, notes, beneficiary, payor, currency, amount_local, text_enc)
       SELECT ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', '', ?12, ?5, ?13 WHERE ${guard}`
    ).bind(
      ...claim,
      text.description,
      r.amount,
      r.type,
      r.category_id,
      r.account_id ?? null,
      r.transfer_account_id ?? null,
      date,
      text.notes,
      baseCurrency,
      text.text_enc
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
      `UPDATE accounts SET balance = balance + ?4 WHERE id = ?5 AND profile_id = ?2 AND ${guard}`
    ).bind(...claim, delta, accId);
  if (r.account_id != null) {
    if (r.type === 'transfer' && r.transfer_account_id != null) {
      stmts.push(bal(-r.amount, r.account_id), bal(r.amount, r.transfer_account_id));
    } else if (r.type === 'income' || r.type === 'expense') {
      stmts.push(bal(r.type === 'income' ? r.amount : -r.amount, r.account_id));
    }
  } else if (r.transfer_account_id != null && (r.type === 'income' || r.type === 'transfer')) {
    stmts.push(bal(r.amount, r.transfer_account_id));
  }

  // 3. Advance next_date. This is the claim — last, and guarded like the rest.
  stmts.push(
    c.env.DB.prepare(
      `UPDATE recurring_transactions SET next_date = ?4
       WHERE id = ?1 AND profile_id = ?2 AND next_date IS ?3`
    ).bind(...claim, nextStr)
  );

  const results = await c.env.DB.batch(stmts);
  if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, 'Recurring transaction already populated for current period');
  }
  const txLastRowId = results[0]?.meta?.last_row_id;

  return c.json({
    ok: true,
    transactionId: txLastRowId,
    next_date: nextStr,
  });
});
