/**
 * The summary a statement from a bank the app knows opens on, on the Import page (review M4):
 * "N26 file recognised: 300 entries, 1 Nov 2025 to 31 Oct 2026." and one button, "Import 300
 * entries", as setup reads the same file. The count is what the import adds: the rows picked, less
 * those here already, which get a line of their own.
 */
import { describe, expect, it } from 'vitest'
import { bankSummary, summarises } from '../bankSummary'
import type { BankFileRow } from '../importFlow'

const file = (bankId: BankFileRow['bankId'], extra: Partial<BankFileRow> = {}): BankFileRow => ({
  file: new File(['x'], `${bankId ?? 'unknown'}.csv`),
  bytes: new Uint8Array(),
  bankId,
  confidence: 1,
  meta: {},
  targetAccount: 'Main',
  ...extra,
})

/** Rows as the bank transform leaves them: the date first, as ISO. */
const rows = (dates: string[]) => dates.map((d, i) => [d, `Entry ${i}`, '-1.00'])
const all = (n: number) => new Set(Array.from({ length: n }, (_, i) => i))
const THIS_YEAR = 2026

describe('which statements open on the summary', () => {
  it('every file from a bank the app knows, with an account to go into', () => {
    expect(summarises([file('n26')])).toBe(true)
    expect(summarises([file('n26'), file('revolut')])).toBe(true)
  })

  it('not a file the app does not know, nor one that names its own accounts, nor none', () => {
    expect(summarises([file(null)])).toBe(false)
    expect(summarises([file('n26'), file(null)])).toBe(false)
    expect(summarises([file('ynab', { meta: { accounts: ['Checking', 'Card'] } })])).toBe(false)
    expect(summarises([])).toBe(false)
  })
})

describe('the summary', () => {
  it("reads as the review's N26 year: the bank, the count and the dates, and the button", () => {
    const dates = ['2025-11-01', '2026-03-14', '2026-10-31']
    const s = bankSummary(
      {
        files: [file('n26')],
        rows: rows(dates),
        dateColumn: 0,
        selected: all(3),
        alreadyHere: [],
        invalid: 0,
        newCategories: [],
      },
      THIS_YEAR
    )
    expect(s.line).toBe(
      'N26 file recognised: 3 entries, 1\u00a0Nov\u00a02025 to 31\u00a0Oct\u00a02026.'
    )
    expect(s.button).toBe('Import 3 entries')
    expect(s.notes).toEqual(['Goes into Main.'])
  })

  it('counts what the import adds, and says how many are here already', () => {
    const s = bankSummary(
      {
        files: [file('revolut')],
        rows: rows(['2026-04-14', '2026-05-14', '2026-06-14', '2026-07-01']),
        dateColumn: 0,
        selected: all(4),
        alreadyHere: [0, 1],
        invalid: 0,
        newCategories: [],
      },
      THIS_YEAR
    )
    // The dates are the new entries': the two here already are not what comes in.
    expect(s.line).toBe('Revolut file recognised: 2 entries, 14\u00a0Jun to 1\u00a0Jul.')
    expect(s.button).toBe('Import 2 entries')
    expect(s.notes).toEqual([
      'Goes into Main.',
      '2 entries in it are here already and stay as they are.',
    ])
  })

  it('leaves out a row that was not picked, and says how many rows cannot be imported', () => {
    const s = bankSummary(
      {
        files: [file('n26')],
        rows: rows(['2026-09-01', '2026-09-02', '2026-09-03']),
        dateColumn: 0,
        selected: new Set([0, 2]),
        alreadyHere: [],
        invalid: 1,
        newCategories: [],
      },
      THIS_YEAR
    )
    expect(s.line).toBe('N26 file recognised: 2 entries, 1\u00a0Sept to 3\u00a0Sept.')
    expect(s.notes).toContain("1 row can't be imported as it is. Check the columns to see why.")
  })

  it('names the new categories, three and how many more', () => {
    const s = bankSummary(
      {
        files: [file('n26')],
        rows: rows(['2026-09-01']),
        dateColumn: 0,
        selected: all(1),
        alreadyHere: [],
        invalid: 0,
        newCategories: ['Food', 'Travel', 'Pets', 'Gym', 'Books'],
      },
      THIS_YEAR
    )
    expect(s.notes).toContain('New categories: Food, Travel, Pets and 2 more.')
    expect(s.line).toBe('N26 file recognised: 1 entry, 1\u00a0Sept.')
    expect(s.button).toBe('Import 1 entry')
  })

  it('names each bank and each account for several files', () => {
    const s = bankSummary(
      {
        files: [file('n26'), file('revolut', { targetAccount: 'Revolut' }), file('n26')],
        rows: rows(['2026-09-01', '2026-10-01']),
        dateColumn: 0,
        selected: all(2),
        alreadyHere: [],
        invalid: 0,
        newCategories: [],
      },
      THIS_YEAR
    )
    expect(s.line).toMatch(/^N26 and Revolut files recognised: 2 entries, /)
    expect(s.notes[0]).toBe('Goes into Main and Revolut.')
  })

  it('offers no import when everything in it is here already, or nothing in it can be', () => {
    const here = bankSummary(
      {
        files: [file('n26')],
        rows: rows(['2026-09-01', '2026-09-02']),
        dateColumn: 0,
        selected: all(2),
        alreadyHere: [0, 1],
        invalid: 0,
        newCategories: [],
      },
      THIS_YEAR
    )
    expect(here.line).toBe('N26 file recognised: all 2 entries in it are here already.')
    expect(here.button).toBeNull()
    expect(here.notes).toEqual([])

    const none = bankSummary(
      {
        files: [file('n26')],
        rows: rows(['2026-09-01']),
        dateColumn: 0,
        selected: new Set<number>(),
        alreadyHere: [],
        invalid: 1,
        newCategories: [],
      },
      THIS_YEAR
    )
    expect(none.line).toBe('N26 file recognised, but none of its rows can be imported as they are.')
    expect(none.button).toBeNull()
    expect(none.notes).toEqual(['Check the columns to see why.'])
  })
})
