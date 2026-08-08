/**
 * Regression cover for a real Google Sheet that lost 291 rows on import.
 *
 * The rows here are verbatim shapes from that sheet, fetched through the Google Visualization
 * API — which is the frontend's primary strategy, and which delivers dates as `Date(2026,1,7)`
 * rather than a formatted string. Both defects below were reported from the running app:
 *
 *   Row 661 (Date(2026,): Could not read description — check the number format
 *
 * — a row rejected for having no description (a rule the Worker never had, so the same sheet
 * imported clean in the cloud), labelled with a date cut mid-token.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { importExecute } from '../localHandlers.js'

// The sheet's own column order.
const MAPPING = {
  description: 0,
  amount: 1,
  date: 2,
  beneficiary: 3,
  payor: 4,
  category: 5,
  currency: 6,
  amount_local: 7,
  means_of_payment: 8,
  exchange_rate: 9,
  type: 10,
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of ['transactions', 'accounts', 'categories', 'profiles'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01' })
})

describe('import of a real Google Sheet row set', () => {
  it('imports a row whose description is blank', async () => {
    // Row 661 of the reported sheet, verbatim: no description, but a date, an amount, a category
    // and an account — everything needed to be a transaction.
    const response = await importExecute({
      rows: [
        [
          '',
          '1',
          'Date(2026,1,7)',
          'robit:viki',
          'robit:viki',
          'Restaurant',
          'EUR',
          '1',
          'Revolut Joint',
          '',
          'Expense',
        ],
      ],
      mapping: MAPPING,
      dry_run: false,
    })
    const body = await response.json()
    expect(body.skipped_items ?? []).toEqual([])
    expect(body.imported).toBe(1)

    const db = await getDB()
    const rows = await db.getAll('transactions')
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('')
    expect(rows[0].date).toBe('2026-02-07') // gviz months are 0-indexed
    expect(rows[0].amount).toBeCloseTo(1, 2)
  })

  it('imports blank-description rows alongside described ones', async () => {
    const response = await importExecute({
      rows: [
        [
          'Konzum',
          '135.93',
          'Date(2026,6,23)',
          'Konzum',
          'robit:viki',
          'Groceries',
          'EUR',
          '135.93',
          'Revolut Joint',
          '1',
          'Expense',
        ],
        [
          '',
          '570',
          'Date(2026,1,5)',
          'robit',
          'robit',
          'Apartment',
          'EUR',
          '570',
          'Erste Current',
          '',
          'Expense',
        ],
        [
          '',
          '3.5',
          'Date(2026,0,17)',
          'robit',
          'robit',
          'Fun',
          'EUR',
          '3.5',
          'Erste Current',
          '',
          'Expense',
        ],
      ],
      mapping: MAPPING,
      dry_run: false,
    })
    const body = await response.json()
    expect(body.skipped_items ?? []).toEqual([])
    expect(body.imported).toBe(3)
  })

  it('labels a rejected row with the calendar date, not a truncated source value', async () => {
    // The amount is unreadable, so this row IS rejected — the point is what the rejection says.
    const response = await importExecute({
      rows: [
        [
          'Tele2 bon',
          'not-a-number',
          'Date(2026,1,7)',
          '',
          '',
          'Fun',
          'EUR',
          '',
          'Erste Current',
          '',
          'Expense',
        ],
      ],
      mapping: MAPPING,
      dry_run: true,
    })
    const body = await response.json()
    expect(body.skipped_items).toHaveLength(1)
    expect(body.skipped_items[0].label).toBe('2026-02-07 · Tele2 bon')
    expect(body.skipped_items[0].label).not.toContain('Date(')
    expect(body.skipped_items[0].reason).toBe(
      'Could not read amount, amount_local — check the number format'
    )
  })

  it('rejects a row with no date, and says so in those words', async () => {
    const response = await importExecute({
      rows: [
        [
          'Groceries run',
          '12.00',
          '',
          '',
          '',
          'Groceries',
          'EUR',
          '',
          'Erste Current',
          '',
          'Expense',
        ],
      ],
      mapping: MAPPING,
      dry_run: true,
    })
    const body = await response.json()
    expect(body.skipped_items).toHaveLength(1)
    expect(body.skipped_items[0].reason).toBe('No date — every transaction needs one')
    expect(body.skipped_items[0].label).toBe('Groceries run')
    expect(body.imported).toBe(0)
  })

  it('writes nothing for a rejected row', async () => {
    await importExecute({
      rows: [
        ['Bad', 'nope', 'Date(2026,1,7)', '', '', 'Fun', 'EUR', '', 'Erste Current', '', 'Expense'],
      ],
      mapping: MAPPING,
      dry_run: false,
    })
    const db = await getDB()
    expect(await db.count('transactions')).toBe(0)
  })
})
