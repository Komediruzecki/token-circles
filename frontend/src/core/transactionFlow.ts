/**
 * Direction-aware "From → To" labels for a transaction row.
 *
 * Rows are stored account-first: `means_of_payment` is the account the transaction
 * touches and `category_name` is its category. Rendering that verbatim as
 * `account → category` reads correctly for an expense or a transfer (money leaves the
 * account) but BACKWARDS for income — a salary shows as "Erste Current → Salary Eur",
 * as if the money left the account, when it actually arrived INTO it.
 *
 * So for income we flip the arrow to `source → account`: the category (the income
 * source, e.g. "Salary Eur") on the left and the receiving account on the right. When
 * an income row has no separate means_of_payment — e.g. a brokerage deposit whose
 * receiving account IS the category — the category is shown on the right as the
 * destination. This is display-only and does not touch any balance.
 */
import type { Transaction } from '../types/models'

const EM_DASH = '—'

export function fromToLabels(t: Pick<Transaction, 'type' | 'means_of_payment' | 'category_name'>): {
  from: string
  to: string
} {
  const account = (t.means_of_payment || '').trim()
  const category = (t.category_name || '').trim()
  if (t.type === 'income') {
    return account
      ? { from: category || EM_DASH, to: account }
      : { from: EM_DASH, to: category || EM_DASH }
  }
  return { from: account || EM_DASH, to: category || EM_DASH }
}
