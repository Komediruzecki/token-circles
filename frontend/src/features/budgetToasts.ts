/**
 * What the Budgets page says after its month-wide actions, from the runtimes' answers.
 *
 * "From last month's spending" fills only the categories the month has no budget for (both
 * runtimes, POST /api/budgets/from-expenses), so it says how many it set and how many already had
 * a budget and kept it.
 */

/** The answer of POST /api/budgets/from-expenses. */
export interface FromSpendingAnswer {
  ok: boolean
  /** Budgets set: the categories with spending last month and no budget this month. */
  count?: number
  /** Categories with spending last month that already had a budget, left as they were. */
  already_budgeted?: number
  message?: string
}

export interface PageToast {
  text: string
  kind: 'success' | 'info'
}

const budgets = (n: number) => (n === 1 ? '1 budget' : `${n} budgets`)
const categories = (n: number) => (n === 1 ? '1 category' : `${n} categories`)

/**
 * The toast for "From last month's spending". `lastMonth` is the month read ("March 2026") and
 * `month` the one set ("April 2026").
 */
export function fromSpendingToast(
  answer: FromSpendingAnswer,
  lastMonth: string,
  month: string
): PageToast {
  if (!answer.ok) return { text: `No spending in ${lastMonth} to set budgets from.`, kind: 'info' }
  const set = answer.count ?? 0
  const kept = answer.already_budgeted ?? 0
  if (set === 0) {
    return {
      text: `Every category you spent on in ${lastMonth} already has a budget for ${month}. Nothing changed.`,
      kind: 'info',
    }
  }
  const done = `Set ${budgets(set)} for ${month} from what you spent in ${lastMonth}.`
  if (kept === 0) return { text: done, kind: 'success' }
  const keeps =
    kept === 1 ? 'already had a budget and keeps it' : 'already had budgets and keep them'
  return { text: `${done} ${categories(kept)} ${keeps}.`, kind: 'success' }
}
