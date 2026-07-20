import { describe, expect, it } from 'vitest'
import { fromToLabels } from '../transactionFlow'

// The "From/To" column used to render `means_of_payment → category_name` for EVERY
// type, which is backwards for income (a salary read as "Erste Current → Salary Eur",
// i.e. money leaving the account). fromToLabels makes the arrow direction-aware.

const base = { means_of_payment: 'Erste Current', category_name: 'Salary Eur' }

describe('fromToLabels', () => {
  it('flips income to source → account (money arrives INTO the account)', () => {
    expect(fromToLabels({ ...base, type: 'income' })).toEqual({
      from: 'Salary Eur',
      to: 'Erste Current',
    })
  })

  it('keeps expense as account → category (money leaves the account)', () => {
    expect(fromToLabels({ ...base, type: 'expense', category_name: 'Groceries' })).toEqual({
      from: 'Erste Current',
      to: 'Groceries',
    })
  })

  it('keeps transfer as from-account → to-account', () => {
    expect(
      fromToLabels({
        type: 'transfer',
        means_of_payment: 'Erste Current',
        category_name: 'Revolut',
      })
    ).toEqual({ from: 'Erste Current', to: 'Revolut' })
  })

  it('shows the category as the destination for income with no separate account (e.g. brokerage deposit)', () => {
    expect(fromToLabels({ type: 'income', means_of_payment: '', category_name: 'IB' })).toEqual({
      from: '—',
      to: 'IB',
    })
  })

  it('falls back to an em dash when fields are missing', () => {
    expect(fromToLabels({ type: 'expense', means_of_payment: '', category_name: '' })).toEqual({
      from: '—',
      to: '—',
    })
    expect(fromToLabels({ type: 'income', means_of_payment: 'Cash', category_name: '' })).toEqual({
      from: '—',
      to: 'Cash',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(
      fromToLabels({
        type: 'income',
        means_of_payment: '  Erste Current  ',
        category_name: ' Salary Eur ',
      })
    ).toEqual({ from: 'Salary Eur', to: 'Erste Current' })
  })
})
