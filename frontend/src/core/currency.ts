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
 * The transaction's value in the user's base currency.
 * Uses amount_local when present (mirrors the worker's COALESCE(amount_local, amount)),
 * otherwise the raw amount. A foreign-currency row with no amount_local can't be
 * converted here without an FX rate — that estimation + flagging lives in the
 * import/backfill path, not this hot display helper.
 */
export function txBaseValue(tx: AmountFields): number {
  return typeof tx.amount_local === 'number' ? tx.amount_local : tx.amount
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
