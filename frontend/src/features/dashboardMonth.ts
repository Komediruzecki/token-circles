/**
 * The Dashboard's month in week one, and the words a month's change uses (review M6).
 *
 * People who imported August to October on 3 November met a Dashboard of November: "INCOME €0.00",
 * "↓2350.00 vs last month" beside "€2,350.00", and "No flows for November 2026 yet". While Getting
 * started shows, a Dashboard whose month has no entries opens on the latest month that has some and
 * says so: "November has no entries yet. Showing October." A change against the month before names
 * its currency and that month: "↓€2,350.00 vs October".
 */
import { monthName } from '../../../shared/orientation'
import { formatCurrency } from '../core/api'
import type { Currency } from '../types/models'

/**
 * Whether the week-one month is still to be decided this session: true once, then false. The
 * Dashboard decides it when it is first shown with what it needs, and never moves the month again.
 */
let weekOneMonthTaken = false
export function takeWeekOneMonth(): boolean {
  if (weekOneMonthTaken) return false
  weekOneMonthTaken = true
  return true
}
export function __resetWeekOneMonthForTest(): void {
  weekOneMonthTaken = false
}

/** A month of the Dashboard's charts: present when the month has entries (both runtimes). */
export interface ChartMonth {
  month: string
  income: number
  expense: number
}

/**
 * The latest month before `current` (YYYY-MM) with entries, when `current` has none; else null.
 * The charts list a month once it holds any entry, a transfer included.
 */
export function latestMonthWithEntries(
  monthly: readonly ChartMonth[],
  current: string
): string | null {
  if (monthly.some((m) => m.month === current)) return null
  let latest: string | null = null
  for (const { month } of monthly) {
    if (month < current && (latest === null || month > latest)) latest = month
  }
  return latest
}

/** "November has no entries yet. Showing October.", with the year of a month from another year. */
export function emptyMonthNote(current: string, shown: string): string {
  const named = (month: string) =>
    month.slice(0, 4) === current.slice(0, 4)
      ? monthName(month)
      : `${monthName(month)} ${month.slice(0, 4)}`
  return `${monthName(current)} has no entries yet. Showing ${named(shown)}.`
}

/** The month before `month` (YYYY-MM). */
function monthBefore(month: string): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7)) - 1
  const d = new Date(Date.UTC(year, index - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface MonthChange {
  arrow: '↑' | '↓' | '→'
  direction: 'up' | 'down' | 'level'
  /** The size of the change, in the currency: "€2,350.00". */
  amount: string
  /** "vs October": the month the change is against. */
  against: string
}

/** A change of `delta` in `focus` (YYYY-MM) against the month before it. */
export function monthChange(delta: number, focus: string, currency: Currency): MonthChange {
  const amount = formatCurrency(Math.abs(delta), currency)
  const level = Math.abs(delta) < 0.005
  return {
    arrow: level ? '→' : delta > 0 ? '↑' : '↓',
    direction: level ? 'level' : delta > 0 ? 'up' : 'down',
    amount,
    against: `vs ${monthName(monthBefore(focus))}`,
  }
}
