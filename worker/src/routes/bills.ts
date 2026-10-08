import { Hono } from 'hono';
import { addCalendarMonths, addDays } from '../../../shared/calendarMonths';
import type { AppEnv } from '../index';
import { requireAuth } from '../auth';
import { configuredBaseCurrency } from '../base-currency';
import { getProfileId, getProfileIds } from '../profile';
import { HttpError } from '../http';
import * as db from '../db';
import { localNow } from '../local-date';

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

// The earliest last_paid_date that settles a bill for the current period, YYYY-MM-DD: the first of
// this month for a monthly bill, 1 January for a yearly one, seven or fourteen days ago for a
// weekly or biweekly one. `now` is the caller's wall clock (localNow), so the period is theirs.
//
// "On or after", not "in": two clients can be on different calendars. At 23:30 UTC on 31 October it
// is already 1 November in Tokyo, so a phone there stamps a payment 2026-11-01 while a client with
// no zone (UTC) is still in October. Asked "is the payment in my month?", each said no to the
// other's date and paid again. A payment dated after the period began has settled it, whichever
// calendar stamped it.
function paidFromDate(frequency: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const daysBack = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  if (frequency === 'monthly') return `${today.slice(0, 7)}-01`;
  if (frequency === 'weekly') return daysBack(7);
  if (frequency === 'biweekly') return daysBack(14);
  if (frequency === 'yearly') return `${today.slice(0, 4)}-01-01`;
  // No period: only a payment made today (or stamped later by a calendar ahead of this one).
  return today;
}

