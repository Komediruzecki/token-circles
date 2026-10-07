/**
 * The words of the Loans page's comparison: template names, preset labels, and the sentence that
 * says what a what-if changes. The numbers come from shared/loanScenarios.ts; this file only
 * words them, so the sentence is tested against the same facts the page shows.
 *
 * Copy follows the product-voice rules (plan 05): no em dashes, none of the banned words, and
 * nothing the page does not do. Money is in the app's currency; totals in a sentence are whole
 * units, installments keep their cents because they are what gets paid.
 */
import type { ScenarioFacts, TemplateId, WhatIfChoice } from '../../../../shared/loanScenarios'
import type { ScenarioMode } from './loanRoute'

/** How a number or a month reads. The page passes the app's currency; tests pass their own. */
export interface Formats {
  /** To the cent: an installment. */
  money: (amount: number) => string
  /** In whole units: a total in a sentence. */
  wholeMoney: (amount: number) => string
}

/** Formats for a currency, as Intl writes it in the app's en-US locale. */
export function formatsFor(currency: string): Formats {
  const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency })
  const whole = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return { money: (n) => cents.format(n), wholeMoney: (n) => whole.format(n) }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "October 2034" for a YYYY-MM-DD date; "month 106" for a loan whose dates cannot be read. */
export function monthLong(date: string | null | undefined, month: number): string {
  const m = date ? /^(\d{4})-(\d{2})/.exec(date) : null
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : `month ${month}`
}

