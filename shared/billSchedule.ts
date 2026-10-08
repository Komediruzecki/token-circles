/**
 * When a bill is paid up, and when it falls due next: one rule for the Bills page, its calendar,
 * the Dashboard's Upcoming Bills, GET /api/bills/upcoming and marking a bill paid, in both
 * runtimes. Dates are YYYY-MM-DD on the person's calendar, with no clock and no time zone in here.
 *
 * What it replaces:
 *
 * - The Dashboard listed the bills whose stored due date fell in the next 30 days. Marking a bill
 *   paid never moves that date, so a monthly bill stayed on the date it was set up with: once it
 *   was past, the bill left the card for good. Local-first listed none at all.
 * - GET /api/bills/upcoming worked from the day of the month alone, 1 when it was blank, which it
 *   is for every bill the Bills form saves; and it read `last_paid`, a column nothing writes, so a
 *   payment never moved it either. Local-first answered the stored rows.
 * - Local-first asked "is the payment in this month?" where the Worker asks "on or after the start
 *   of this period?", the question that holds across two calendars (bills-paid-across-zones).
 * - A weekly bill counted a payment from 7 days back, 14 for a biweekly one, as paying it up, so on
 *   the day it fell due again it could not be paid: only once it was overdue.
 *
 * A bill's day of the month is its due date's day: the Bills form saves no other. `day_of_month`
 * counts only for a bill with no due date the calendar can read. Monthly and yearly bills fall
 * due on that day (or the month's last, when it is shorter), weekly and biweekly ones every seven
 * or fourteen days.
 *
 * Paid up means a payment on or after the start of the current period: the first of this month
 * for a monthly bill, 1 January for a yearly one, the last 7 or 14 days for a weekly or biweekly
 * one. The next due date is the current period's when the bill is not paid up (in the past, it is
 * overdue), and the next period's when it is. Never before the bill's own first due date.
 *
 * GET /api/bills/upcoming answers every active bill this way, the most overdue first; the
 * Dashboard lists the ones due from today through the next 30 days.
 */
import { addCalendarMonths, addDays, daysInMonth } from './calendarMonths';

/** The frequencies a bill can have; anything else is read as monthly. */
const STEP_DAYS: ReadonlyMap<string, number> = new Map([
  ['weekly', 7],
  ['biweekly', 14],
]);

/**
 * What these rules read of a bill, as either runtime stores it. Any value is read: a row an older
 * version or an import stored can hold anything, and what the rules cannot read they treat as
 * missing.
 */
export interface BillTiming {
  frequency?: unknown;
  day_of_month?: unknown;
  due_date?: unknown;
  last_paid_date?: unknown;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** The YYYY-MM-DD at the start of `text`, when it is one: a stored date may carry a time. */
function dateOf(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** The frequency the rules use: monthly for one they do not know. */
function frequencyOf(bill: BillTiming): string {
  const frequency = typeof bill.frequency === 'string' ? bill.frequency.trim().toLowerCase() : '';
  return STEP_DAYS.has(frequency) || frequency === 'yearly' ? frequency : 'monthly';
}

/** The day of the month the bill falls on: its due date's, else `day_of_month`, else the 1st. */
export function billDay(bill: BillTiming): number {
  const due = dateOf(bill.due_date);
  if (due) return Number(due.slice(8, 10));
  const day = Number(bill.day_of_month);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
}

/**
 * The first day of the period `today` is in, for `frequency`: a payment dated on or after it has
 * paid the bill up. Two clients on different calendars agree on it, whichever stamped the
 * payment (worker/test/bills-paid-across-zones.test.ts).
 */
export function paidFrom(frequency: unknown, today: string): string {
  const known = frequencyOf({ frequency });
  const step = STEP_DAYS.get(known);
  if (step !== undefined) return addDays(today, -(step - 1));
  if (known === 'yearly') return `${today.slice(0, 4)}-01-01`;
  return `${today.slice(0, 7)}-01`;
}

/** Whether the bill is paid up for the period `today` is in. */
export function isPaidUp(bill: BillTiming, today: string): boolean {
  const paid = dateOf(bill.last_paid_date);
  return paid !== null && paid >= paidFrom(bill.frequency, today);
}

/** The date a monthly or yearly bill falls due in the month of `date`. */
function inMonthOf(date: string, day: number): string {
  return addCalendarMonths(`${date.slice(0, 7)}-01`, 0, day);
}

/**
 * The next date the bill falls due, YYYY-MM-DD, on `today` (the person's date). In the past when
 * the bill is overdue, `today` when it is due today.
 */
export function nextDueDate(bill: BillTiming, today: string): string {
  const frequency = frequencyOf(bill);
  const first = dateOf(bill.due_date);
  const paidUp = isPaidUp(bill, today);
  let next: string;

  const step = STEP_DAYS.get(frequency);
  if (step !== undefined) {
    const paid = dateOf(bill.last_paid_date);
    if (paid !== null && (first === null || paid >= first)) {
      // Due a week (or two) after the last payment: today at the earliest when it is paid up.
      next = addDays(paid, step);
    } else if (first !== null && first < today) {
      // Never paid since it began: its latest date on or before today.
      const days = Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000);
      next = addDays(first, days - (days % step));
    } else {
      next = first ?? today;
    }
  } else if (frequency === 'yearly') {
    // Its due date's month, or January for a bill with only a day of the month.
    const month = first ? first.slice(5, 7) : '01';
    const thisYear = addCalendarMonths(`${today.slice(0, 4)}-${month}-01`, 0, billDay(bill));
    next = paidUp ? addCalendarMonths(thisYear, 12, billDay(bill)) : thisYear;
  } else {
    const thisMonth = inMonthOf(today, billDay(bill));
    next = paidUp ? addCalendarMonths(thisMonth, 1, billDay(bill)) : thisMonth;
  }

  return first !== null && first > next ? first : next;
}

/** Whole days from `today` to `date`: negative when it is past. */
export function daysFrom(today: string, date: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/** When a bill falls due next, as GET /api/bills/upcoming and the Dashboard answer it. */
export interface DueNext {
  next_due_date: string;
  days_until: number;
  is_overdue: boolean;
  paid: boolean;
}

/** What `comingUp` reads of a bill: its timing, whether it is active, and its name for ties. */
export interface ScheduledBill extends BillTiming {
  is_active?: unknown;
  name?: unknown;
}

const nameOf = (bill: ScheduledBill): string => (typeof bill.name === 'string' ? bill.name : '');

/**
 * Every active bill with when it falls due next, the most overdue first, then the soonest, then
 * by name. A paused bill (is_active 0) falls due on no date.
 */
export function comingUp<T extends ScheduledBill>(
  bills: readonly T[],
  today: string
): (T & DueNext)[] {
  return bills
    .filter((bill) => bill.is_active !== 0 && bill.is_active !== false)
    .map((bill) => {
      const next = nextDueDate(bill, today);
      const days = daysFrom(today, next);
      return {
        ...bill,
        next_due_date: next,
        days_until: days,
        is_overdue: days < 0,
        paid: isPaidUp(bill, today),
      };
    })
    .sort((a, b) => a.days_until - b.days_until || nameOf(a).localeCompare(nameOf(b)));
}

/**
 * The Dashboard's Upcoming Bills: the active bills that fall due from today through `days` days
 * on, soonest first. One overdue is not upcoming: the Bills page lists it as unpaid.
 */
export function dueWithin<T extends ScheduledBill>(
  bills: readonly T[],
  today: string,
  days: number
): (T & DueNext)[] {
  return comingUp(bills, today).filter((bill) => bill.days_until >= 0 && bill.days_until <= days);
}
