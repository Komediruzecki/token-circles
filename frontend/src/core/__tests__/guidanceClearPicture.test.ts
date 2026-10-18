/**
 * D10 decides when the circles firm up: the facts read `firm` from CLEAR_PICTURE_MONTHS
 * (shared/guidance/circles.ts), not from the year the badges count, so a different answer to D10
 * moves it. Here it is six months, as a different D10 would set it.
 */
import { describe, expect, it, vi } from 'vitest'
import { addCalendarMonths } from '../../../../shared/calendarMonths'
import { CLEAR_PICTURE_MONTHS } from '../../../../shared/guidance/circles'
import { guidanceFacts } from '../../../../shared/guidance/facts'
import { YEAR_ON_FILE_MONTHS } from '../../../../shared/trackedMonths'
import type * as Circles from '../../../../shared/guidance/circles'
import type { FactsEntry } from '../../../../shared/guidance/facts'

vi.mock('../../../../shared/guidance/circles', async (importOriginal) => ({
  ...(await importOriginal<typeof Circles>()),
  CLEAR_PICTURE_MONTHS: 6,
}))

/** `count` tracked months before October 2026, three entries each. */
function months(count: number): FactsEntry[] {
  return Array.from({ length: count }, (_, i) =>
    addCalendarMonths('2026-10-01', -(i + 1)).slice(0, 7)
  ).flatMap((month) =>
    [1, 2, 3].map((day) => ({
      date: `${month}-0${day}`,
      type: 'expense',
      amount: 10,
      category_id: null,
    }))
  )
}

describe('D10, the months the first circle needs', () => {
  it('is what firms the facts up, whatever the year the badges count', () => {
    expect(CLEAR_PICTURE_MONTHS).toBe(6)
    expect(YEAR_ON_FILE_MONTHS).toBe(12)
    const firm = (count: number) =>
      guidanceFacts({
        today: '2026-10-11',
        region: 'DE',
        transactions: months(count),
        categories: [],
        accounts: [],
      }).firm
    expect([firm(5), firm(6)]).toEqual([false, true])
  })
})
