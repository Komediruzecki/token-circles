/**
 * After an import, the Import page lists each account it touched with its balance today, and
 * "Not what your bank shows? Set today's balance" (review M2): the figure typed is set as the
 * balance today, with the imported entries worked back from it (core/balanceToday.ts).
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportBalances, touchedSince } from '../ImportBalances'
import type { StoredAccount } from '../../../core/balanceToday'

const calls = vi.hoisted(() => ({
  stored: vi.fn<() => Promise<StoredAccount[]>>(),
  today: vi.fn<(account: StoredAccount) => Promise<number>>(),
  set: vi.fn<(account: StoredAccount, figure: number) => Promise<boolean>>(),
}))
vi.mock('../../../core/balanceToday', () => ({
  storedAccounts: () => calls.stored(),
  balanceToday: (account: StoredAccount) => calls.today(account),
  setBalanceToday: (account: StoredAccount, figure: number) => calls.set(account, figure),
}))
vi.mock('../../../core/api', () => ({
  formatCurrency: (n: number) => `€${n.toFixed(2)}`,
  showToast: vi.fn(),
}))

const MAIN: StoredAccount = { id: 7, name: 'Main', balance: 3106.37, starting_balance: 1240.5 }
const CARD: StoredAccount = { id: 8, name: 'Card', balance: -120, starting_balance: 0 }

let host: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  calls.stored.mockResolvedValue([MAIN, CARD])
  calls.today.mockImplementation(async (account) => account.balance)
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  dispose?.()
  host.remove()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const byTestId = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-test-id="${id}"]`)]

describe('the accounts an import touched', () => {
  it('are the ones whose balance moved, and the ones it made', () => {
    const before = new Map([
      [7, 1240.5],
      [8, -120],
    ])
    const after = [MAIN, CARD, { id: 9, name: 'Savings', balance: 0, starting_balance: 0 }]
    expect(touchedSince(before, after).map((a) => a.name)).toEqual(['Main', 'Savings'])
  })
})

describe('the balances after an import', () => {
  it('lists each account with its balance today and the way to set it', async () => {
    dispose = render(() => <ImportBalances accounts={[MAIN]} />, host)
    await settle()
    const [row] = byTestId('import-balance-row')
    expect(row.textContent).toContain('Main')
    expect(byTestId('import-balance-today')[0].textContent).toBe('€3106.37')
    const set = byTestId('import-balance-set')[0]
    expect(set.textContent).toBe("Not what your bank shows? Set today's balance")
    expect(set.tagName).toBe('BUTTON')
  })

  it('sets the figure typed as the balance today, and reads it back', async () => {
    calls.set.mockResolvedValue(true)
    dispose = render(() => <ImportBalances accounts={[MAIN]} />, host)
    await settle()
    byTestId('import-balance-set')[0].click()
    await settle()
    const input = byTestId('import-balance-input')[0] as HTMLInputElement
    expect(document.activeElement).toBe(input)
    for (const text of ['1', '12', '1240', '1240.', '1240.5']) {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      expect(document.activeElement).toBe(input)
    }
    calls.stored.mockResolvedValue([{ ...MAIN, balance: 1240.5, starting_balance: -625.37 }])
    byTestId('import-balance-save')[0].click()
    await vi.waitFor(() => {
      expect(byTestId('import-balance-today')[0].textContent).toBe('€1240.50')
    })
    expect(calls.set).toHaveBeenCalledWith(MAIN, 1240.5)
    expect(byTestId('import-balance-input')).toHaveLength(0)
  })

  it('says what it could not read, and writes nothing', async () => {
    dispose = render(() => <ImportBalances accounts={[MAIN]} />, host)
    await settle()
    byTestId('import-balance-set')[0].click()
    await settle()
    const input = byTestId('import-balance-input')[0] as HTMLInputElement
    input.value = 'lots'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    byTestId('import-balance-save')[0].click()
    await settle()
    expect(calls.set).not.toHaveBeenCalled()
    expect(byTestId('import-balance-error')[0].textContent).toBe(
      'Type the balance as a number, like 1240.50.'
    )
  })

  it('shows nothing while the import touched no account', async () => {
    dispose = render(() => <ImportBalances accounts={[]} />, host)
    await settle()
    expect(byTestId('import-balances')).toHaveLength(0)
  })
})
