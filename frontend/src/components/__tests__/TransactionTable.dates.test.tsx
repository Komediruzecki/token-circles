/**
 * The Transactions list writes each date as the app does elsewhere, day first with the month's
 * name ("4 Nov 2026"), as setup, the import summary and the prints do (first-week test run, B6).
 * It wrote `toLocaleDateString()` with the browser's own locale, so an English (US) browser showed
 * "11/4/2026" beside a Dashboard that said "Nov 4, 2026".
 *
 * The date fields are the browser's own control (`<input type="date">`): their order follows the
 * browser's language, and the app cannot set it. That is reported, not changed.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDate } from '../../core/api'
import TransactionTable from '../TransactionTable'
import type { Transaction } from '../../types/models'

let host: HTMLDivElement | undefined
let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
})

const row = (date: string): Transaction =>
  ({
    id: 1,
    profile_id: 1,
    description: 'Corner Grocer',
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date,
    account_id: null,
    transfer_account_id: null,
    category_name: null,
    category_color: null,
    reconciled: false,
  }) as unknown as Transaction

describe('dates on the Transactions list', () => {
  it('reads day, month name and year, as the rest of the app writes a date', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <TransactionTable
          transactions={[row('2026-11-04')]}
          selectedTransactions={[]}
          onSelectionChange={() => {}}
        />
      ),
      host
    )
    const cell = host.querySelector('[data-test-id="transactions-row"] td:nth-child(2)')
    expect(cell?.textContent?.trim()).toBe('4 Nov 2026')
  })
})

describe('formatDate, the app-wide way to write a date', () => {
  it.each([
    ['2026-11-04', '4 Nov 2026'],
    ['2026-01-31', '31 Jan 2026'],
    // Google Sheets' Date(Y,M,D), with its month counted from 0.
    ['Date(2026,10,4)', '4 Nov 2026'],
  ])('%s reads %s', (stored, shown) => {
    expect(formatDate(stored)).toBe(shown)
  })

  it('leaves what it cannot read as it is', () => {
    expect(formatDate('someday')).toBe('someday')
  })
})
