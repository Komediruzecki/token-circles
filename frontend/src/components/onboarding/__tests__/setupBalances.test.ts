/**
 * Setup's "Balance today" is what the bank shows now (review M2): after each statement, the
 * accounts given a balance in setup read that balance again, as of the day it was typed, with the
 * statement worked back from it. The balances are kept until setup is finished or left, so a
 * reload between the account and the statement loses none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetTypedBalances,
  rememberTypedBalance,
  typedBalances,
} from '../../../core/setupTypedBalances'
import { workBackTypedBalances } from '../setupBalances'
import type { StoredAccount } from '../../../core/balanceToday'

beforeEach(() => {
  localStorage.clear()
})

describe('the balances setup was given', () => {
  it('are set again after a statement, as of the day each was typed', async () => {
    const stored: StoredAccount[] = [
      { id: 7, name: 'Main', balance: 3106.37, starting_balance: 1240.5 },
      { id: 8, name: 'Savings', balance: 900, starting_balance: 0 },
    ]
    const setBalanceToday = vi.fn(async () => true)
    const set = await workBackTypedBalances(
      [
        { id: 7, figure: 1240.5, asOf: '2026-11-03' },
        // An account setup made that the profile no longer has.
        { id: 9, figure: 50, asOf: '2026-11-03' },
      ],
      { storedAccounts: async () => stored, setBalanceToday }
    )
    expect(setBalanceToday.mock.calls).toEqual([[stored[0], 1240.5, '2026-11-03']])
    expect(set).toEqual(['Main'])
  })

  it('reads nothing while no account was given a balance', async () => {
    const storedAccounts = vi.fn(async () => [])
    expect(
      await workBackTypedBalances([], { storedAccounts, setBalanceToday: async () => true })
    ).toEqual([])
    expect(storedAccounts).not.toHaveBeenCalled()
  })

  it('are kept across a reload, one per account, until setup is finished or left', () => {
    rememberTypedBalance({ id: 7, figure: 100, asOf: '2026-11-02' })
    rememberTypedBalance({ id: 8, figure: 5, asOf: '2026-11-03' })
    rememberTypedBalance({ id: 7, figure: 1240.5, asOf: '2026-11-03' })
    expect(typedBalances()).toEqual([
      { id: 8, figure: 5, asOf: '2026-11-03' },
      { id: 7, figure: 1240.5, asOf: '2026-11-03' },
    ])
    forgetTypedBalances()
    expect(typedBalances()).toEqual([])
  })

  it('reads a damaged record as none', () => {
    localStorage.setItem('finance_setup_balances', '{not json')
    expect(typedBalances()).toEqual([])
    localStorage.setItem('finance_setup_balances', JSON.stringify([{ id: 'x' }, 7]))
    expect(typedBalances()).toEqual([])
  })
})
