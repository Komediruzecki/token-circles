import { describe, expect, it } from 'vitest'
import { computeBalanceDeltas } from '../idb.js'

describe('computeBalanceDeltas', () => {
  it('income on account increases balance', () => {
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'income',
      amount: 100,
    })
    expect(deltas).toEqual([{ accountId: 5, delta: 100 }])
  })

  it('expense on account decreases balance', () => {
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'expense',
      amount: 100,
    })
    expect(deltas).toEqual([{ accountId: 5, delta: -100 }])
  })

  it('foreign-currency row uses amount_local (base) for the delta, not the raw amount', () => {
    // amount is 750 HRK; amount_local is the 100 EUR base value the account is
    // denominated in. The balance must move by the base value.
    const expense = computeBalanceDeltas({
      account_id: 5,
      type: 'expense',
      amount: 750,
      amount_local: 100,
    })
    expect(expense).toEqual([{ accountId: 5, delta: -100 }])

    const transfer = computeBalanceDeltas({
      account_id: 1,
      transfer_account_id: 2,
      type: 'transfer',
      amount: 750,
      amount_local: 100,
    })
    expect(transfer).toEqual([
      { accountId: 1, delta: -100 },
      { accountId: 2, delta: 100 },
    ])
  })

  it('income for account-type (deposit into IB) increases balance', () => {
    // Simulates importing a bank statement line for IB deposit:
    // Amount is positive, type is income (from account's perspective)
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'income',
      amount: 500,
    })
    expect(deltas).toEqual([{ accountId: 5, delta: 500 }])
  })

  it('expense for account-type incorrectly marked would decrease balance (bug scenario)', () => {
    // If the bank statement says "Expense" but the money is going INTO the
    // account (like depositing into IB), marking it as expense would wrongly
    // decrease the balance. The import handler now prevents this by
    // overriding the type for account-type categories.
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'expense',
      amount: 500,
    })
    // This shows why the old behavior was wrong: -500 instead of +500
    expect(deltas).toEqual([{ accountId: 5, delta: -500 }])
  })

  it('transfer from one account to another', () => {
    const deltas = computeBalanceDeltas({
      account_id: 1,
      transfer_account_id: 2,
      type: 'transfer',
      amount: 300,
    })
    expect(deltas).toEqual([
      { accountId: 1, delta: -300 },
      { accountId: 2, delta: 300 },
    ])
  })

  it('transfer without destination makes no adjustment (money must not vanish)', () => {
    const deltas = computeBalanceDeltas({
      account_id: 1,
      type: 'transfer',
      amount: 300,
    })
    // Previously this debited the source with no offsetting credit, silently
    // destroying money. The guard now skips the adjustment entirely.
    expect(deltas).toEqual([])
  })

  it('transfer TO account without source account', () => {
    const deltas = computeBalanceDeltas({
      transfer_account_id: 2,
      type: 'transfer',
      amount: 300,
    })
    expect(deltas).toEqual([{ accountId: 2, delta: 300 }])
  })

  it('income to transfer_account without account_id', () => {
    const deltas = computeBalanceDeltas({
      transfer_account_id: 2,
      type: 'income',
      amount: 200,
    })
    expect(deltas).toEqual([{ accountId: 2, delta: 200 }])
  })

  it('no account_id yields empty deltas', () => {
    const deltas = computeBalanceDeltas({
      type: 'expense',
      amount: 100,
    })
    expect(deltas).toEqual([])
  })

  it('zero amount yields zero delta', () => {
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'expense',
      amount: 0,
    })
    expect(deltas).toEqual([{ accountId: 5, delta: -0 }])
  })

  it('expense not matching income/expense/transfer types is ignored', () => {
    const deltas = computeBalanceDeltas({
      account_id: 5,
      type: 'refund',
      amount: 100,
    })
    expect(deltas).toEqual([])
  })
})
