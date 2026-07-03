/**
 * Currency helpers.
 *
 * The app reports every transaction in the user's single base currency — the
 * localStorage `localCurrency` setting (default EUR, see getLocalCurrency). A
 * transaction keeps its ORIGINAL `amount` in its own `currency`, plus
 * `amount_local`: that value already converted to the base currency at import
 * time. Reporting (totals, charts, the primary displayed value) always uses the
 * base-currency value; the original is shown only as secondary context.
 */
import { getLocalCurrency } from './api'

export interface AmountFields {
  amount: number
  amount_local?: number | null
  currency?: string | null
}

/**
 * Static, approximate FX rates as EUR value of one unit, covering the currencies the
 * app offers as base currencies (Settings) plus HRK. Only used as a LAST-RESORT
 * estimate for a foreign-currency row that has no amount_local — such rows are also
 * flagged (isEstimatedBaseValue) so the user knows the value is approximate. For real
 * conversions the import provides amount_local; this table is not a live FX feed.
 */
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  JPY: 0.0062,
  CAD: 0.68,
  AUD: 0.61,
  CHF: 1.04,
  CNY: 0.13,
  INR: 0.011,
  BRL: 0.18,
  MXN: 0.054,
  SGD: 0.69,
  HKD: 0.12,
  KRW: 0.00069,
  SEK: 0.088,
  NOK: 0.087,
  DKK: 0.134,
  NZD: 0.57,
  ZAR: 0.051,
  PLN: 0.23,
  HRK: 0.1328, // pre-EUR Croatian kuna (~7.53 HRK/EUR)
}

/**
 * Convert an amount from one currency to another using the static table.
 * Returns null when either currency is unknown (caller then keeps the raw amount).
 */
export function convertToBase(amount: number, from: string, base: string): number | null {
  const f = EUR_PER_UNIT[from.toUpperCase()]
  const b = EUR_PER_UNIT[base.toUpperCase()]
  if (!f || !b) return null
  return (amount * f) / b
}

/**
 * The transaction's value in the user's base currency.
 * Prefers amount_local (mirrors the worker's COALESCE(amount_local, amount)); if a
 * foreign-currency row has none, falls back to a static-table estimate, then the raw
 * amount. Rows that fall through to an estimate are flagged (isEstimatedBaseValue).
 */
export function txBaseValue(tx: AmountFields): number {
  if (typeof tx.amount_local === 'number') return tx.amount_local
  const base = getLocalCurrency()
  if (!tx.currency || tx.currency === base) return tx.amount
  return convertToBase(tx.amount, tx.currency, base) ?? tx.amount
}

/**
 * True when the value shown is an approximate FX estimate rather than a real
 * conversion — a foreign-currency row that arrived without amount_local. The UI
 * surfaces a warning indicator for these.
 */
export function isEstimatedBaseValue(tx: AmountFields): boolean {
  return typeof tx.amount_local !== 'number' && !!tx.currency && tx.currency !== getLocalCurrency()
}

/**
 * True when the row carries a converted value from a different original currency,
 * i.e. there is a meaningful "original amount" worth surfacing (e.g. as a tooltip).
 */
export function hasForeignOriginal(tx: AmountFields): boolean {
  return (
    typeof tx.amount_local === 'number' && !!tx.currency && tx.currency !== getLocalCurrency()
  )
}

/**
 * A short "original amount + currency" label for the secondary display, e.g.
 * "19.00 HRK". Returns '' when there is no distinct original to show.
 */
export function originalAmountLabel(tx: AmountFields): string {
  if (!hasForeignOriginal(tx)) return ''
  const n = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(tx.amount))
  return `${n} ${tx.currency}`
}
