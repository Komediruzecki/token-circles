/**
 * What a month's entries say about where to look next. Each count is computed here once, for the
 * Progress page's advice (advice.ts) and for any other place that tells a person what to look at
 * next, so the two can never disagree about a number.
 */
import { flowsOf } from '../../../../shared/guidance/flows'
import { budgetsForMonth } from './budgets'
import { baseAmount } from './evaluate'
import type { BudgetRow } from './budgets'
import type { Tx } from './evaluate'

/** Entries with no category. A transfer needs none, so transfers are left out. */
export function uncategorisedIn(list: Tx[]): number {
  return list.filter((t) => t.type !== 'transfer' && t.category_id === null).length
}

/** The fewest entries a month needs before its balance is worth a remark. */
const IN_THE_RED_MIN_ENTRIES = 3

/**
 * A month that spent more than it earned: what came in and what went out, or null. What came in
 * is income less deductions, and what went out is expenses (shared/guidance/flows.ts). A month of
 * fewer than three entries says too little to judge.
 */
export function monthInTheRed(list: Tx[] | undefined): { income: number; out: number } | null {
  if (!list || list.length < IN_THE_RED_MIN_ENTRIES) return null
  const { income, spending } = flowsOf(list, baseAmount)
  return spending > income ? { income, out: spending } : null
}

/**
 * The category spent on most in `list` with no budget for `month` and no bill behind it, and what
 * was spent on it, or null when every category spent on has one or the other. A category is
 * budgeted when it has a budget in `month` (budgetsForMonth): one set only for an earlier month
 * has lapsed. Progress's advice passes this month's entries; Getting started passes the last full
 * month's, still with this month, so setting the budget the step asks for takes the step away.
 */
export function biggestUnbudgeted(
  list: Tx[],
  month: string,
  budgets: BudgetRow[],
  bills: Array<{ category_id?: number | null }>
): { categoryId: number; spent: number } | null {
  const budgeted = new Set(budgetsForMonth(budgets, month).map((b) => b.category_id))
  const billed = new Set(
    bills.map((b) => b.category_id).filter((id): id is number => id !== null && id !== undefined)
  )
  const spent = new Map<number, number>()
  for (const t of list) {
    if (t.type !== 'expense' || t.category_id === null) continue
    if (budgeted.has(t.category_id) || billed.has(t.category_id)) continue
    spent.set(t.category_id, (spent.get(t.category_id) ?? 0) + baseAmount(t))
  }
  const top = [...spent.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top || top[1] <= 0) return null
  return { categoryId: top[0], spent: top[1] }
}
