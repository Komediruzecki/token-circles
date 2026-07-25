import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import TransactionTable from '../TransactionTable'
import type { Transaction } from '../../types/models'

// Audit #2: the list aggregates across selected (household) profiles, but writes are scoped to
// the active profile. Rows owned by another profile are gated — their edit/copy/delete controls
// and selection checkbox are disabled — so an edit/delete/reconcile can't fail with
// "Transaction not found."

let host: HTMLDivElement
let dispose: () => void

afterEach(() => {
  dispose?.()
  host?.remove()
})

function tx(id: number, profileId: number): Transaction {
  return {
    id,
    profile_id: profileId,
    description: `Row ${id}`,
    type: 'expense',
    amount: 10,
    amount_local: 10,
    currency: 'EUR',
    exchange_rate: 1,
    date: '2026-01-01',
    account_id: null,
    transfer_account_id: null,
    category_name: null,
    category_color: null,
    reconciled: false,
  } as unknown as Transaction
}

function renderTable(props: {
  activeProfileId?: number
  onSelectionChange?: (ids: number[]) => void
}): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <TransactionTable
        transactions={[tx(1, 1), tx(2, 2)]}
        selectedTransactions={[]}
        onSelectionChange={props.onSelectionChange ?? (() => {})}
        activeProfileId={props.activeProfileId}
      />
    ),
    host
  )
}

function rows(): HTMLElement[] {
  return Array.from(host.querySelectorAll('[data-test-id="transactions-row"]'))
}

describe('TransactionTable — cross-profile gating', () => {
  it('disables edit/copy/delete and the checkbox on a row owned by another profile', () => {
    renderTable({ activeProfileId: 1 })
    const [ownRow, foreignRow] = rows()

    const ownButtons = Array.from(ownRow.querySelectorAll('button')) as HTMLButtonElement[]
    expect(ownButtons.length).toBeGreaterThanOrEqual(3)
    expect(ownButtons.every((b) => !b.disabled)).toBe(true)
    expect((ownRow.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(false)

    const foreignButtons = Array.from(foreignRow.querySelectorAll('button')) as HTMLButtonElement[]
    expect(foreignButtons.length).toBe(3)
    expect(foreignButtons.every((b) => b.disabled)).toBe(true)
    expect(foreignButtons[0].title).toMatch(/another profile/i)
    expect((foreignRow.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(
      true
    )
  })

  it('select-all selects only rows owned by the active profile', () => {
    let selection: number[] | null = null
    renderTable({ activeProfileId: 1, onSelectionChange: (ids) => (selection = ids) })
    const headerCheckbox = host.querySelector('thead input[type=checkbox]') as HTMLInputElement
    headerCheckbox.checked = true
    headerCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    expect(selection).toEqual([1])
  })

  it('gates nothing when no active profile is provided (single-profile callers)', () => {
    renderTable({})
    for (const row of rows()) {
      const buttons = Array.from(row.querySelectorAll('button')) as HTMLButtonElement[]
      expect(buttons.every((b) => !b.disabled)).toBe(true)
      expect((row.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(false)
    }
  })
})
