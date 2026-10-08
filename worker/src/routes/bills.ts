import { Hono } from 'hono';
import { BILL_MESSAGES, checkBillCreate, checkBillEdit } from '../../../shared/billSchema';
import {
  billDay,
  comingUp,
  daysFrom,
  isPaidUp,
  nextDueDate,
  paidFrom,
} from '../../../shared/billSchedule';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { configuredBaseCurrency } from '../base-currency';
import { getProfileId, getProfileIds } from '../profile';
import { accept, HttpError, refuse } from '../http';
import * as db from '../db';
import { localNow, localToday } from '../local-date';

// Port of backend/routes/bills.js + backend/repositories/billsRepo.js.
// Table: bills, LEFT JOINed to categories for name/color. Response shapes are
// kept identical (snake_case) to the Express backend.
export const billsRoutes = new Hono<AppEnv>();

export interface BillRow {
  id: number;
  name: string;
  amount: number;
  frequency: string;
  day_of_month: number | null;
  category_id: number | null;
  account_id: number | null;
  due_date: string | null;
  is_active: number;
  last_paid: string | null;
  last_paid_date: string | null;
  notes: string | null;
  type: string | null;
  autopay: number;
  category_name?: string | null;
  category_color?: string | null;
}

function billResponse(bill: BillRow) {
  return { ...bill, autopay: bill.autopay === 1 };
}

// Whether a bill is paid up, and when it falls due next, are shared/billSchedule.ts: one rule for
// the list, the calendar, GET /api/bills/upcoming, the Dashboard and mark-paid, in both runtimes.
// Each reads the person's today (localToday), so the period is theirs.

billsRoutes.get('/api/bills', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const rows = await db.all<BillRow>(
    c.env.DB,
    `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ?
      ORDER BY b.is_active DESC, b.name ASC
    `,
    pid
  );

  const today = localToday(c);

  // next_due_date is worked out, not read: the column is never written, and the due date a bill
  // was saved with is only its first.
  const billsWithStatus = rows.map((b) => ({
    ...billResponse(b),
    next_due_date: nextDueDate(b, today),
    paid: isPaidUp(b, today),
  }));

  // Filter by paid status if requested
  let result = billsWithStatus;
  const paidQ = c.req.query('paid');
  if (paidQ === 'true') {
    result = result.filter((b) => b.paid);
  } else if (paidQ === 'false') {
    result = result.filter((b) => !b.paid);
  }

  // Filter by type if requested (bill, subscription)
  const typeQ = c.req.query('type');
  if (typeQ) {
    result = result.filter((b) => (b.type || 'bill') === typeQ);
  }

  return c.json(result);
});

// Registered before /api/bills/:id so it isn't shadowed.
//
// Every active bill with when it falls due next (shared/billSchedule.ts), the most overdue first.
// It read `last_paid`, a column nothing writes, so marking a bill paid never moved it; and it went
// by the day of the month alone, 1 for every bill the Bills form saved, and had no date at all for
// a biweekly bill. `last_paid` answers the payment date now; the column stays, unread.
billsRoutes.get('/api/bills/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const today = localToday(c);

  const bills = await db.all<BillRow>(
    c.env.DB,
    `
      SELECT b.*, c.name as category_name, c.color as category_color
      FROM bills b
      LEFT JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
      WHERE b.profile_id = ? AND b.is_active = 1
      ORDER BY b.name ASC
    `,
    pid
  );

  return c.json(
    comingUp(bills, today).map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      day_of_month: b.day_of_month,
      category_name: b.category_name,
      category_color: b.category_color,
      category_id: b.category_id,
      last_paid: b.last_paid_date,
      last_paid_date: b.last_paid_date,
      next_due_date: b.next_due_date,
      days_until: b.days_until,
      is_overdue: b.is_overdue,
      paid: b.paid,
    }))
  );
});

billsRoutes.get('/api/bills/summary', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const bills = await db.all<BillRow>(c.env.DB, 'SELECT * FROM bills WHERE profile_id = ?', pid);
  const totalAmount = bills.reduce((s, b) => s + (b.amount || 0), 0);
  return c.json({ totalAmount, activeCount: bills.length, bills });
});

billsRoutes.get('/api/bills/notifications', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const bills = await db.all<BillRow>(
    c.env.DB,
    'SELECT * FROM bills WHERE profile_id = ? ORDER BY due_date ASC',
    pid
  );
  const today = localNow(c);
  const upcoming = bills.filter((b) => {
    if (!b.due_date) return false;
    const dueDate = new Date(b.due_date);
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
  });
  return c.json({ notifications: upcoming, count: upcoming.length });
});

