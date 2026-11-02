/**
 * The dates a statement covers, as the statement step's card shows them under the bank and the
 * count. Each date holds together with no-break spaces: at 390 px the card wrapped "14 Apr to 1
 * Jul" inside the second date, and a narrower card can only break between the dates.
 */
import { describe, expect, it, vi } from 'vitest'
import { dateRangeText } from '../FirstImport'

vi.mock('../../../features/import/importFlow', () => ({
  createImportFlow: () => null,
}))

describe('the dates a statement covers', () => {
  it('keeps each date in one piece, and breaks only between them', () => {
    expect(dateRangeText('2026-04-14', '2026-07-01', 2026)).toBe('14\u00a0Apr to 1\u00a0Jul')
  })

  it('names the years when the statement is from another year or spans two', () => {
    expect(dateRangeText('2025-12-28', '2026-01-03', 2026)).toBe(
      '28\u00a0Dec\u00a02025 to 3\u00a0Jan\u00a02026'
    )
    expect(dateRangeText('2025-04-14', '2025-07-01', 2026)).toBe(
      '14\u00a0Apr\u00a02025 to 1\u00a0Jul\u00a02025'
    )
  })

  it('says one date once when the statement covers a single day', () => {
    expect(dateRangeText('2026-04-14', '2026-04-14', 2026)).toBe('14\u00a0Apr')
  })
})
