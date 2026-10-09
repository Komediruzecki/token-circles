/**
 * The weeks Analytics drills into, Sunday to Saturday, on YYYY-MM-DD dates. Like
 * calendarMonths.ts there is no Date in the answer, only in the arithmetic on UTC days, so the
 * browser, the Worker and a test all get the same weeks in any time zone.
 *
 * GET /api/analytics/weeks lists them and GET /api/analytics/category-trends answers one of them,
 * in both runtimes. The list used to stop at the week of the 29th, so a month's last days that
 * start a new week (30 and 31 March 2025, a Sunday and a Monday) were in no week, and the trends
 * read week N as days 7N-6 to 7N of the month: week 2 answered 8 to 14 March under the label
 * "2 to 8 March".
 */
import { addDays, daysInMonth } from './calendarMonths';

export interface CalendarWeek {
  /** 1 for the week that holds the first day asked for, and so on. */
  week: number;
  /** Its Sunday, YYYY-MM-DD. */
  start: string;
  /** Its Saturday, YYYY-MM-DD. */
  end: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 0 for a Sunday to 6 for a Saturday; NaN when `date` cannot be read. */
function weekday(date: string): number {
  const match = DATE.exec(date);
  if (!match) return NaN;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/**
 * Every Sunday-to-Saturday week that holds a day from `first` to `last`, in order. The first
 * starts on the Sunday on or before `first` and the last holds `last`, so every day of the range
 * is in exactly one of them. None when either date cannot be read or `last` comes before `first`.
 */
export function weeksCovering(first: string, last: string): CalendarWeek[] {
  const back = weekday(first);
  if (Number.isNaN(back) || Number.isNaN(weekday(last)) || last < first) return [];
  const weeks: CalendarWeek[] = [];
  for (
    let start = addDays(first, -back);
    start !== '' && start <= last;
    start = addDays(start, 7)
  ) {
    weeks.push({ week: weeks.length + 1, start, end: addDays(start, 6) });
  }
  return weeks;
}

// Four-digit years whose weeks end in one too: Date.UTC reads 0 to 99 as 1900 to 1999, and the
// last week of 9999 would end in the year 10000.
const inRange = (year: number) => Number.isInteger(year) && year >= 1000 && year < 9999;

/** The weeks that hold a day of `month` (1 to 12) of `year`. None for a month that is not one. */
export function weeksOfMonth(year: number, month: number): CalendarWeek[] {
  if (!inRange(year) || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  return weeksCovering(`${prefix}-01`, `${prefix}-${daysInMonth(year, month)}`);
}

/** The weeks that hold a day of `year`. */
export function weeksOfYear(year: number): CalendarWeek[] {
  if (!inRange(year)) return [];
  const y = String(year).padStart(4, '0');
  return weeksCovering(`${y}-01-01`, `${y}-12-31`);
}

/**
 * The weeks GET /api/analytics/weeks lists for `year` and its `month` query parameter as it came
 * (null or undefined when there is none), in both runtimes. A month asked for has its own weeks,
 * and none when it is not 1 to 12, as a year that cannot be read has none. Only no month at all
 * is the year's: local-first read month=0 as no month and listed the year's 53 weeks.
 */
export function weeksAsked(year: number, month: string | null | undefined): CalendarWeek[] {
  return month === null || month === undefined
    ? weeksOfYear(year)
    : weeksOfMonth(year, parseInt(month, 10));
}

/** How the week list names a week: `Week 2 (2025-03-02 - 2025-03-08)`. */
export function weekLabel(week: CalendarWeek): string {
  return `Week ${week.week} (${week.start} - ${week.end})`;
}

/** The seven days of a week, Sunday first. */
export function daysOfWeek(week: CalendarWeek): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
}
