/**
 * Which budget a month has. Shared by the badges (held-the-line and the two built on it) and by
 * advice, so a month is judged the same way on both.
 */
import { bySavedOrder } from '../../../../shared/budgetSavedOrder'
import { monthOf } from './months'
import type { EvaluateInput } from './evaluate'

export type BudgetRow = EvaluateInput['budgets'][number]

/**
 * The monthly budget each category has for `month` ('YYYY-MM'), one row per category. Budgets are
 * one row per month (Set Budget, Allocate and Copy last month each write a row starting on the
 * month's first day, with no end date), and the Budgets page reads a month's rows by start_date in
 * both runtimes. Taking every row without an end date as still running judged a month against each
 * earlier month's budget as well. Two rows for one month keep the one saved last, whatever day it
 * starts and whatever order the list came in: the rule every reader shares
 * (shared/budgetSavedOrder.ts).
 */
export function budgetsForMonth<B extends BudgetRow>(budgets: B[], month: string): B[] {
  const latest = new Map<number, B>()
  for (const b of budgets) {
    if (b.period !== 'monthly') continue
    if (monthOf(b.start_date) !== month) continue
    const held = latest.get(b.category_id)
    if (!held || bySavedOrder(b, held) >= 0) latest.set(b.category_id, b)
  }
  return [...latest.values()]
}
