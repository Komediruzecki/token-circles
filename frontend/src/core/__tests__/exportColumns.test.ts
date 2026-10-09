/**
 * shared/exportColumns.ts: the kinds there is an export of, and the file each one makes, in both
 * runtimes. Every rule.
 */
import { describe, expect, it } from 'vitest'
import {
  EXPORT_COLUMNS,
  EXPORT_KINDS,
  EXPORT_MESSAGES,
  exportCsv,
  exportFile,
  exportRecords,
  isExportKind,
} from '../../../../shared/exportColumns'

describe('the kinds', () => {
  it('are the six Settings offers, and nothing else', () => {
    expect(EXPORT_KINDS).toEqual([
      'transactions',
      'categories',
      'budgets',
      'accounts',
      'loans',
      'recurring',
    ])
    for (const kind of EXPORT_KINDS) expect(isExportKind(kind)).toBe(true)
    for (const kind of ['goals', 'settings', 'Transactions', '', null, 3]) {
      expect(isExportKind(kind)).toBe(false)
    }
    expect(EXPORT_MESSAGES.kind).toBe(
      'Choose what to export: transactions, categories, budgets, accounts, loans or recurring.'
    )
  })
})

describe('a row in the file', () => {
  it("carries the kind's columns in order, a null for a missing one, and nothing else", () => {
    expect(
      exportRecords('accounts', [{ id: 4, notes: '', balance: 10, name: 'A', profile_id: 1 }])
    ).toEqual([{ name: 'A', type: null, currency: null, balance: 10, notes: '' }])
    expect(Object.keys(exportRecords('accounts', [{}])[0])).toEqual([...EXPORT_COLUMNS.accounts])
  })

  it('writes a yes or no as 1 or 0, as D1 stores it', () => {
    expect(exportRecords('recurring', [{ active: true }, { active: false }])).toEqual([
      expect.objectContaining({ active: 1 }),
      expect.objectContaining({ active: 0 }),
    ])
  })
})

describe('a CSV file', () => {
  const cell = (notes: unknown) =>
    exportCsv('accounts', [{ notes }]).split('\n')[1].split(',').at(-1)

  it('starts with its header, even with no rows', () => {
    expect(exportCsv('loans', [])).toBe(
      'name,principal,interest_rate,start_date,term_months,total_prepaid'
    )
  })

  it('writes a cell that starts like a formula after a single quote', () => {
    for (const text of ['=1+1', '+44 20', '-x', '@SUM(A1)', '\tx', '\rx']) {
      expect(cell(text)).toBe(`'${text}`)
    }
  })

  it('leaves a plain number alone, negative or written as text', () => {
    expect(cell(-2392.21)).toBe('-2392.21')
    expect(cell('-12.5')).toBe('-12.5')
    expect(cell(0)).toBe('0')
  })

  it('quotes a cell with a comma, a quote or a line break, doubling its quotes', () => {
    expect(
      exportCsv('accounts', [{ notes: 'a, "b"\nc' }])
        .split('\n')
        .slice(1)
        .join('\n')
    ).toBe(',,,,"a, ""b""\nc"')
  })

  it('writes nothing for a null', () => {
    expect(cell(null)).toBe('')
  })
})

describe('the file an export answers', () => {
  it('is CSV unless the format is json', () => {
    for (const format of [null, undefined, 'csv', 'xlsx']) {
      expect(exportFile('loans', format, [])).toEqual({
        body: 'name,principal,interest_rate,start_date,term_months,total_prepaid',
        contentType: 'text/csv; charset=utf-8',
        disposition: 'attachment; filename="loans.csv"',
      })
    }
  })

  it('is the list of rows as JSON, indented when asked', () => {
    const rows = [{ name: 'Rent', active: 1 }]
    expect(exportFile('recurring', 'json', rows)).toEqual({
      body: JSON.stringify(exportRecords('recurring', rows)),
      contentType: 'application/json; charset=utf-8',
      disposition: 'attachment; filename="recurring_transactions.json"',
    })
    expect(exportFile('recurring', 'json', rows, true).body).toBe(
      JSON.stringify(exportRecords('recurring', rows), null, 2)
    )
  })
})
