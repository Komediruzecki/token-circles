/**
 * How much of a year an annual report covers.
 *
 * A past year is whole. The current year runs from January to the end of the current month: its
 * later months have not happened, and a report that drew them showed empty months and a cash-flow
 * line running flat to December. A transaction dated later in the current year is left out with
 * them. A later year is only reachable through future-dated entries and is shown whole.
 */
import { MONTH_NAMES } from './period'

export interface AnnualSpan {
  /** ISO `YYYY-MM-DD`, inclusive. */
  from: string
  /** ISO `YYYY-MM-DD`, inclusive. */
  to: string
  /** How many months the report has, from January. */
  months: number
  /** The current year, which stops at the current month. */
  soFar: boolean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

export function annualSpan(year: number, now: Date = new Date()): AnnualSpan {
  if (year !== now.getFullYear()) {
    return { from: `${year}-01-01`, to: `${year}-12-31`, months: 12, soFar: false }
  }
  const months = now.getMonth() + 1
  const lastDay = new Date(year, months, 0).getDate()
  return {
    from: `${year}-01-01`,
    to: `${year}-${pad2(months)}-${pad2(lastDay)}`,
    months,
    soFar: true,
  }
}

/** The months a span covers, in words: "January to November", or "January". */
export function spanMonths(span: AnnualSpan): string {
  return span.months === 1 ? MONTH_NAMES[0] : `${MONTH_NAMES[0]} to ${MONTH_NAMES[span.months - 1]}`
}
