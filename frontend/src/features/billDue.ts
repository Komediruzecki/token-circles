/**
 * When a bill falls due next, as the Bills page, its subscription cards and the Dashboard say it.
 *
 * Both runtimes answer each bill's next_due_date (shared/billSchedule.ts): the day it falls due
 * this period, overdue once that day has passed unpaid, and the next period's once it is paid. The
 * pages read due_date, the first date the bill was saved with, which never moves: a monthly bill
 * saved in August said "49 days overdue" in October, paid or not, and sat with the overdue bills.
 *
 * Dates are read on this calendar. `new Date('2026-10-20')` is midnight UTC, which is the 19th
 * anywhere west of Greenwich.
 */
import { daysFrom } from '../../../shared/billSchedule'
import { formatDate } from '../../../shared/dateFormat'
import { localToday } from '../utils/period'

/** What a page holds of a bill's dates. */
export interface DueBill {
  /** The first date the bill falls due, as it was saved. */
  due_date: string
  /** The date it falls due next, as the runtimes work it out. */
  next_due_date?: string | null
}

/** The date the bill falls due next: next_due_date, or the first one for an answer without it. */
export const nextDue = (bill: DueBill): string => bill.next_due_date || bill.due_date

/** Days from today to the date the bill falls due next: 0 is today, below 0 is overdue. */
export const daysToDue = (bill: DueBill, today: string = localToday()): number =>
  daysFrom(today, nextDue(bill))

/** "Due today", "Due tomorrow", "Due in 12 days", "1 day overdue", "5 days overdue". */
export function dueInWords(days: number): string {
  if (days < -1) return `${-days} days overdue`
  if (days === -1) return '1 day overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/** "20 Oct 2026", or "20 Oct" without the year, read without a clock. */
export function dueDateLabel(date: string, withYear = true): string {
  return formatDate(date, withYear ? 'day' : 'dayMonth')
}