// Ported from backend/routes/bills.js, which compared the payment's month (or year) with the
// current one; see paidFromDate for why it is now "on or after the period's start".
function isBillPaidForCurrentPeriod(bill: BillRow, now: Date): boolean {
  if (!bill.last_paid_date) return false;
  if (!['monthly', 'weekly', 'biweekly', 'yearly'].includes(bill.frequency)) return false;
  return bill.last_paid_date.slice(0, 10) >= paidFromDate(bill.frequency, now);
}

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

  const now = localNow(c);

  const billsWithStatus = rows.map((b) => ({
    ...billResponse(b),
    paid: isBillPaidForCurrentPeriod(b, now),
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
billsRoutes.get('/api/bills/upcoming', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  // Due dates are the person's calendar dates, so "now" is their wall clock.
  const now = localNow(c);
  const todayStr = now.toISOString().split('T')[0];

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

  // Due dates are worked out on the calendar, as YYYY-MM-DD, and compared with today's date. They
  // were Dates at midnight compared with the current instant, so a bill due today was already in
  // the past at 00:01 and moved to next month; and setMonth() overflowed past a shorter month, so
  // a bill on the 30th went from January to 2 March.
  const upcoming = bills.map((b) => {
    let nextDue = '';
    const lastPaid = b.last_paid ? b.last_paid.slice(0, 10) : null;

    if (b.frequency === 'monthly') {
      const dayOfMonth = b.day_of_month || 1;
      if (lastPaid) {
        nextDue = addCalendarMonths(lastPaid, 1, dayOfMonth);
      } else {
        const thisMonth = addCalendarMonths(`${todayStr.slice(0, 7)}-01`, 0, dayOfMonth);
        nextDue = thisMonth < todayStr ? addCalendarMonths(thisMonth, 1, dayOfMonth) : thisMonth;
      }
    } else if (b.frequency === 'weekly') {
      nextDue = addDays(lastPaid ?? todayStr, 7);
    } else if (b.frequency === 'yearly') {
      if (lastPaid) {
        nextDue = addCalendarMonths(lastPaid, 12);
      } else {
        // In January: a yearly bill without a payment has only its day of the month to go on.
        const dayOfMonth = b.day_of_month || 1;
        const thisYear = addCalendarMonths(`${todayStr.slice(0, 4)}-01-01`, 0, dayOfMonth);
        nextDue = thisYear < todayStr ? addCalendarMonths(thisYear, 12, dayOfMonth) : thisYear;
      }
    }

    const nextDueStr = nextDue || null;
    const daysUntil = nextDueStr
      ? Math.round((Date.parse(nextDueStr) - Date.parse(todayStr)) / (1000 * 60 * 60 * 24))
      : null;
    const isOverdue = daysUntil !== null && daysUntil < 0;

    return {
      id: b.id,
      name: b.name,
      amount: b.amount,
      frequency: b.frequency,
      day_of_month: b.day_of_month,
      category_name: b.category_name,
      category_color: b.category_color,
      category_id: b.category_id,
      last_paid: b.last_paid,
      next_due_date: nextDueStr,
      days_until: daysUntil,
      is_overdue: isOverdue,
      paid: isBillPaidForCurrentPeriod(b, now),
    };
  });

  upcoming.sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    if (a.days_until !== null && b.days_until !== null) return a.days_until - b.days_until;
    if (a.days_until !== null) return -1;
    if (b.days_until !== null) return 1;
    return 0;
  });

  return c.json(upcoming);
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
    // Determine occurrence in the given month. For simplicity we use due_date's day or day_of_month
    let day: number;
    let billDateStr: string;

    if (b.due_date) {
      const dDate = new Date(b.due_date);
      day = dDate.getDate();
    } else if (b.day_of_month) {
      day = b.day_of_month;
    } else {
      day = 1; // Fallback
    }
    // A day the month does not have falls on its last day, as shared/calendarMonths.ts moves a
    // monthly date: a bill due on the 31st was not drawn at all in February, April or June.
    day = Math.min(day, lastDay);
    billDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (day >= 1) {
      const isPaid = isBillPaidForCurrentPeriod(b, now);

      // Calculate is_overdue for the specific bill occurrence in this month
      const nextDue = new Date(billDateStr);
      const daysUntil = Math.ceil((nextDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const is_overdue = daysUntil < 0 && !isPaid;

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
        is_overdue,
      });

      totalAmount += b.amount;
      if (isPaid) paidAmount += b.amount;
      billCount++;
    }
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

billsRoutes.post('/api/bills', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  const b = (await c.req.json()) as Record<string, any>;
  const {
    name,
    amount,
    frequency,
    day_of_month,
    category_id,
    account_id,
    notes,
    type,
    dueDate,
    autopay,
  } = b;
  if (!name || amount === undefined) throw new HttpError(400, 'Name and amount are required');
  if (!dueDate) throw new HttpError(400, 'Due date is required');
  if (isNaN(Date.parse(dueDate))) throw new HttpError(400, 'Invalid due date format');
  if (parseFloat(amount) <= 0) throw new HttpError(400, 'Amount must be positive');
  // Validate account ownership before accepting account_id from client input.
  if (
    account_id != null &&
    !(await db.accountBelongsToProfile(c.env.DB, Number(account_id), pid))
  ) {
    throw new HttpError(403, 'Account does not belong to this profile');
  }
  if (
    category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, Number(category_id), pid))
  ) {
    throw new HttpError(403, 'Category does not belong to this profile');
  }
  const res = await db.insert(c.env.DB, 'bills', {
    profile_id: pid,
    name,
    amount,
    frequency: frequency || 'monthly',
    day_of_month: day_of_month || null,
    category_id: category_id || null,
    account_id: account_id || null,
    notes: notes || '',
    type: type || 'bill',
    due_date: dueDate,
    autopay: autopay ? 1 : 0,
  });
  return c.json({ id: res.meta.last_row_id });
});

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
  const b = (await c.req.json()) as Record<string, any>;
  const {
    name,
    amount,
    frequency,
    day_of_month,
    category_id,
    account_id,
    is_active,
    notes,
    type,
    dueDate,
    due_date,
    autopay,
  } = b;
  const nextDueDate = dueDate ?? due_date ?? existing.due_date;
  if (nextDueDate && isNaN(Date.parse(nextDueDate))) {
    throw new HttpError(400, 'Invalid due date format');
  }
  if (amount !== undefined && parseFloat(amount) <= 0) {
    throw new HttpError(400, 'Amount must be positive');
  }
  // Validate account ownership if account_id is being changed.
  if (
    account_id != null &&
    !(await db.accountBelongsToProfile(c.env.DB, Number(account_id), pid))
  ) {
    throw new HttpError(403, 'Account does not belong to this profile');
  }
  if (
    category_id != null &&
    !(await db.categoryBelongsToProfile(c.env.DB, Number(category_id), pid))
  ) {
    throw new HttpError(403, 'Category does not belong to this profile');
  }
  await db.update(
    c.env.DB,
    'bills',
    {
      name: name ?? existing.name,
      amount: amount ?? existing.amount,
      frequency: frequency ?? existing.frequency,
      day_of_month: day_of_month === undefined ? existing.day_of_month : day_of_month,
      category_id: category_id === undefined ? existing.category_id : category_id,
      account_id: account_id === undefined ? existing.account_id : account_id,
      is_active: is_active ?? existing.is_active,
      notes: notes ?? existing.notes,
      type: type ?? existing.type,
      due_date: nextDueDate,
      autopay: autopay === undefined ? existing.autopay : autopay ? 1 : 0,
    },
    'id = ? AND profile_id = ?',
    id,
    pid
  );
  return c.json({ ok: true });
});

billsRoutes.delete('/api/bills/:id', requireAuth, async (c) => {
  const pid = await getProfileId(c);
  await db.del(c.env.DB, 'bills', 'id = ? AND profile_id = ?', c.req.param('id'), pid);
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
  const todayStr = now.toISOString().split('T')[0];

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
  const paidFrom = paidFromDate(bill.frequency, now);
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
      paidFrom
    )
  );

  if (bill.account_id != null) {
    stmts.push(
      DB.prepare(
        `UPDATE accounts SET balance = balance - ?4
         WHERE id = ?5 AND profile_id = ?2 AND ${guard(6)}`
      ).bind(id, pid, todayStr, bill.amount, bill.account_id, paidFrom)
    );
  }

  stmts.push(
    DB.prepare(
      `UPDATE bills SET last_paid_date = ?3 WHERE id = ?1 AND profile_id = ?2 AND ${guard(4)}`
    ).bind(id, pid, todayStr, paidFrom)
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
  if (isBillPaidForCurrentPeriod(bill, now)) {
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
