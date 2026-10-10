import { Hono } from 'hono';
import type { Context } from 'hono';
import { nextOccurrence } from '../../../shared/calendarMonths';
import {
  checkRecurringCreate,
  checkRecurringEdit,
  RECURRING_MESSAGES as M,
} from '../../../shared/recurringSchema';
import { upcomingRecurring } from '../../../shared/recurringUpcoming';
import { transactionInvariantError } from '../../../shared/transactionInvariant';
import type { FieldErrors } from '../../../shared/refusal';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { getProfileId } from '../profile';
import { accept, HttpError, refuse } from '../http';
import * as db from '../db';
import { localToday } from '../local-date';

// Port of backend/routes/recurring.js + backend/repositories/recurringRepo.js.
// Table: recurring_transactions, LEFT JOINed to categories. Response shapes are
// kept identical (snake_case) to the Express backend. A body is checked by
// shared/recurringSchema.ts, as local-first checks it.
export const recurringRoutes = new Hono<AppEnv>();

/** The links a rule's body sets, each checked against the profile. */
interface RecurringLinks {
  category_id?: number | null;
  account_id?: number | null;
  transfer_account_id?: number | null;
}

/**
 * The links in `links` that are not the profile's, as refusals at their fields: a 400 at the
 * field, as a transaction's and a bill's are, where this route answered 403 at no field.
 */
async function foreignLinks(
  c: Context<AppEnv>,
  pid: number,
  links: RecurringLinks
): Promise<FieldErrors> {
  const fields: FieldErrors = {};
  const { DB } = c.env;
  if (links.account_id != null && !(await db.accountBelongsToProfile(DB, links.account_id, pid))) {
    fields.account_id = M.account;
  }
  if (
    links.transfer_account_id != null &&
    !(await db.accountBelongsToProfile(DB, links.transfer_account_id, pid))
  ) {
    fields.transfer_account_id = M.transferAccount;
  }
  if (
    links.category_id != null &&
    !(await db.categoryBelongsToProfile(DB, links.category_id, pid))
  ) {
    fields.category_id = M.category;
  }
  return fields;
}

