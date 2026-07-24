import { describe, expect, it } from 'vitest';
import { normalizedTransactionAmountSql } from '../src/transaction-amount';

describe('normalizedTransactionAmountSql', () => {
  it('builds normalized expressions with and without a table alias', () => {
    expect(normalizedTransactionAmountSql()).toBe('COALESCE(amount_local, amount)');
    expect(normalizedTransactionAmountSql('t')).toBe('COALESCE(t.amount_local, t.amount)');
  });

  it('rejects non-identifier aliases', () => {
    expect(() => normalizedTransactionAmountSql('t; DROP TABLE transactions')).toThrow(
      'Invalid transaction table alias'
    );
  });
});
