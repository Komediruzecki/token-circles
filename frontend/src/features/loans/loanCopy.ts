/**
 * How the Loans page writes money and months. Money is in the app's currency: whole units in a
 * sentence, cents where an installment is shown, because that is what gets paid.
 *
 * Copy follows the product-voice rules (plan 05): no em dashes, none of the banned words, and
 * nothing the page does not do.
 */

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
