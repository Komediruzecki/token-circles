/**
 * Whole calendar months on YYYY-MM-DD dates. There is no Date in here, so no clock and no time
 * zone: the browser, the Worker and a test all get the same answer.
 *
 * Date.setMonth() overflows instead: 31 January plus one month is 3 March, because February has no
 * 31st. A monthly rule on the 31st skipped February that way, and stayed on the 3rd from then on.
 */

const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The number of days in `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * The date `months` calendar months after `date` (before it, for a negative count), on `day` of
 * that month, or on its last day when the month is shorter. `day` defaults to the day of `date`:
 * 2027-01-31 plus one month is 2027-02-28, and 2027-02-28 plus one month on day 31 is 2027-03-31.
 * '' when `date` cannot be read.
 */
export function addCalendarMonths(date: string, months: number, day?: number): string {
  const match = DATE.exec(date);
  if (!match || !Number.isInteger(months)) return '';
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  const wanted = day !== undefined && Number.isInteger(day) && day >= 1 ? day : Number(match[3]);
  const landed = Math.min(wanted, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(landed).padStart(2, '0')}`;
}

/**
 * The next date of a monthly rule that fell on `date`. The rule keeps its own day; a short month
 * moves it to that month's last day, and `dayOfMonth`, the day the rule was set up for, brings it
 * back the month after. Without one, a date a short month moved stays where it was moved to: the
 * date alone cannot say it was ever the 31st. `dayOfMonth` never moves a date the rule did not
 * clamp, so a rule whose stored day disagrees with its dates keeps the dates.
 */
export function nextMonthlyDate(date: string, dayOfMonth?: number | null): string {
  const match = DATE.exec(date);
  if (!match) return '';
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const clamped =
    dayOfMonth != null && dayOfMonth > day && day === daysInMonth(year, month) ? dayOfMonth : day;
  return addCalendarMonths(date, 1, clamped);
}

/** `date` moved by `days` days. '' when `date` cannot be read. */
export function addDays(date: string, days: number): string {
  const match = DATE.exec(date);
  if (!match || !Number.isInteger(days)) return '';
  const moved = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return moved.toISOString().slice(0, 10);
}

const DAY_STEPS: ReadonlyMap<string, number> = new Map([
  ['daily', 1],
  ['weekly', 7],
  ['biweekly', 14],
]);

/**
 * The date after `date` for a rule that repeats `frequency`: a day, a week or two weeks later, the
 * same day next year (28 February for the 29th), or the next month as nextMonthlyDate counts it.
 * Monthly is also the answer for a frequency this does not know, so a rule always moves forward.
 * '' when `date` cannot be read.
 */
export function nextOccurrence(
  date: string,
  frequency: string,
  dayOfMonth?: number | null
): string {
  const days = DAY_STEPS.get(frequency);
  if (days !== undefined) return addDays(date, days);
  if (frequency === 'yearly') return addCalendarMonths(date, 12);
  return nextMonthlyDate(date, dayOfMonth);
}
