export interface TransactionAmountFields {
  amount?: unknown
  amount_local?: unknown
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Return one transaction's finite value in the user's base currency. */
export function normalizedTransactionAmount(transaction: TransactionAmountFields): number {
  return finiteNumber(transaction.amount_local) ?? finiteNumber(transaction.amount) ?? 0
}
