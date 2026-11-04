/**
 * What counts as a tracked month, and as a year on file. One definition for everything that
 * counts months: the badges (frontend/src/core/achievements/evaluate.ts), the Getting started
 * steps (shared/orientation.ts) and the circles that come after them, so no two of them can
 * disagree about a count.
 */
// With its extension: worker/src/emailTemplates.ts reads this file, and the sample mails load it
// under plain Node, which resolves no import for it (mailSamplesUnderNode.test.ts).
import { addCalendarMonths } from './calendarMonths.ts';

/** A month is tracked when it holds at least this many transactions dated inside it, any type. */
export const TRACKED_MONTH_MIN_TRANSACTIONS = 3;

/** Whether a month with `transactions` entries dated inside it is tracked. */
export function isTrackedMonth(transactions: number): boolean {
  return transactions >= TRACKED_MONTH_MIN_TRANSACTIONS;
}

const MONTH_RE = /^\d{4}-\d{2}/;

/**
 * The tracked months among these transaction dates, as 'YYYY-MM', oldest first. Given `today`
 * ('YYYY-MM-DD'), none after its month: entries dated ahead, like a bill put in early, do not make
 * a month tracked before it has begun. The badges pass it, and so everything that reads their
 * months (the prints, the record on Progress) does too.
 */
export function trackedMonthsOf(dates: Iterable<string>, today?: string): string[] {
  const last = today === undefined ? null : today.slice(0, 7);
  const perMonth = new Map<string, number>();
  for (const date of dates) {
    if (!MONTH_RE.test(date)) continue;
    const month = date.slice(0, 7);
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  return [...perMonth.entries()]
    .filter(([month, n]) => isTrackedMonth(n) && (last === null || month <= last))
    .map(([month]) => month)
    .sort();
}

/**
 * A year on file: this many tracked months among the last YEAR_WINDOW_MONTHS calendar months
 * (trackedMonthsInYearWindow). The window is this month and the twelve before it, because this
 * month is still under way: a year of statements imported up to last month is a year on file.
 * Getting started's import-year step reads it. The "A year" badge is a different rule, twelve
 * tracked months in a row (achievements/evaluate.ts), and each surface names the one it counts.
 */
export const YEAR_ON_FILE_MONTHS = 12;
export const YEAR_WINDOW_MONTHS = 13;

/** How a month counts, said wherever months are counted. */
export const A_MONTH_COUNTS = `A month counts once it holds ${TRACKED_MONTH_MIN_TRANSACTIONS} entries.`;

/**
 * A year on file's count, the same on every surface (review M8): "3 of 12 months tracked". It
 * read "3 of the last 13 months are tracked" beside "3 of 12 months on file" on one card, and
 * "Months tracked of the last 13: 12" in the day-7 mail. It stops at the twelve a year needs, so
 * a window of thirteen tracked months never reads "13 of 12".
 */
export function monthsTrackedOfAYear(n: number): string {
  return `${Math.min(n, YEAR_ON_FILE_MONTHS)} of ${YEAR_ON_FILE_MONTHS} months tracked`;
}

/**
 * Under a figure averaged short of a year on file: "Based on 5 finished months. It firms up at 12
 * months tracked." The averages count finished months, this month left out, and a year on file
 * counts this month too, so each count says which it is (review M10).
 */
export function basedOnFinishedMonths(n: number): string {
  return `Based on ${n} finished ${n === 1 ? 'month' : 'months'}. It firms up at ${YEAR_ON_FILE_MONTHS} months tracked.`;
}

/** Tracked months in a row that make a print, as the app's shelf counts them (core/prints/windows.ts). */
export const PRINT_RUN_MONTHS = 12;

/**
 * How many prints these tracked months ('YYYY-MM', any order) make: each run of months in a row
 * makes one per twelve, and a gap starts the next run. The first comes with the "A year" badge.
 * The day-7 mail counts them on the Worker (review M11); a test holds it to the app's shelf.
 */
export function printsOf(trackedMonths: Iterable<string>): number {
  const months = [...new Set(trackedMonths)].sort();
  let prints = 0;
  let run = 0;
  let last: string | null = null;
  for (const month of months) {
    run = last !== null && addCalendarMonths(`${last}-01`, 1).slice(0, 7) === month ? run + 1 : 1;
    if (run % PRINT_RUN_MONTHS === 0) prints++;
    last = month;
  }
  return prints;
}

/** How many of `trackedMonths` ('YYYY-MM') fall in the year window that ends with `today`'s month. */
export function trackedMonthsInYearWindow(trackedMonths: Iterable<string>, today: string): number {
  const last = today.slice(0, 7);
  const first = addCalendarMonths(`${last}-01`, -(YEAR_WINDOW_MONTHS - 1)).slice(0, 7);
  let n = 0;
  for (const month of new Set(trackedMonths)) if (month >= first && month <= last) n++;
  return n;
}
