export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'deduction'] as const;

export type TransactionInvariantInput = {
  type: unknown;
  amount: unknown;
  amount_local?: unknown;
  account_id?: unknown;
  transfer_account_id?: unknown;
};

function positiveFiniteNumber(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return false;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0;
}

function positiveIntegerOrEmpty(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return true;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0;
}

function accountId(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Validate the fields that determine transaction balance effects.
 *
 * This stays framework-free so browser storage and the Worker enforce the same
 * rules before any transaction or account balance is written.
 */
export function transactionInvariantError(input: TransactionInvariantInput): string | null {
  if (!TRANSACTION_TYPES.includes(input.type as (typeof TRANSACTION_TYPES)[number])) {
    return 'Invalid transaction type';
  }
  if (!positiveFiniteNumber(input.amount)) {
    return 'Transaction amount must be a positive number';
  }
  if (
    input.amount_local !== undefined &&
    input.amount_local !== null &&
    !positiveFiniteNumber(input.amount_local)
  ) {
    return 'Transaction local amount must be a positive number';
  }
  if (!positiveIntegerOrEmpty(input.account_id)) {
    return 'Source account must be a positive integer';
  }
  if (!positiveIntegerOrEmpty(input.transfer_account_id)) {
    return 'Destination account must be a positive integer';
  }

  if (input.type === 'transfer') {
    const source = accountId(input.account_id);
    const destination = accountId(input.transfer_account_id);
    if (source === null || destination === null) {
      return 'A transfer must have both source and destination accounts';
    }
    if (source === destination) {
      return 'Transfer source and destination accounts must be different';
    }
  }

  return null;
}
