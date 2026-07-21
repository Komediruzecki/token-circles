import { describe, expect, it } from 'vitest'
import { computeRowDuplicates } from '../importFlow'

describe('computeRowDuplicates', () => {
  it('pairs each later identical row with the earlier row it matches', () => {
    // Three identical same-day bank fees: the 2nd and 3rd are flagged, both pointing
    // back at the 1st (their counterpart), which the preview shows as "= row 1".
    const rows = [
      ['2026-06-25', 'UPLATA NAKNADE', '0.40'],
      ['2026-06-25', 'UPLATA NAKNADE', '0.40'],
      ['2026-06-25', 'UPLATA NAKNADE', '0.40'],
      ['2026-06-26', 'Groceries', '12'],
    ]
    expect(computeRowDuplicates(rows)).toEqual([
      { index: 1, matchIndex: 0 },
      { index: 2, matchIndex: 0 },
    ])
  })

  it('does not flag rows that differ in any column (e.g. different date)', () => {
    const rows = [
      ['2026-07-16', 'Top-up', '200'],
      ['2026-07-17', 'Top-up', '200'],
      ['2026-07-20', 'Top-up', '200'],
    ]
    expect(computeRowDuplicates(rows)).toEqual([])
  })

  it('trims cells before comparing', () => {
    const rows = [
      ['a', 'b', 'c'],
      [' a ', 'b', 'c '],
    ]
    expect(computeRowDuplicates(rows)).toEqual([{ index: 1, matchIndex: 0 }])
  })
})