billsRoutes.get('/api/bills/calendar', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const now = localNow(c);
  const today = localToday(c);

  const yearQ = c.req.query('year');
  const monthQ = c.req.query('month');
  const yearParam = yearQ ? parseInt(yearQ, 10) : now.getFullYear();
  const monthParam = monthQ ? parseInt(monthQ, 10) : now.getMonth() + 1;

  if (isNaN(yearParam) || yearParam < 1900) throw new HttpError(400, 'Invalid year');
  if (isNaN(monthParam) || monthParam < 1 || monthParam > 12)
    throw new HttpError(400, 'Invalid month');

  const year = yearParam;
  const month = monthParam;
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();

  const days: Record<string, unknown[]> = {};
  for (let d = 1; d <= lastDay; d++) {
    days[String(d)] = [];
  }

  const bills = await db.all<BillRow>(
    c.env.DB,
    `SELECT b.*, c.name as category_name, c.color as category_color
       FROM bills b
       LEFT JOIN categories c ON b.category_id = c.id AND c.profile_id = b.profile_id
       WHERE b.profile_id = ? AND b.is_active = 1`,
    pid
  );

  let totalAmount = 0;
  let paidAmount = 0;
  let billCount = 0;

  bills.forEach((b) => {
    // The bill's day of the month (shared/billSchedule.ts: its due date's), and a day the month does
    // not have falls on its last day, as shared/calendarMonths.ts moves a monthly date: a bill due on
    // the 31st was not drawn at all in February, April or June.
    const day = Math.min(billDay(b), lastDay);
    const billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isPaid = isPaidUp(b, today);

    days[String(day)]!.push({
      id: b.id,
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      category_id: b.category_id,
      category_name: b.category_name,
      category_color: b.category_color,
      date: billDateStr,
      paid: isPaid,
      type: b.type || 'bill',
      is_overdue: daysFrom(today, billDateStr) < 0 && !isPaid,
    });

    totalAmount += b.amount;
    if (isPaid) paidAmount += b.amount;
    billCount++;
  });

  return c.json({
    year,
    month,
    monthLabel,
    firstDow,
    days,
    summary: {
      totalAmount,
      paidAmount,
      billCount,
    },
  });
});

// The rules and their words are shared/billSchema.ts, which local-first and the Bills dialog run
// too: a refused body answers 400 { error, fields }. A category or an account of another profile
// is a 400 at its field; both were a 403 with no field.
billsRoutes.post('/api/bills', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const bill = accept(checkBillCreate(await c.req.json()));
  if (
    bill.account_id !== null &&
    !(await db.accountBelongsToProfile(c.env.DB, bill.account_id, pid))
  ) {
    throw refuse({ account_id: BILL_MESSAGES.account });
  }
  if (
    bill.category_id !== null &&
    !(await db.categoryBelongsToProfile(c.env.DB, bill.category_id, pid))
  ) {
    throw refuse({ category_id: BILL_MESSAGES.category });
  }
  const res = await db.insert(c.env.DB, 'bills', {
    profile_id: pid,
    ...bill,
    autopay: bill.autopay ? 1 : 0,
  });
  return c.json({ id: res.meta.last_row_id });
});

// An edit checks and writes only the fields whose value it changes (decision 2), so a bill an
// older version stored under other rules can still be renamed or paused.
billsRoutes.put('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const existing = await db.first<BillRow>(
    c.env.DB,
    'SELECT * FROM bills WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!existing) throw new HttpError(404, 'Not found');
  const edit = accept(checkBillEdit(await c.req.json(), existing));
  if (
    edit.account_id != null &&
    !(await db.accountBelongsToProfile(c.env.DB, edit.account_id, pid))
  ) {
    throw refuse({ account_id: BILL_MESSAGES.account });
  }
  if (
    edit.category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, edit.category_id, pid))
  ) {
    throw refuse({ category_id: BILL_MESSAGES.category });
  }
  const data: Record<string, unknown> = { ...edit };
  if (edit.autopay !== undefined) data.autopay = edit.autopay ? 1 : 0;
  if (edit.is_active !== undefined) data.is_active = edit.is_active ? 1 : 0;
  if (Object.keys(data).length > 0) {
    await db.update(c.env.DB, 'bills', data, 'id = ? AND profile_id = ?', id, pid);
  }
  return c.json({ ok: true });
});

// A bill the profile does not have is a 404, as in local-first: it answered 200 and deleted
// nothing (the contract's `delete-missing`).
billsRoutes.delete('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const res = await db.del(c.env.DB, 'bills', 'id = ? AND profile_id = ?', c.req.param('id'), pid);
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return c.json({ ok: true });
});

/**
 * The writes that mark `bill` paid today on the calendar of `now` (the caller's wall clock): the
 * expense, the account debit, and the claim on the bill, as one batch. Exported for the test that
 * runs two of them built from the same stale read.
 */
