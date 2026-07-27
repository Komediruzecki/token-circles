import { describe, expect, it } from 'vitest'
import { mappingToHeaderNames, resolveHeaderMapping } from '../importMapping'

// The saved-source feature persists a column mapping BY HEADER NAME so it survives the sheet
// owner reordering columns; these two helpers are that round-trip.

describe('mappingToHeaderNames', () => {
  it('converts field→index into field→header name', () => {
    const headers = ['Date', 'Memo', 'Amount']
    expect(mappingToHeaderNames({ date: 0, description: 1, amount: 2 }, headers)).toEqual({
      date: 'Date',
      description: 'Memo',
      amount: 'Amount',
    })
  })

  it('drops indices that fall outside the header row', () => {
    expect(mappingToHeaderNames({ date: 0, amount: 9 }, ['Date'])).toEqual({ date: 'Date' })
  })
})

describe('resolveHeaderMapping', () => {
  it('resolves header names back to their current indices', () => {
    const headers = ['Date', 'Memo', 'Amount']
    expect(resolveHeaderMapping({ date: 'Date', amount: 'Amount' }, headers)).toEqual({
      date: 0,
      amount: 2,
    })
  })

  it('survives reordered columns (the whole point of storing by name)', () => {
    const saved = mappingToHeaderNames({ date: 0, amount: 1 }, ['Date', 'Amount'])
    // The sheet owner reorders columns so Amount now comes first.
    expect(resolveHeaderMapping(saved, ['Amount', 'Date'])).toEqual({ date: 1, amount: 0 })
  })

  it('matches case-insensitively and drops a header that vanished', () => {
    expect(resolveHeaderMapping({ date: 'date', amount: 'Total' }, ['DATE', 'Amount'])).toEqual({
      date: 0,
    })
  })
})
