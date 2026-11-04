/**
 * Dates as the app writes them: day first, with the month's name, "4 Nov 2026". The same words in
 * every browser and on the Worker, whatever language the browser is set to.
 *
 * Every page used to format its own: Goals and the bill calendar wrote "Nov 4, 2026" (en-US),
 * Accounts and Analytics the browser's own numeric form ("11/4/2026" in an English (US)
 * browser), Housing's month names followed the browser's language. They all come here now. The
 * month names are written out rather than asked of Intl, so September is "Sep" everywhere: en-GB
 * writes "Sept", and the period bar, the charts and the loan schedule already write "Sep".
 *
 * A stored date is a calendar day, 'YYYY-MM-DD', and is read without a clock:
 * `new Date('2026-11-04')` is midnight UTC, which anywhere west of Greenwich is still 3 November,
 * so a page that formatted it in the local zone showed every date a day early there.
 */

export const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A day on the calendar. `month` counts from 1. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * The calendar day a stored value names, or null.
 *
 * - 'YYYY-MM-DD', read as written. Anything after the tenth character is ignored, so a legacy row
 *   that stored a full `toISOString()` lands on the date it was written with.
 * - 'YYYY-MM', a month: its 1st.
 * - A Date: its own day in this runtime's zone (the browser's zone is the person's).
 *
 * Nothing else is a date here: a day that does not exist (2026-02-30), a numeric form whose order
 * is a guess (04/11/2026), Google Sheets' Date(2026,10,4). Imports turn all of those into
 * 'YYYY-MM-DD' before they are stored.
 */
export function calendarDay(value: unknown): CalendarDay | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value);
  if (!m) return null;
  // A month alone is 'YYYY-MM' and nothing more; '2026-11-04' is never read as a month.
  if (m[3] === undefined && value.length !== 7) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] === undefined ? 1 : Number(m[3]);
  if (month < 1 || month > 12) return null;
  // Day 0 of the next month is the last of this one.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > last) return null;
  return { year, month, day };
}

/**
 * - `day`: 4 Nov 2026
 * - `dayLong`: 4 November 2026
 * - `dayMonth`: 4 Nov, where the year goes without saying
 * - `month`: Nov 2026
 * - `monthLong`: November 2026
 */
export type DateStyle = 'day' | 'dayLong' | 'dayMonth' | 'month' | 'monthLong';

/** A date in the app's words, see `DateStyle`. What is not a date comes back as it was. */
export function formatDate(value: unknown, style: DateStyle = 'day'): string {
  const d = calendarDay(value);
  if (!d) return typeof value === 'string' ? value : '';
  const short = MONTHS_SHORT[d.month - 1];
  const long = MONTHS_LONG[d.month - 1];
  switch (style) {
    case 'dayLong':
      return `${d.day} ${long} ${d.year}`;
    case 'dayMonth':
      return `${d.day} ${short}`;
    case 'month':
      return `${short} ${d.year}`;
    case 'monthLong':
      return `${long} ${d.year}`;
    default:
      return `${d.day} ${short} ${d.year}`;
  }
}

/** The month's name alone, "Nov" or "November", for a chart's axis or a list of months. */
export function monthName(value: unknown, form: 'short' | 'long' = 'short'): string {
  const d = calendarDay(value);
  if (!d) return typeof value === 'string' ? value : '';
  return (form === 'long' ? MONTHS_LONG : MONTHS_SHORT)[d.month - 1];
}

/**
 * A moment: when something happened, not a calendar day. Stamps with no zone are UTC, as D1's
 * `datetime('now')` writes them ('2026-11-04 23:30:00'); an ISO stamp keeps its own zone. Invalid
 * Date for anything else.
 */
export function parseMoment(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value !== 'string' || value === '') return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

/**
 * A moment on this runtime's calendar and clock: "4 Nov 2026, 15:30", or the day alone with
 * `{ time: false }`. The browser's zone is the person's. What is not a moment comes back as it was.
 */
export function formatMoment(value: unknown, opts: { time?: boolean } = {}): string {
  // A day without a clock is a calendar day: '2026-11-04' would parse as midnight UTC.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  const at = parseMoment(value);
  if (Number.isNaN(at.getTime())) return typeof value === 'string' ? value : '';
  const day = formatDate(at);
  if (opts.time === false) return day;
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${day}, ${hh}:${mm}`;
}
