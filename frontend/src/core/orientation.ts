/**
 * The facts Getting started reads (shared/orientation.ts), from what the last badge evaluation
 * already loaded (achievementsStore's snapshot), so the steps cost no request of their own and
 * read the same rows in both storage modes.
 *
 * Each count comes from the function its own page uses, so a step never disagrees with the page
 * it links to: tracked months from the badges (shared/trackedMonths.ts), subscriptions from the
 * scan's window and tick rule, and the month and the category from the Progress page's advice
 * (achievements/monthFacts.ts). The month and the category are the last full month's, because a
 * fresh import leaves the current month empty.
 */
import { lastFullMonth } from '../../../shared/orientation'
import { trackedMonthsInYearWindow } from '../../../shared/trackedMonths'
import {
  detectSubscriptions,
  recentForScan,
  worthTracking,
} from '../features/subscriptionDetection'
import { bucketByMonth } from './achievements/evaluate'
import { biggestUnbudgeted, monthInTheRed, uncategorisedIn } from './achievements/monthFacts'
import type { KindedCategory } from '../../../shared/guidance/kinds'
import type { OrientationFacts } from '../../../shared/orientation'
import type { DetectableTransaction, ExistingBillLike } from '../features/subscriptionDetection'
import type { EvaluateInput, Evaluation } from './achievements/evaluate'

/** What the facts are read from: the parts of the achievements snapshot they need. */
export interface OrientationSource {
  /** YYYY-MM-DD the evaluation used. */
  today: string
  evaluation: Pick<Evaluation, 'trackedMonths'>
  /** Whole rows: the scan reads their text. */
  transactions: Array<EvaluateInput['transactions'][number] & DetectableTransaction>
  budgets: Array<Pick<EvaluateInput['budgets'][number], 'category_id'>>
  bills: Array<ExistingBillLike & { category_id?: number | null }>
  /** Whole rows: the scan reads the type and the kind of what charges are filed under. */
  categories: Array<{ id: number; name: string } & KindedCategory>
  loans: unknown[]
}

/** The facts for `source`, with the scan's window ending at `nowMs`. */
export function orientationFacts(source: OrientationSource, nowMs: number): OrientationFacts {
  const { today, transactions } = source
  const last = lastFullMonth(today)
  const lastMonth = bucketByMonth(transactions).get(last) ?? []
  const top = biggestUnbudgeted(lastMonth, source.budgets, source.bills)
  const name =
    top === null ? undefined : source.categories.find((c) => c.id === top.categoryId)?.name
  const spotted = detectSubscriptions(recentForScan(transactions, nowMs), source.bills, {
    today,
    categories: source.categories,
  }).filter(worthTracking)
  return {
    today,
    trackedMonthsInYear: trackedMonthsInYearWindow(source.evaluation.trackedMonths, today),
    subscriptionsSpotted: spotted.length,
    billsSpotted: spotted.filter((found) => found.billType === 'bill').length,
    entries: transactions.filter((t) => t.type !== 'transfer').length,
    uncategorised: uncategorisedIn(transactions),
    topUnbudgeted: top !== null && name !== undefined ? { categoryId: top.categoryId, name } : null,
    heavyMonth: monthInTheRed(lastMonth) === null ? null : last,
    loans: source.loans.length,
  }
}
