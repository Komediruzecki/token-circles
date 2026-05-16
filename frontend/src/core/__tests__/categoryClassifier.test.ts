import { describe, expect, it } from 'vitest'
import { classifyCategory } from '../categoryClassifier.js'

describe('classifyCategory', () => {
  it('classifies Revolut as account', () => {
    expect(classifyCategory('Revolut')).toBe('account')
  })

  it('classifies WRev (abbreviation) as account via "rev" keyword', () => {
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

  it('classifies "Wallet" as account', () => {
    expect(classifyCategory('Wallet')).toBe('account')
  })

  it('is case insensitive', () => {
    expect(classifyCategory('REVOLUT')).toBe('account')
    expect(classifyCategory('salary')).toBe('income')
    expect(classifyCategory('PAYPAL')).toBe('account')
  })
})
