import { describe, expect, it } from 'vitest'
import { bySavedOrder } from '../../../../shared/budgetSavedOrder'
import { budgetsForMonth } from '../achievements/budgets'

// D1 writes created_at as datetime('now'), 'YYYY-MM-DD HH:MM:SS'; local-first writes
// new Date().toISOString(), 'YYYY-MM-DDTHH:MM:SS.sssZ'. Both are UTC. A restore can put one of each
// in a month, and compared as text the space (0x20) sorts before 'T', so on the same day the D1 row
// always counted as saved first, whatever the time.
describe('bySavedOrder', () => {
  const d1 = { id: 1, created_at: '2026-10-09 18:00:00' }
  const local = { id: 2, created_at: '2026-10-09T08:00:00.000Z' }

  it('orders a D1 time and an ISO time by the time they name', () => {
    expect([d1, local].sort(bySavedOrder)).toEqual([local, d1])
    expect([local, d1].sort(bySavedOrder)).toEqual([local, d1])
  })

  it('compares to the second, then by id', () => {
    // The same second in both formats: the higher id was saved last.
    const sameSecond = { id: 3, created_at: '2026-10-09 08:00:00' }
    expect([local, sameSecond].sort(bySavedOrder)).toEqual([local, sameSecond])
    expect([sameSecond, local].sort(bySavedOrder)).toEqual([local, sameSecond])
  })

  it('lets a month keep the D1 row saved later than the local one', () => {
    const row = (over: { id: number; created_at: string; amount: number }) => ({
      category_id: 1,
      period: 'monthly' as const,
      start_date: '2026-10-01',
      end_date: null,
      ...over,
    })
    const kept = budgetsForMonth(
      [row({ ...local, amount: 400 }), row({ ...d1, amount: 310 })],
      '2026-10'
    )
    expect(kept.map((b) => b.amount)).toEqual([310])
  })
})
