const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** SQL expression for one transaction's value in the user's base currency. */
export function normalizedTransactionAmountSql(tableAlias?: string): string {
  if (tableAlias && !SQL_IDENTIFIER.test(tableAlias)) {
    throw new Error('Invalid transaction table alias');
  }
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `COALESCE(${prefix}amount_local, ${prefix}amount)`;
}
