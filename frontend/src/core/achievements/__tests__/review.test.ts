import { describe, expect, it } from 'vitest'
import { buildYearReview } from '../review'
import { month, tx } from './fixtures'

describe('buildYearReview', () => {
  it('totals the calendar year and names the best saving month and biggest category', () => {
    const transactions = [
      ...month('2026-03', 3, { amount: 100, category_id: 1 }),
      ...month('2026-04', 3, { amount: 50, category_id: 2 }),
      tx('2026-03-28', { type: 'income', amount: 400 }),
      tx('2026-04-28', { type: 'income', amount: 400 }),
      ...month('2025-04', 3, { amount: 999, category_id: 2 }),
    ]
    const r = buildYearReview({ transactions, today: '2026-09-07' })
    expect(r.year).toBe(2026)
    expect(r.income).toBe(800)
    expect(r.expenses).toBe(450)
    expect(r.saved).toBe(350)
    expect(r.bestMonth).toEqual({ month: '2026-04', saved: 250 })
    expect(r.topCategory).toEqual({ id: 1, total: 300 })
    expect(r.trackedMonths).toBe(2)
    expect(r.entries).toBe(8)
  })

  it('is empty rather than wrong when the year holds nothing', () => {
    const r = buildYearReview({ transactions: [], today: '2026-09-07' })
    expect(r.saved).toBe(0)
    expect(r.bestMonth).toBeNull()
    expect(r.topCategory).toBeNull()
    expect(r.trackedMonths).toBe(0)
  })

  it('can be asked for an earlier year', () => {
    const r = buildYearReview({
      transactions: month('2025-04', 3, { amount: 10 }),
      today: '2026-09-07',
      year: 2025,
    })
    expect(r.year).toBe(2025)
    expect(r.expenses).toBe(30)
  })
})
