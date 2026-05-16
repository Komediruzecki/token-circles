import { describe, expect, it } from 'vitest'
import {
  calcMonthlyPayment,
  calculateSchedule,
  calculateScheduleNoPrepayments,
  getSummary,
  interestSaved,
  monthsSaved,
  payoffDate,
  totalInterest,
  totalPaid,
} from '../loanCalculator.js'

describe('calcMonthlyPayment', () => {
  it('calculates monthly payment for 0% interest', () => {
    expect(calcMonthlyPayment(12000, 0, 12)).toBeCloseTo(1000, 2)
  })

  it('calculates monthly payment for positive interest', () => {
    const payment = calcMonthlyPayment(100000, 5, 360)
    expect(payment).toBeCloseTo(536.82, 0)
  })

  it('handles short-term loan', () => {
    const payment = calcMonthlyPayment(5000, 10, 6)
    expect(payment).toBeGreaterThan(5000 / 6) // interest added
    expect(payment).toBeLessThan(1000)
  })
})

describe('calculateSchedule', () => {
  it('produces correct schedule for simple loan', () => {
    const schedule = calculateSchedule(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ])
    expect(schedule.length).toBe(12)
    expect(schedule[0].balance).toBeLessThan(10000)
    expect(schedule[0].interest).toBeCloseTo(50, 0) // 10000 * 6% / 12
    expect(schedule[11].balance).toBeLessThan(1)
  })

  it('handles 0% interest correctly', () => {
    const schedule = calculateSchedule(12000, '2024-01-01', 12, [
      { rate: 0, start_month: 1 },
    ])
    expect(schedule.length).toBe(12)
    expect(schedule[0].principal).toBeCloseTo(1000, 2)
    expect(schedule[11].balance).toBeCloseTo(0, 2)
  })

  it('applies prepayments to reduce principal', () => {
    const withPrepay = calculateSchedule(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ], [{ month: 3, amount: 2000 }])
    const noPrepay = calculateScheduleNoPrepayments(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ])
    // With prepayment, loan should be paid off faster
    expect(withPrepay.length).toBeLessThan(noPrepay.length)
    // Total interest should be lower with prepayment
    expect(totalInterest(withPrepay)).toBeLessThan(totalInterest(noPrepay))
  })

  it('uses correct rate from variable rate periods', () => {
    const schedule = calculateSchedule(100000, '2024-01-01', 24, [
      { rate: 4, start_month: 1, end_month: 12 },
      { rate: 6, start_month: 13 },
    ])
    expect(schedule[0].rate).toBe(4)
    expect(schedule[12].rate).toBe(6)
  })
})

describe('utility functions', () => {
  const schedule = calculateSchedule(10000, '2024-01-01', 12, [
    { rate: 6, start_month: 1 },
  ])
  const prepaySchedule = calculateSchedule(10000, '2024-01-01', 12, [
    { rate: 6, start_month: 1 },
  ], [{ month: 2, amount: 3000 }])

  it('totalInterest sums all interest', () => {
    const interest = totalInterest(schedule)
    expect(interest).toBeGreaterThan(0)
    expect(interest).toBeLessThan(10000)
  })

  it('totalPaid includes payments and prepayments', () => {
    const paid = totalPaid(prepaySchedule)
    expect(paid).toBeGreaterThan(10000)
  })

  it('payoffDate returns last schedule date', () => {
    expect(payoffDate(schedule)).toBe(schedule[schedule.length - 1].date)
  })

  it('payoffDate returns null for empty schedule', () => {
    expect(payoffDate([])).toBeNull()
  })

  it('interestSaved computes difference correctly', () => {
    const saved = interestSaved(schedule, prepaySchedule)
    expect(saved).toBeGreaterThan(0)
  })

  it('monthsSaved returns positive value', () => {
    const saved = monthsSaved(schedule, prepaySchedule)
    expect(saved).toBeGreaterThan(0)
  })
})

describe('getSummary', () => {
  it('returns full summary object', () => {
    const schedule = calculateSchedule(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ])
    const summary = getSummary(schedule, schedule)

    expect(summary.totalPaid).toBeGreaterThan(0)
    expect(summary.totalInterest).toBeGreaterThan(0)
    expect(summary.interestSaved).toBe(0) // same schedule
    expect(summary.payoffDate).toBeTruthy()
    expect(summary.totalPayments).toBe(12)
    expect(summary.avgMonthlyPayment).toBeGreaterThan(0)
    expect(summary.maxBalance).toBeGreaterThan(9000)
  })

  it('shows interest saved when comparing schedules', () => {
    const original = calculateSchedule(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ])
    const prepay = calculateSchedule(10000, '2024-01-01', 12, [
      { rate: 6, start_month: 1 },
    ], [{ month: 3, amount: 5000 }])
    const summary = getSummary(prepay, original)

    expect(summary.interestSaved).toBeGreaterThan(0)
    expect(summary.monthsSaved).toBeGreaterThan(0)
    expect(summary.totalPayments).toBeLessThan(summary.originalTotalPayments)
  })
})
