import { describe, expect, it } from 'vitest';
import { validateTransactionCreate, validateTransactionUpdate } from '../src/validation';

describe('validateTransactionCreate', () => {
  it('accepts a well-formed transaction', () => {
    expect(() => validateTransactionCreate({ amount: 100.5, type: 'expense' })).not.toThrow();
  });

  it('accepts a stringified amount and id (coercion, matching the handler leniency)', () => {
    expect(() =>
      validateTransactionCreate({ amount: '100.50', type: 'income', account_id: '3' })
    ).not.toThrow();
  });

  it('accepts an explicit null account/transfer id', () => {
    expect(() =>
      validateTransactionCreate({ amount: 5, type: 'transfer', account_id: null, transfer_account_id: null })
    ).not.toThrow();
  });

  it('does not touch other fields (currency, description) — beyond the 6-code backend enum', () => {
    expect(() =>
      validateTransactionCreate({ amount: 5, type: 'expense', currency: 'CHF', description: 'x'.repeat(9000) })
    ).not.toThrow();
  });

  it('rejects a non-numeric amount', () => {
    expect(() => validateTransactionCreate({ amount: 'foo', type: 'expense' })).toThrow(/amount/i);
  });

  it('rejects an out-of-range amount (1e308)', () => {
    expect(() => validateTransactionCreate({ amount: 1e308, type: 'expense' })).toThrow(/range/i);
  });

  it('rejects more than 2 decimal places', () => {
    expect(() => validateTransactionCreate({ amount: 100.555, type: 'expense' })).toThrow(/decimal/i);
  });

  it('rejects an unknown transaction type', () => {
    expect(() => validateTransactionCreate({ amount: 5, type: 'foo' })).toThrow();
  });

  it('rejects a missing amount or type', () => {
    expect(() => validateTransactionCreate({ type: 'expense' })).toThrow();
    expect(() => validateTransactionCreate({ amount: 5 })).toThrow();
  });

  it('rejects a non-integer or non-numeric id', () => {
    expect(() => validateTransactionCreate({ amount: 5, type: 'expense', account_id: 'abc' })).toThrow();
    expect(() => validateTransactionCreate({ amount: 5, type: 'expense', category_id: 1.5 })).toThrow();
    expect(() => validateTransactionCreate({ amount: 5, type: 'expense', account_id: -1 })).toThrow();
  });

  it('throws an HttpError with status 400', () => {
    try {
      validateTransactionCreate({ amount: 'nope', type: 'expense' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(400);
    }
  });
});

describe('validateTransactionUpdate', () => {
  it('accepts a partial update with no money fields', () => {
    expect(() => validateTransactionUpdate({ reconciled: true })).not.toThrow();
    expect(() => validateTransactionUpdate({})).not.toThrow();
  });

  it('validates money fields when present', () => {
    expect(() => validateTransactionUpdate({ amount: 10, type: 'transfer' })).not.toThrow();
    expect(() => validateTransactionUpdate({ amount: 'foo' })).toThrow(/amount/i);
    expect(() => validateTransactionUpdate({ type: 'bogus' })).toThrow();
  });
});
