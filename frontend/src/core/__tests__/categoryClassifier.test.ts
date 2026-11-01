import { describe, expect, it } from 'vitest'
import { classifyCategory } from '../categoryClassifier.js'

describe('classifyCategory', () => {
  it('classifies Revolut as account', () => {
    expect(classifyCategory('Revolut')).toBe('account')
  })

  it('classifies WRev (abbreviation) as account: read split at its capitals, it holds "rev"', () => {
    expect(classifyCategory('WRev')).toBe('account')
  })

  it('classifies PBZ as account', () => {
    expect(classifyCategory('PBZ')).toBe('account')
  })

  it('classifies "Current" as account', () => {
    expect(classifyCategory('current')).toBe('account')
  })

  it('classifies "Giro account" as account', () => {
    expect(classifyCategory('giro account')).toBe('account')
  })

  it('classifies PayPal as account', () => {
    expect(classifyCategory('PayPal')).toBe('account')
  })

  it('classifies N26 as account', () => {
    expect(classifyCategory('N26')).toBe('account')
  })

  it('classifies Wise as account', () => {
    expect(classifyCategory('wise')).toBe('account')
  })

  it('classifies Bank Fees as expense (not account)', () => {
    expect(classifyCategory('Bank Fees')).toBe('expense')
  })

  it('classifies Salary as income', () => {
    expect(classifyCategory('Salary')).toBe('income')
  })

  it('classifies Revenue as income', () => {
    expect(classifyCategory('Revenue')).toBe('income')
  })

  it('classifies Refund as income', () => {
    expect(classifyCategory('Refund')).toBe('income')
  })

  it('classifies Groceries as expense', () => {
    expect(classifyCategory('Groceries')).toBe('expense')
  })

  it('classifies Health as expense', () => {
    expect(classifyCategory('Health')).toBe('expense')
  })

  it('classifies Fun as expense', () => {
    expect(classifyCategory('Fun')).toBe('expense')
  })

  it('classifies Dining/Restaurant as expense', () => {
    expect(classifyCategory('Restaurant')).toBe('expense')
  })

  it('classifies "Savings" as account', () => {
    expect(classifyCategory('Savings')).toBe('account')
  })

  it('classifies "Investments" as account (asset that counts toward net worth)', () => {
    expect(classifyCategory('Investments')).toBe('account')
    expect(classifyCategory('Investment')).toBe('account')
  })

  it('classifies "Wallet" as account', () => {
    expect(classifyCategory('Wallet')).toBe('account')
  })

  it('is case insensitive', () => {
    expect(classifyCategory('REVOLUT')).toBe('account')
    expect(classifyCategory('salary')).toBe('income')
    expect(classifyCategory('PAYPAL')).toBe('account')
  })
})

describe('classifyCategory matches whole words, not parts of words', () => {
  it.each(['Library', 'Review', 'Otherwise', 'Likewise', 'Fiber internet', 'Contribution'])(
    '%s is an expense: no account keyword is a whole word in it',
    (name) => {
      expect(classifyCategory(name)).toBe('expense')
    }
  )

  it.each(['Accountant', 'Sewage', 'Concurrent'])(
    '%s is an expense: "account", "wage" and "current" are only part of the word',
    (name) => {
      expect(classifyCategory(name)).toBe('expense')
    }
  )

  it.each([
    'IB',
    'IB account',
    'IBKR',
    'Interactive Brokers',
    'Revolut',
    'Rev',
    'Wise',
    'N26',
    'Checking account',
    'Brokerage',
    'Trading212',
    'Girokonto',
  ])('%s is an account', (name) => {
    expect(classifyCategory(name)).toBe('account')
  })

  it.each(['Investments', 'Investment'])('%s stays an account', (name) => {
    expect(classifyCategory(name)).toBe('account')
  })

  it.each(['Wages', 'Wage', 'Royalties', 'Royalty', 'Dividends', 'Refunds', 'Pay cheque'])(
    '%s stays income',
    (name) => {
      expect(classifyCategory(name)).toBe('income')
    }
  )

  it('a multi-word account name beats a single income word in it', () => {
    expect(classifyCategory('Credit card account')).toBe('account')
    expect(classifyCategory('Credit')).toBe('income')
  })

  it('finds word edges at non-ASCII letters, where JS \\b does not', () => {
    // An ASCII \b sees the accented letter as a word edge, so it finds "ib" in Ibérica and "rev"
    // in Revêtement. Both are one word each.
    expect(classifyCategory('Ibérica')).toBe('expense')
    expect(classifyCategory('Revêtement de sol')).toBe('expense')
    // Plaća and račun are whole words next to the keywords, which still match.
    expect(classifyCategory('Revolut račun')).toBe('account')
    expect(classifyCategory('Plaća')).toBe('expense')
  })

  it('reads punctuation and separators as word edges', () => {
    expect(classifyCategory('IB/Interactive')).toBe('account')
    expect(classifyCategory('e-wallet')).toBe('account')
    expect(classifyCategory('Wise (EUR)')).toBe('account')
  })
})
