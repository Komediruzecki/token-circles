/**
 * Direction-aware "From → To" labels for a transaction row.
 *
 * Rows are stored account-first: `means_of_payment` is the account the transaction
 * touches and `category_name` is its category. Rendering that verbatim as
 * `account → category` reads correctly for an expense or a transfer (money leaves the
 * account) but BACKWARDS for income — a salary would read "Erste Current → Salary Eur",
 * as if the money left the account, when it actually arrived INTO it.
 *
 * This renders the real money flow, preferring the external counterparty over the
 * category label (the category already has its own column):
 *   - income:   `payor → account`       e.g. "ACME → Erste Current"
 *   - expense:  `account → beneficiary`  e.g. "Revolut Joint → Konzum"
 *   - transfer: `account → account`      e.g. "Erste Current → Revolut"
 *
 * When the counterparty is blank it falls back to the category label, so rows without a
 * captured payer/payee still read sensibly ("Salary Eur → Erste Current"). When an
 * income/expense row has no separate account — e.g. a brokerage deposit whose receiving
 * account IS the category — the category stands in for that endpoint. Display-only: this
 * does not touch any balance.
 */
import type { Transaction } from '../types/models'

const EM_DASH = '—'

export function fromToLabels(
  t: Pick<Transaction, 'type' | 'means_of_payment' | 'category_name'> &
    Partial<Pick<Transaction, 'payor' | 'beneficiary'>>,
  // Resolved account names for a transfer's two legs (from `account_id` / `transfer_account_id`).
  // An account-to-account transfer stores its destination in `transfer_account_id`, so
  // `category_name` is null — without the resolved name the "to" would collapse to "—".
  names?: { accountName?: string | null; transferAccountName?: string | null }
): { from: string; to: string } {
  const account = (t.means_of_payment || '').trim()
  const category = (t.category_name || '').trim()
  const payor = (t.payor || '').trim()
  const beneficiary = (t.beneficiary || '').trim()

  if (t.type === 'income') {
    // Money flows INTO the account, from the payer (employer/sender).
    return account
      ? { from: payor || category || EM_DASH, to: account }
      : { from: payor || EM_DASH, to: category || EM_DASH }
  }
  if (t.type === 'expense') {
    // Money flows OUT of the account, to the payee (merchant).
    return account
      ? { from: account, to: beneficiary || category || EM_DASH }
      : { from: category || EM_DASH, to: beneficiary || EM_DASH }
  }
  // transfer: account → account. Prefer the resolved account names (the destination lives in
  // transfer_account_id, so category_name is null for account-to-account transfers); fall back
  // to the stored means_of_payment / category text when a name wasn't resolved.
  const transferFrom = (names?.accountName || '').trim() || account
  const transferTo = (names?.transferAccountName || '').trim() || category
  return { from: transferFrom || EM_DASH, to: transferTo || EM_DASH }
}
