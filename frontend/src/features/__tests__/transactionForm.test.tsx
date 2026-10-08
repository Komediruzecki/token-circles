/**
 * The Transactions form, run against the real local-first router on fake-indexeddb.
 *
 * The form people use most. These drive it as a person does, through the page, and read what the
 * router stored: the router runs the same rules as the Worker (shared/transactionSchema.ts), so
 * what it stores is what a save means in either mode.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

const EVERYDAY = 1
const SAVINGS = 2
const GROCERIES = 11
const SALARY = 12
const PLAIN = 41 // an expense with its notes, beneficiary and payor filled in
const FX = 42 // 100 USD, 92 in the base currency, at 0.92

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Paid here, not inside the first test's waitFor: the page and the router `apiFetch` loads on the
  // first request are heavy imports, and a loaded machine made them outlast a timeout.
  await Promise.all([import('../Transactions'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  const account = (id: number, name: string, balance: number) =>
    db.add('accounts', {
      id,
      profile_id: 1,
      name,
      type: 'giro',
      bank_name: '',
      currency: 'EUR',
      balance,
      starting_balance: balance,
      starting_date: null,
      notes: '',
    } as never)
  await account(EVERYDAY, 'Everyday', 1000)
  await account(SAVINGS, 'Savings', 500)
  const category = (id: number, name: string, type: string) =>
    db.add('categories', {
      id,
      profile_id: 1,
      name,
      type,
      color: '#59d2a2',
      icon: 'tag',
      parent_id: null,
      tax_deductible: false,
      created_at: '2026-01-01T00:00:00.000Z',
    } as never)
  await category(GROCERIES, 'Groceries', 'expense')
  await category(SALARY, 'Salary', 'income')
  const row = (values: Row) =>
    db.add('transactions', {
      profile_id: 1,
      type: 'expense',
      amount: 10,
      amount_local: 10,
      currency: 'EUR',
      exchange_rate: 1,
      date: '2026-10-01',
      category_id: GROCERIES,
      account_id: EVERYDAY,
      transfer_account_id: null,
      notes: '',
      beneficiary: '',
      payor: '',
      means_of_payment: '',
      created_at: '2026-10-01T09:00:00.000Z',
      updated_at: '2026-10-01T09:00:00.000Z',
      ...values,
    } as never)
  await row({
    id: PLAIN,
    description: 'Weekly groceries',
    amount: 82.4,
    amount_local: 82.4,
    notes: 'From the market',
    beneficiary: 'Market',
    payor: 'Me',
  })
  await row({
    id: FX,
    description: 'Hotel',
    amount: 100,
    amount_local: 92,
    currency: 'USD',
    exchange_rate: 0.92,
  })
  for (const toast of toasts()) removeToast(toast.id)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mountPage(): Promise<void> {
  const { default: Transactions } = await import('../Transactions')
  dispose = render(() => <Transactions />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="transactions-row"]').length).toBeGreaterThan(0)
  })
}

/** The element with this test id: the form's controls keep theirs, whatever labels them. */
function byTestId(id: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`[data-test-id="${id}"]`)
  if (!el) throw new Error(`no [data-test-id="${id}"] on the page`)
  return el
}

/** Opens the edit form of the row with this description. */
async function editRow(description: string): Promise<void> {
  const row = Array.from(
    host.querySelectorAll<HTMLElement>('[data-test-id="transactions-row"]')
  ).find((r) => r.textContent?.includes(description))
  if (!row) throw new Error(`no row "${description}"`)
  row.querySelector<HTMLButtonElement>('button[aria-label="Edit transaction"]')!.click()
  await vi.waitFor(() => {
    expect(byTestId('tx-description').value).toBe(description)
  })
}

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function save(): void {
  byTestId('tx-save-btn').click()
}

async function stored(id: number): Promise<Row> {
  return (await (await getDB()).get('transactions', id)) as Row
}

describe('an edit', () => {
  it('opens with the row’s own exchange rate, so a new amount keeps the rate', async () => {
    await mountPage()
    await editRow('Hotel')

    expect(byTestId('tx-exchange-rate').value).toBe('0.92')

    type(byTestId('tx-amount'), '110')
    save()

    // The local amount moves with the amount at the row's rate: 110 x 0.92.
    await vi.waitFor(async () => {
      expect(await stored(FX)).toMatchObject({
        amount: 110,
        exchange_rate: 0.92,
        amount_local: 101.2,
      })
    })
  })
})
