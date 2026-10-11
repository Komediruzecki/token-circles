/**
 * What counts as a tracked month, and as a year on file. One definition for everything that
 * counts months: the badges (frontend/src/core/achievements/evaluate.ts), the Getting started
 * steps (shared/orientation.ts) and the circles that come after them, so no two of them can
 * disagree about a count.
 */
import { addCalendarMonths } from './calendarMonths';

/** A month is tracked when it holds at least this many transactions dated inside it, any type. */
export const TRACKED_MONTH_MIN_TRANSACTIONS = 3;

/** Whether a month with `transactions` entries dated inside it is tracked. */
export function isTrackedMonth(transactions: number): boolean {
  return transactions >= TRACKED_MONTH_MIN_TRANSACTIONS;
}

const MONTH_RE = /^\d{4}-\d{2}/;

/** The tracked months among these transaction dates, as 'YYYY-MM', oldest first. */
export function trackedMonthsOf(dates: Iterable<string>): string[] {
  const perMonth = new Map<string, number>();
  for (const date of dates) {
    if (!MONTH_RE.test(date)) continue;
    const month = date.slice(0, 7);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  return [...perMonth.entries()]
    .filter(([, n]) => isTrackedMonth(n))
    .map(([month]) => month)
    .sort();
}

/**
 * A year on file: this many tracked months among the last YEAR_WINDOW_MONTHS calendar months.
 * The window is this month and the twelve before it, because this month is still under way: a
 * year of statements imported up to last month is a year on file.
 */
export const YEAR_ON_FILE_MONTHS = 12;
export const YEAR_WINDOW_MONTHS = 13;

/** How many of `trackedMonths` ('YYYY-MM') fall in the year window that ends with `today`'s month. */
export function trackedMonthsInYearWindow(trackedMonths: Iterable<string>, today: string): number {
  const last = today.slice(0, 7);
  const first = addCalendarMonths(`${last}-01`, -(YEAR_WINDOW_MONTHS - 1)).slice(0, 7);
  let n = 0;
  for (const month of new Set(trackedMonths)) if (month >= first && month <= last) n++;
  return n;
}

/** Whether a year is on file: YEAR_ON_FILE_MONTHS tracked months in the year window. */
export function hasYearOnFile(trackedMonths: Iterable<string>, today: string): boolean {
  return trackedMonthsInYearWindow(trackedMonths, today) >= YEAR_ON_FILE_MONTHS;
}
