/**
 * The calendar year in totals: what came in, what went out, the best saving month and the
 * biggest category. One pass over the year's transactions, so it costs nothing to recompute.
 */
import { TRACKED_MONTH_MIN_TRANSACTIONS } from './definitions'
import { bucketByMonth, sumTypes } from './evaluate'
import type {EvaluateInput} from './evaluate';

export interface YearReview {
  year: number
  trackedMonths: number
  income: number
  expenses: number
  saved: number
  bestMonth: { month: string; saved: number } | null
  topCategory: { id: number; total: number } | null
  entries: number
}

export function buildYearReview(input: {
  transactions: EvaluateInput['transactions']
  today: string
  year?: number
}): YearReview {
  const year = input.year ?? Number(input.today.slice(0, 4))
  const prefix = String(year)
  const inYear = input.transactions.filter((t) => t.date.startsWith(prefix))
  const byMonth = bucketByMonth(inYear)

  let bestMonth: YearReview['bestMonth'] = null
  let trackedMonths = 0
  for (const [month, list] of byMonth) {
    if (list.length >= TRACKED_MONTH_MIN_TRANSACTIONS) trackedMonths++
    const saved = sumTypes(list, ['income']) - sumTypes(list, ['expense', 'deduction'])
    if (saved > 0 && (bestMonth === null || saved > bestMonth.saved)) bestMonth = { month, saved }
  }

  const perCategory = new Map<number, number>()
  for (const t of inYear) {
    if (t.type !== 'expense' || t.category_id === null) continue
    perCategory.set(t.category_id, (perCategory.get(t.category_id) ?? 0) + Math.abs(t.amount))
  }
  const top = [...perCategory.entries()].sort((a, b) => b[1] - a[1])[0]

  const income = sumTypes(inYear, ['income'])
  const expenses = sumTypes(inYear, ['expense', 'deduction'])
  return {
    year,
    trackedMonths,
    income,
    expenses,
    saved: income - expenses,
    bestMonth,
    topCategory: top ? { id: top[0], total: top[1] } : null,
    entries: inYear.length,
  }
}
