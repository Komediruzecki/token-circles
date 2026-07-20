import { describe, expect, it } from 'vitest'
import { fromToLabels } from '../transactionFlow'

// The "From/To" column renders the real money flow, preferring the external counterparty
// (payor for income, beneficiary for expense) and falling back to the category label.

describe('fromToLabels', () => {
  describe('with a captured counterparty', () => {
    it('income shows payor → account (money arrives from the payer)', () => {
      expect(
        fromToLabels({
          type: 'income',
          means_of_payment: 'Erste Current',
          category_name: 'Salary Eur',
          payor: 'RIMAC TECHNOLOGY D.O.O.',
        })
      ).toEqual({ from: 'RIMAC TECHNOLOGY D.O.O.', to: 'Erste Current' })
    })

    it('expense shows account → beneficiary (money goes to the payee)', () => {
      expect(
        fromToLabels({
          type: 'expense',
          means_of_payment: 'Revolut Joint',
          category_name: 'Groceries',
          beneficiary: 'Konzum',
        })
      ).toEqual({ from: 'Revolut Joint', to: 'Konzum' })
    })

    it('transfer ignores payor/beneficiary and stays account → account', () => {
      expect(
        fromToLabels({
          type: 'transfer',
          means_of_payment: 'Erste Current',
          category_name: 'Revolut',
          payor: 'x',
          beneficiary: 'y',
        })
      ).toEqual({ from: 'Erste Current', to: 'Revolut' })
    })

    it('uses the category as the endpoint when there is no separate account', () => {
      // income with a payer but no distinct account
      expect(
        fromToLabels({
          type: 'income',
          means_of_payment: '',
          category_name: 'Salary Eur',
          payor: 'RIMAC',
        })
      ).toEqual({ from: 'RIMAC', to: 'Salary Eur' })
      // expense with a payee but no distinct account
      expect(
        fromToLabels({
          type: 'expense',
          means_of_payment: '',
          category_name: 'Groceries',
          beneficiary: 'Konzum',
        })
      ).toEqual({ from: 'Groceries', to: 'Konzum' })
    })
  })

  describe('falls back to the category label when no counterparty is captured', () => {
    it('income → category → account', () => {
      expect(
        fromToLabels({
          type: 'income',
          means_of_payment: 'Erste Current',
          category_name: 'Salary Eur',
        })
      ).toEqual({ from: 'Salary Eur', to: 'Erste Current' })
    })

    it('expense → account → category', () => {
      expect(
        fromToLabels({
          type: 'expense',
          means_of_payment: 'Erste Current',
          category_name: 'Groceries',
        })
      ).toEqual({ from: 'Erste Current', to: 'Groceries' })
    })

    it('brokerage income (no account) shows category as the destination', () => {
      expect(fromToLabels({ type: 'income', means_of_payment: '', category_name: 'IB' })).toEqual({
        from: '—',
        to: 'IB',
      })
    })
  })

  describe('missing fields', () => {
    it('falls back to an em dash', () => {
      expect(fromToLabels({ type: 'expense', means_of_payment: '', category_name: '' })).toEqual({
        from: '—',
        to: '—',
      })
      expect(fromToLabels({ type: 'income', means_of_payment: 'Cash', category_name: '' })).toEqual(
        {
          from: '—',
          to: 'Cash',
        }
      )
    })

    it('trims surrounding whitespace', () => {
      expect(
        fromToLabels({
          type: 'income',
          means_of_payment: '  Erste Current  ',
          category_name: ' Salary Eur ',
          payor: '  RIMAC  ',
        })
      ).toEqual({ from: 'RIMAC', to: 'Erste Current' })
    })
  })
})