export function markPaidStatements(
  DB: D1Database,
  bill: BillRow,
  pid: number,
  now: Date,
  baseCurrency: string
): D1PreparedStatement[] {
  // Paid today on the person's calendar: the date the payment and last_paid_date carry.
  const todayStr = now.toISOString().split('T')[0]!;

  // Every statement carries the same guard: the bill has not been paid since its period began.
  //
  // Reading `last_paid_date` and then writing was a check against a value that could already be
  // stale by the time the batch ran — two taps (a phone that felt slow, or a phone and a laptop)
  // both saw an unpaid bill, and both inserted a transaction and both debited the account. The
  // money left twice.
  //
  // A batch is one transaction, so a second batch either runs entirely before or entirely after
  // the first; running after, it sees a `last_paid_date` on or after the period's start and every
  // guarded statement matches nothing. "Paid today" was not enough: a phone in Tokyo and a client
  // on UTC tapping at the same moment around midnight have different todays. The UPDATE goes LAST
  // so the two before it still see the pre-state.
  //
  // "Since its period began" is shared/billSchedule.ts's paidFrom: the first of the month, 1 January,
  // or the last 7 or 14 days with today included, so a weekly bill paid a week ago is due, and
  // payable, today. It counted 8 and 15 days, so a weekly bill could be paid only once overdue.
  const periodStart = paidFrom(bill.frequency, todayStr);
  const guard = (param: number) => `(SELECT COUNT(*) FROM bills
                   WHERE id = ?1 AND profile_id = ?2
                     AND (last_paid_date IS NULL OR last_paid_date < ?${param})) = 1`;

  const stmts: D1PreparedStatement[] = [];
  const id = bill.id;

  stmts.push(
    DB.prepare(
      `INSERT INTO transactions (profile_id, description, amount, type, category_id, account_id, date, notes, currency, amount_local)
       SELECT ?4, ?5, ?6, 'expense', ?7, ?8, ?3, ?9, ?10, ?6 WHERE ${guard(11)}`
    ).bind(
      id,
      pid,
      todayStr,
      pid,
      bill.name,
      bill.amount,
      bill.category_id,
      bill.account_id ?? null,
      bill.notes || '',
      baseCurrency,
      periodStart
    )
  );

  if (bill.account_id != null) {
    stmts.push(
      DB.prepare(
        // To the cent: 10.3 less 0.1 less 0.2 is 10, not 10.000000000000002.
        `UPDATE accounts SET balance = ROUND(balance - ?4, 2)
         WHERE id = ?5 AND profile_id = ?2 AND ${guard(6)}`
      ).bind(id, pid, todayStr, bill.amount, bill.account_id, periodStart)
    );
  }

  stmts.push(
    DB.prepare(
      `UPDATE bills SET last_paid_date = ?3 WHERE id = ?1 AND profile_id = ?2 AND ${guard(4)}`
    ).bind(id, pid, todayStr, periodStart)
  );
  return stmts;
}

billsRoutes.post('/api/bills/:id/mark-paid', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const id = c.req.param('id');
  const bill = await db.first<BillRow>(
    c.env.DB,
    'SELECT * FROM bills WHERE id = ? AND profile_id = ?',
    id,
    pid
  );
  if (!bill) throw new HttpError(404, 'Not found');

  // Pre-flight, for the message: it asks the guard's question before anything is written. It is
  // NOT what makes this safe — see the guard in markPaidStatements.
  const now = localNow(c);
  if (isPaidUp(bill, localToday(c))) {
    throw new HttpError(409, 'Bill already paid for current period');
  }

  // A bill has no currency field — its amount is in the profile's base currency by construction.
  // Say so on the transaction (currency = base, amount_local = amount), or the schema's
  // DEFAULT 'USD' stamps it as dollars and the app shows a converted-from-USD estimate on a
  // bill the user entered in their own currency. Same source + default as the recurring cron.
  const baseCurrency = (await configuredBaseCurrency(c.env.DB, pid)) ?? 'EUR';

  const stmts = markPaidStatements(c.env.DB, bill, pid, now, baseCurrency);
  const results = await c.env.DB.batch(stmts);
  // The claim is the last statement. Zero rows changed means another request got there first
  // between our read and our write, and this one wrote nothing at all.
  if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) {
    throw new HttpError(409, 'Bill already paid for current period');
  }
  const txLastRowId = results[0]?.meta?.last_row_id;

  return c.json({ ok: true, transactionId: txLastRowId });
});

// Registered after the specific /api/bills/* GET routes so it doesn't shadow them.
billsRoutes.get('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const bill = await db.first<BillRow>(
    c.env.DB,
    'SELECT * FROM bills WHERE id = ? AND profile_id = ?',
    c.req.param('id'),
    pid
  );
  if (!bill) throw new HttpError(404, 'Bill not found');
  return c.json(billResponse(bill));
});