/** "Oct 2034", or "Month 106" without dates: for a table cell. */
export function monthShort(date: string | null | undefined, month: number): string {
  const m = date ? /^(\d{4})-(\d{2})/.exec(date) : null
  return m ? `${MONTH_NAMES[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : `Month ${month}`
}

/** "January", for a month of the year from 1 to 12. */
export function monthOfYearName(month: number): string {
  return MONTH_NAMES[month - 1] ?? `month ${month}`
}

// ── Names ────────────────────────────────────────────────────────────────────

export const TEMPLATE_NAMES: Record<TemplateId, string> = {
  'more-each-month': 'A bit more each month',
  'round-up': 'Round the installment up',
  'one-payment': 'One-off payment',
  'yearly-bonus': 'Yearly bonus',
  'extra-installment': 'One extra installment a year',
  'done-by': 'Done by a date',
  'rate-change': 'Rate change',
}

export const MODE_NAMES: Record<ScenarioMode, string> = {
  shorten: 'Finish sooner',
  lower: 'Pay less each month',
  both: 'Compare both modes',
}

/** A span of months the way a person says it: "a month", "14 months", "a year", "2 years". */
export function span(months: number): string {
  const n = Math.abs(months)
  if (n > 0 && n % 12 === 0) return n === 12 ? 'a year' : `${n / 12} years`
  return n === 1 ? 'a month' : `${n} months`
}

/** When a one-off payment is made, from now: the value of `inMonths`. */
export function inMonthsLabel(inMonths: number): string {
  return inMonths === 1 ? 'with the next payment' : `in ${span(inMonths)}`
}

export function pointsLabel(points: number): string {
  const n = Math.abs(points)
  return `${n} ${n === 1 ? 'point' : 'points'} ${points > 0 ? 'higher' : 'lower'}`
}

export function yearsEarlierLabel(years: number): string {
  return `${span(years * 12)} sooner`
}

/**
 * A what-if in a few words, for a column heading: "€50 more each month", "€10,000 in a year".
 * `installment` is the installment as it stands, which two templates are measured from.
 */
export function choiceTitle(choice: WhatIfChoice, f: Formats, installment: number | null): string {
  switch (choice.template) {
    case 'more-each-month':
      return `${f.wholeMoney(choice.amount)} more each month`
    case 'round-up':
      return installment === null
        ? `${f.wholeMoney(choice.target)} a month`
        : `${f.wholeMoney(choice.target)} a month instead of ${f.money(installment)}`
    case 'one-payment':
      return `${f.wholeMoney(choice.amount)} ${inMonthsLabel(choice.inMonths)}`
    case 'yearly-bonus':
      return `${f.wholeMoney(choice.amount)} every ${monthOfYearName(choice.monthOfYear)}`
    case 'extra-installment':
      return `One more installment every ${monthOfYearName(choice.monthOfYear)}`
    case 'done-by':
      return `Done ${yearsEarlierLabel(choice.yearsEarlier)}`
    case 'rate-change':
      return `Rate ${pointsLabel(choice.points)}`
  }
}

// ── What changed ─────────────────────────────────────────────────────────────

/** Rows before the last payment, which is only what is left: the installments proper. */
function fullRows(s: ScenarioFacts): number {
  return s.payoffMonth !== null ? s.rows.length - 1 : s.rows.length
}

/** The first month from `from` on in which B's installment is not A's, with both. */
interface InstallmentShift {
  month: number
  date: string | null
  a: number
  b: number
  /** B's installment changes again later, on its own: it moves with each extra payment. */
  keepsMoving: boolean
  /** B's installment after its last change of its own, and when that is. */
  last: { month: number; date: string | null; installment: number }
}

function installmentShift(
  a: ScenarioFacts,
  b: ScenarioFacts,
  from: number
): InstallmentShift | null {
  const end = Math.min(fullRows(a), fullRows(b))
  for (let i = Math.max(0, from - 1); i < end; i++) {
    const [ra, rb] = [a.rows[i], b.rows[i]]
    if (Math.abs(ra.payment - rb.payment) <= 0.005) continue
    const own = new Set(a.installmentChanges.map((c) => c.month))
    const later = b.installmentChanges.filter((c) => c.month > rb.month && !own.has(c.month))
    const last = later[later.length - 1]
    return {
      month: rb.month,
      date: rb.date || null,
      a: ra.payment,
      b: rb.payment,
      keepsMoving: later.length > 0,
      last: last
        ? { month: last.month, date: last.date, installment: last.installment }
        : { month: rb.month, date: rb.date || null, installment: rb.payment },
    }
  }
  return null
}

/** Everything the sentence needs about one comparison. */
export interface ComparisonInput {
  a: ScenarioFacts
  b: ScenarioFacts
  /** The month the comparison is seen from: the next payment's. */
  from: number
  /** When B is never repaid: the rate and the date of the month it stops being repaid in. */
  never?: { rate: number | null; date: string | null } | null
  /** A is the loan as planned, rather than a pick pinned with "Use as A". */
  aIsPlan: boolean
}

const changesNothing = (cmp: { interest: number; extra: number; months: number }) =>
  Math.abs(cmp.interest) < 0.005 && Math.abs(cmp.extra) < 0.005 && cmp.months === 0

/**
 * What B changes against A, in a sentence or two: what it costs, then when the loan ends or what
 * the installment becomes. A loan that is never repaid says so instead.
 */
export function compareSentence(input: ComparisonInput, f: Formats): string {
  const { a, b, from } = input
  if (b.neverPaysOffFrom !== null) {
    const when = monthLong(input.never?.date, b.neverPaysOffFrom)
    const rate = input.never?.rate
    const lead =
      rate !== null && rate !== undefined ? `At ${formatRate(rate)} from ${when}` : `From ${when}`
    return `${lead} the installment no longer covers the interest, so this loan would never be repaid.`
  }
  if (a.neverPaysOffFrom !== null) {
    const as = input.aIsPlan ? 'As planned' : 'As pinned'
    return `${as} this loan is never repaid. With this change it is, in ${monthLong(b.payoffDate, b.payoffMonth ?? 0)}.`
  }
  const months = (a.payoffMonth ?? 0) - (b.payoffMonth ?? 0)
  const interest = a.totalInterest - b.totalInterest
  const extra = b.totalExtra - a.totalExtra
  const shift = installmentShift(a, b, from)
  if (changesNothing({ interest, extra, months }) && !shift) {
    return 'This changes nothing: the loan is repaid before it would make a difference.'
  }

  const parts = [costLine(extra, interest, f)]
  if (months !== 0) {
    parts.push(
      `Done in ${monthLong(b.payoffDate, b.payoffMonth ?? 0)}, ${span(months)} ${months > 0 ? 'sooner' : 'later'}.`
    )
  } else if (shift) {
    parts.push(installmentLine(shift, f))
  }
  return parts.join(' ')
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 1000) / 1000}%`
}

