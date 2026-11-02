/**
 * The calendar year in totals: what came in, what went out, the best saving month and the
 * biggest category. One pass over the year's transactions, so it costs nothing to recompute.
 *
 * What came in is income less deductions, and what went out is expenses: a deduction is pay that
 * never reached an account (shared/guidance/flows.ts).
 */
import { flowsOf, savedOf } from '../../../../shared/guidance/flows'
import { isTrackedMonth } from '../../../../shared/trackedMonths'
import { baseAmount, bucketByMonth } from './evaluate'
import type { EvaluateInput } from './evaluate'

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
  // Tracked as the badges count it: a month after this one is not, whatever is dated in it. Nor
  // is it the best month: a salary entered ahead would make December the best month in October.
  const thisMonth = input.today.slice(0, 7)
  for (const [month, list] of byMonth) {
    if (month > thisMonth) continue
    if (isTrackedMonth(list.length)) trackedMonths++
    const saved = savedOf(flowsOf(list, baseAmount))
    if (saved > 0 && (bestMonth === null || saved > bestMonth.saved)) bestMonth = { month, saved }
  }

  const perCategory = new Map<number, number>()
  for (const t of inYear) {
    if (t.type !== 'expense' || t.category_id === null) continue
    perCategory.set(t.category_id, (perCategory.get(t.category_id) ?? 0) + baseAmount(t))
  }
  const top = [...perCategory.entries()].sort((a, b) => b[1] - a[1])[0]

  const flows = flowsOf(inYear, baseAmount)
  return {
    year,
    trackedMonths,
    income: flows.income,
    expenses: flows.spending,
    saved: savedOf(flows),
    bestMonth,
    topCategory: top ? { id: top[0], total: top[1] } : null,
    entries: inYear.length,
  }
}