export interface RecurringRow {
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
      LEFT JOIN categories c ON r.category_id = c.id AND c.profile_id = r.profile_id
      WHERE r.profile_id = ? AND r.active = 1
      ORDER BY r.next_date ASC
    `,
    pid
  );
  return c.json(rows);
});

// IMPORTANT: /upcoming must come before /:id to avoid :id capturing "upcoming".
// The next 30 days from today on the person's calendar (shared/recurringUpcoming.ts, which
// local-first answers with too): next_date is one of their dates.
recurringRoutes.get('/api/recurring/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const recurring = await db.all<RecurringRow>(
    c.env.DB,
    `
      SELECT r.id, r.description, r.amount, r.type, r.frequency, r.day_of_month, r.next_date,
             c.name as category_name, c.color as category_color
      FROM recurring_transactions r
      LEFT JOIN categories c ON r.category_id = c.id AND c.profile_id = r.profile_id
      WHERE r.profile_id = ? AND r.active = 1
    `,
    pid
  );
  const currencyRow = await db.first<{ value: string }>(
    c.env.DB,
    'SELECT value FROM settings WHERE key = ? AND profile_id = ?',
    'currency',
    pid
  );
  return c.json(
    upcomingRecurring(recurring, localToday(c), currencyRow ? currencyRow.value : 'EUR')
  );
});

recurringRoutes.get('/api/recurring/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const r = await db.first<RecurringRow>(
    c.env.DB,
    'SELECT * FROM recurring_transactions WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!r) throw new HttpError(404, M.notFound);
  return c.json(r);
});

recurringRoutes.post('/api/recurring', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rule = accept(checkRecurringCreate(await c.req.json()));
  const foreign = await foreignLinks(c, pid, rule);
  if (Object.keys(foreign).length > 0) throw refuse(foreign);
  const res = await db.insert(c.env.DB, 'recurring_transactions', { profile_id: pid, ...rule });
  return c.json({ id: res.meta.last_row_id }, 201);
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
  if (!existing) throw new HttpError(404, M.notFound);
  // Only what the edit changes is checked and written (decision 2): a link the rule already
  // holds is not checked again.
  const edit = accept(checkRecurringEdit(await c.req.json(), existing));
  const foreign = await foreignLinks(c, pid, edit);
  if (Object.keys(foreign).length > 0) throw refuse(foreign);
  const values: Record<string, unknown> = { ...edit };
  if (edit.active !== undefined) values.active = edit.active ? 1 : 0;
  if (Object.keys(values).length > 0) {
    await db.update(
      c.env.DB,
      'recurring_transactions',
      values,
      'id = ? AND profile_id = ?',
      id,
      pid
    );
  }
  return c.json({ ok: true });
});

recurringRoutes.delete('/api/recurring/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first(
    c.env.DB,
    'SELECT id FROM recurring_transactions WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, M.notFound);
  await db.del(c.env.DB, 'recurring_transactions', 'id = ? AND profile_id = ?', id, pid);
  return c.json({ ok: true });
});

// "Process due": materializes a transaction from the recurring rule and advances next_date.
/**
 * The writes that populate `r` for the period dated `date` and move its next_date on to `nextStr`:
 * the transaction, the account balances and the claim, as one batch. Exported for the test that
 * runs two of them built from the same stale read.
 */
export function populateStatements(
  DB: D1Database,
  r: RecurringRow,
  pid: number,
  date: string,
  nextStr: string,
  baseCurrency: string
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];

  // Every statement is conditional on `next_date` still being what we read. A batch is one
  // transaction, so a competing batch either commits entirely before this one — in which case
  // next_date has already moved and nothing here matches — or entirely after, and sees ours.
  // The statement that moves next_date goes LAST, so the writes before it still see the pre-state.
  const guard = `(SELECT COUNT(*) FROM recurring_transactions
                   WHERE id = ?1 AND profile_id = ?2 AND next_date IS ?3) = 1`;
  const claim = [r.id, pid, r.next_date ?? null] as const;

  // 1. Insert the transaction, including account_id / transfer_account_id if set.
  stmts.push(
    DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, account_id, transfer_account_id, date, notes, beneficiary, payor, currency, amount_local)
       SELECT ?2, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', '', ?12, ?5 WHERE ${guard}`
    ).bind(
      ...claim,
      r.description,
      r.amount,
      r.type,
      r.category_id,
      r.account_id ?? null,
      r.transfer_account_id ?? null,
      date,
      r.notes || '',
      baseCurrency
    )
  );

  // 2. Adjust account balances, mirroring the serverless computeBalanceDeltas
  //    (frontend/src/core/storage/idb.ts) exactly:
  //      - transfer with From (account_id) + To (transfer_account_id): debit From, credit To;
  //      - income/expense with an account: move that one account;
  //      - a transfer missing a leg makes NO change (money can't vanish);
  //      - an account-less recurring is a pure reminder (no balance change).
  const bal = (delta: number, accId: number) =>
    DB.prepare(
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
    DB.prepare(
      `UPDATE recurring_transactions SET next_date = ?4
       WHERE id = ?1 AND profile_id = ?2 AND next_date IS ?3`
    ).bind(...claim, nextStr)
  );

  return stmts;
}

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
  if (!r) throw new HttpError(404, M.notFound);
  const invariantError = transactionInvariantError(r);
  if (invariantError) throw new HttpError(400, invariantError);

  // Today on the person's calendar. On the UTC one a payment that fell due today was still
  // "tomorrow" for the first hours of a day east of UTC, and the guard below refused it.
  const todayStr = localToday(c);

  // Pre-flight, for the message. It is NOT what makes this safe: reading next_date and then
  // writing leaves a window in which another request does the same, and both then populate the
  // same period — two identical transactions, the account debited twice. The guard carried by
  // every statement below is what closes it.
  if (r.next_date && r.next_date > todayStr) {
    throw new HttpError(409, M.populated);
  }

  const date = r.next_date || todayStr;

  // Advance next_date past the populated period. EVERY frequency must move the
  // date forward — if it stalls (e.g. daily/biweekly falling through to no-op),
  // next_date stays <= today and the idempotency guard above never trips, so the
  // rule can be populated repeatedly and each run debits the account again.
  // nextOccurrence counts months on the calendar: setMonth() overflowed past a shorter month, so
  // a rule on the 31st went from January to 3 March, and stayed on the 3rd.
  const nextStr = nextOccurrence(date, r.frequency, r.day_of_month);
  if (!nextStr) throw new HttpError(400, M.unreadableNextDate);

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

  const stmts = populateStatements(c.env.DB, r, pid, date, nextStr, baseCurrency);

  const results = await c.env.DB.batch(stmts);
  if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, M.populated);
  }
  const txLastRowId = results[0]?.meta?.last_row_id;

  return c.json({
    ok: true,
    transactionId: txLastRowId,
    next_date: nextStr,
  });
});
