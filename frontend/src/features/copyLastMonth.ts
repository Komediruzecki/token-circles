/**
 * What the Budgets page says after "Copy last month". The copy leaves every budget the month
 * already has as it is, so the toast says how many of last month's budgets it copied and how many
 * categories already had one (POST /api/budgets/duplicate-last answers both).
 */
export interface CopyLastMonthAnswer {
  /** Budgets copied into the month. */
  count?: number
  /** Last month's categories that already had a budget in the month, which were left as they are. */
  already_budgeted?: number
}

/** "April 2026" for `2026-04`, or for a month `offset` months from it. */
function monthLabel(month: string, offset = 0): string {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mon - 1 + offset, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const budgets = (n: number) => `${n} ${n === 1 ? 'budget' : 'budgets'}`

/** The toast for a copy into `month` (`YYYY-MM`, the month the page shows). */
export function copyLastMonthToast(
  answer: CopyLastMonthAnswer,
  month: string
): { message: string; type: 'success' | 'info' } {
  const from = monthLabel(month, -1)
  const into = monthLabel(month)
  const copied = answer.count ?? 0
  const kept = answer.already_budgeted ?? 0
  if (copied === 0) {
    return {
      message: `Nothing copied: every category budgeted in ${from} already has a budget for ${into}`,
      type: 'info',
    }
  }
  if (kept === 0) return { message: `Copied ${budgets(copied)} from ${from}`, type: 'success' }
  const others =
    kept === 1
      ? `The other category already had a budget for ${into} and keeps it.`
      : `The other ${kept} categories already had budgets for ${into} and keep them.`
  return {
    message: `Copied ${copied} of ${budgets(copied + kept)} from ${from}. ${others}`,
    type: 'success',
  }
}
