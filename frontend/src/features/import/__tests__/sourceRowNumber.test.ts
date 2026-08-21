/**
 * The row number shown next to an import rejection.
 *
 * Reported from dev: a row the app called 2599 was row 2600 in the sheet. Every parser consumes
 * the first record as the header row, so `rows[0]` is the second line of the source — printing
 * `index + 1` named the line above the one the user had to open.
 */
import { describe, expect, it } from 'vitest'
import { sourceRowNumber } from '../importFlow'

describe('sourceRowNumber', () => {
  it('accounts for the consumed header row', () => {
    // rows[0] is the first row UNDER the header, which the spreadsheet numbers 2.
    expect(sourceRowNumber(0)).toBe(2)
    expect(sourceRowNumber(1)).toBe(3)
  })

  it('reproduces the reported case', () => {
    // The app said 2599 for what the sheet showed as 2600.
    expect(sourceRowNumber(2598)).toBe(2600)
  })

  it('lands on the row the sheet shows for the rows reported earlier', () => {
    // "Row 661 (Date(2026,)" was data index 660, which is line 662 of the exported CSV.
    expect(sourceRowNumber(660)).toBe(662)
  })
})