function costLine(extra: number, interest: number, f: Formats): string {
  const moreOrLess = interest >= 0 ? 'less' : 'more'
  const interestPart =
    Math.round(Math.abs(interest)) === 0
      ? 'about the same interest'
      : `${f.wholeMoney(Math.abs(interest))} ${moreOrLess} interest`
  if (extra > 0.005) return `You pay ${f.wholeMoney(extra)} extra and ${interestPart}.`
  if (extra < -0.005) {
    return `You pay ${f.wholeMoney(-extra)} less in extra payments and ${interestPart}.`
  }
  return `You pay ${interestPart}.`
}

function installmentLine(shift: InstallmentShift, f: Formats): string {
  if (!shift.keepsMoving) {
    return `From ${monthLong(shift.date, shift.month)} the installment is ${f.money(shift.b)} instead of ${f.money(shift.a)}.`
  }
  const direction = shift.last.installment < shift.a ? 'falls' : 'rises'
  return `From ${monthLong(shift.date, shift.month)} the installment ${direction} with each extra payment, to ${f.money(shift.last.installment)} by ${monthLong(shift.last.date, shift.last.month)}.`
}

/**
 * The trade-off between the two modes of the same what-if: finishing sooner saves more interest,
 * paying less each month frees money every month.
 */
export function bothModesSentence(
  plan: ScenarioFacts,
  sooner: ScenarioFacts,
  lower: ScenarioFacts,
  from: number,
  f: Formats
): string {
  if (sooner.neverPaysOffFrom !== null || lower.neverPaysOffFrom !== null) {
    return 'With this change the loan would never be repaid, in either mode.'
  }
  const extraInterest = lower.totalInterest - sooner.totalInterest
  const months = (plan.payoffMonth ?? 0) - (sooner.payoffMonth ?? 0)
  const shift = installmentShift(plan, lower, from)
  if (months === 0 && !shift) {
    return 'Neither mode changes anything: the loan is repaid before the extra payments would.'
  }
  const first =
    Math.round(extraInterest) > 0
      ? `Finishing sooner saves ${f.wholeMoney(extraInterest)} more interest and ends in ${monthLong(sooner.payoffDate, sooner.payoffMonth ?? 0)}.`
      : `Finishing sooner ends in ${monthLong(sooner.payoffDate, sooner.payoffMonth ?? 0)}, for about the same interest.`
  if (!shift) return first
  const freed = shift.a - (shift.keepsMoving ? shift.last.installment : shift.b)
  const second = shift.keepsMoving
    ? `Paying less each month frees a little more with each extra payment, ${f.money(freed)} a month by ${monthLong(shift.last.date, shift.last.month)}.`
    : `Paying less each month frees ${f.money(freed)} a month from ${monthLong(shift.date, shift.month)}.`
  return `${first} ${second}`
}

/**
 * The difference in one short line, for the bar that stays in view on a phone:
 * "14 months sooner · €5,236 less interest".
 */
export function differenceLine(
  a: ScenarioFacts,
  b: ScenarioFacts,
  from: number,
  f: Formats
): string {
  if (b.neverPaysOffFrom !== null) return 'Never repaid'
  if (a.neverPaysOffFrom !== null) return `Repaid by ${monthLong(b.payoffDate, b.payoffMonth ?? 0)}`
  const months = (a.payoffMonth ?? 0) - (b.payoffMonth ?? 0)
  const interest = a.totalInterest - b.totalInterest
  const shift = installmentShift(a, b, from)
  const parts: string[] = []
  if (months !== 0) parts.push(`${span(months)} ${months > 0 ? 'sooner' : 'later'}`)
  else if (shift) {
    const installment = shift.keepsMoving ? shift.last.installment : shift.b
    parts.push(`${f.money(installment)} a month`)
  }
  if (Math.round(Math.abs(interest)) > 0) {
    parts.push(`${f.wholeMoney(Math.abs(interest))} ${interest > 0 ? 'less' : 'more'} interest`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'No change'
}
