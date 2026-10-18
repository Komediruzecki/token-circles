/**
 * The Transactions form's account select names each account's type in brackets, as the Accounts
 * page's badge does: a type v4 renamed as the type that replaced it, and a type this build does not
 * have as a plain "account" (core/accountTypes.ts).
 *
 * The list here comes from a mocked api.getAccounts that hands rows over as stored, so the select
 * is what reads the type, not the reader in front of it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

const serverAccounts = [
  { id: 1, name: 'Everyday', type: 'giro', currency: 'EUR', profile_id: 1 },
  { id: 2, name: 'Old current', type: 'checking', currency: 'EUR', profile_id: 1 },
  { id: 3, name: 'Visa', type: 'credit', currency: 'EUR', profile_id: 1 },
]

vi.mock('../../core/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: {
    getTransactions: vi.fn(async () => []),
    getCategories: vi.fn(async () => []),
    getTags: vi.fn(async () => []),
    getAccounts: vi.fn(async () => serverAccounts.map((a) => ({ ...a }))),
  },
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  __resetDataVersionsForTest()
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  setPage('transactions')
  setPeriod({ mode: 'range', year: 2026, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
})

describe("the add-transaction form's account select", () => {
  it('names each account with its type as the Accounts badge says it', async () => {
    const { default: Transactions } = await import('../Transactions')
    dispose = render(() => <Transactions />, host)
    await flush()
    await flush()
    host.querySelector<HTMLElement>('[data-test-id="add-transaction-btn"]')!.click()
    await vi.waitFor(() => {
      const select = host.querySelector<HTMLSelectElement>('[data-test-id="tx-account"]')
      expect(select?.options.length).toBe(4)
    })

    const select = host.querySelector<HTMLSelectElement>('[data-test-id="tx-account"]')!
    expect(Array.from(select.options, (o) => o.textContent?.trim()).slice(1)).toEqual([
      'Everyday (giro)',
      'Old current (giro)',
      'Visa (account)',
    ])
  })
})
