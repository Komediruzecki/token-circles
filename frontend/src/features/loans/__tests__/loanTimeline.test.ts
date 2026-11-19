/**
 * Where a loan stands on its own timeline, as the chart under a card draws it: the schedule the
 * shared engine works out (saved extra payments included), the payments made by today, what is
 * repaid and what is owed, the months left and the last payment.
 *
 * The loan is made up for this file: 24,000 at 6 % over 48 months, first payment 10 March 2025.
 */
import { describe, expect, it } from 'vitest'
import { amortizeLoan } from '../../../../../shared/loanSchedule'
import { loanTimeline } from '../loanTimeline'
import type { LoanInput } from '../../../../../shared/loanSchedule'

const BOAT: LoanInput = {
  principal: 24000,
  interest_rate: 6,
  start_date: '2025-03-10',
  term_months: 48,
  rate_periods: [],
  prepayments: [],
}

describe('loanTimeline', () => {
  it('counts the payments due by today and reads what is owed after them', () => {
    const t = loanTimeline(BOAT, '2026-11-19')
    const rows = amortizeLoan(BOAT).rows
    // March 2025 to November 2026: 21 payments.
    expect(t.made).toBe(21)
    expect(t.owed).toBe(rows[20].balance)
    expect(t.repaid).toBeCloseTo(24000 - rows[20].balance, 6)
    expect(t.left).toBe(27)
    expect(t.payoffMonth).toBe(48)
    expect(t.payoffDate).toBe('2029-02-10')
    expect(t.paidOff).toBe(false)
    expect(t.dated).toBe(true)
  })

  it('counts a payment due today as made, as the card does', () => {
    expect(loanTimeline(BOAT, '2026-11-10').made).toBe(21)
    expect(loanTimeline(BOAT, '2026-11-09').made).toBe(20)
  })

  it('owes the whole principal before the first payment', () => {
    const t = loanTimeline(BOAT, '2025-01-02')
    expect(t.made).toBe(0)
    expect(t.owed).toBe(24000)
    expect(t.repaid).toBe(0)
    expect(t.left).toBe(48)
  })

  it('is paid off once the last payment is behind it', () => {
    const t = loanTimeline(BOAT, '2030-01-01')
    expect(t.made).toBe(48)
    expect(t.owed).toBeCloseTo(0, 6)
    expect(t.left).toBe(0)
    expect(t.paidOff).toBe(true)
  })

  it('marks each extra payment as made or still to come, and ends the loan sooner', () => {
    const t = loanTimeline(
      {
        ...BOAT,
        prepayments: [
          { month: 6, amount: 2000, note: 'Bonus' },
          { month: 30, amount: 1500, note: '' },
        ],
      },
      '2026-11-19'
    )
    expect(t.extras).toEqual([
      { month: 6, date: '2025-08-10', amount: 2000, made: true },
      { month: 30, date: '2027-08-10', amount: 1500, made: false },
    ])
    expect(t.payoffMonth).toBeLessThan(48)
    expect(t.left).toBe(t.payoffMonth! - 21)
  })

  it('has no months left and no payoff when the loan is never repaid', () => {
    // From payment 13 the rate jumps and the installment is kept, so it stops covering the interest.
    const t = loanTimeline(
      {
        ...BOAT,
        rate_periods: [{ rate: 40, start_month: 13, end_month: null }],
        on_rate_change: 'keep-installment',
      },
      '2026-11-19'
    )
    expect(t.neverPaysOffFrom).not.toBeNull()
    expect(t.left).toBeNull()
    expect(t.payoffMonth).toBeNull()
    expect(t.payoffDate).toBeNull()
    expect(t.paidOff).toBe(false)
  })

  it('makes no payment on a loan whose start date cannot be read', () => {
    const t = loanTimeline({ ...BOAT, start_date: '' }, '2026-11-19')
    expect(t.dated).toBe(false)
    expect(t.made).toBe(0)
    expect(t.owed).toBe(24000)
    expect(t.left).toBe(48)
    expect(t.payoffMonth).toBe(48)
    expect(t.payoffDate).toBeNull()
  })
})
