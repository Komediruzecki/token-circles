/**
 * The Transactions form, run against the real local-first router on fake-indexeddb.
 *
 * The form people use most. These drive it as a person does, through the page, and read what the
 * router stored: the router runs the same rules as the Worker (shared/transactionSchema.ts), so
 * what it stores is what a save means in either mode.
 *
 * It answered a bad entry with a warning toast ("Please enter a positive amount") and a refused
 * save with an error toast in the server's words, with nothing in the form marked. Now each
 * problem is said under its field, focus goes to the first, and nothing is sent until they are
 * fixed. A refusal the form could not see coming (a category deleted in another tab) lands under
 * its field the same way. A Cash account that could not be created says so under the account
 * field, where its button is.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRANSACTION_MESSAGES as M } from '../../../../shared/transactionSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { TRANSACTION_FORM_MESSAGES as F } from '../transactionForm'

const EVERYDAY = 1
const SAVINGS = 2
const GROCERIES = 11
const SALARY = 12
const PLAIN = 41 // an expense with its notes, beneficiary and payor filled in
const FX = 42 // 100 USD, 92 in the base currency, at 0.92
const CENTS = 43 // an amount with three decimals, from an import
const TRIP = 61 // a tag

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
  await row({ id: CENTS, description: 'Imported fuel', amount: 12.345, amount_local: 12.345 })
  await db.add('tags', { id: TRIP, profile_id: 1, name: 'Trip', color: '#f97316' } as never)
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

  it('saves a note, a beneficiary and a payor the person cleared', async () => {
    await mountPage()
    await editRow('Weekly groceries')

    type(byTestId('tx-notes'), '')
    type(byTestId('tx-beneficiary'), '')
    type(byTestId('tx-payor'), '')
    save()

    await vi.waitFor(async () => {
      expect(await stored(PLAIN)).toMatchObject({ notes: '', beneficiary: '', payor: '' })
    })
    expect(await stored(PLAIN)).toMatchObject({ description: 'Weekly groceries', amount: 82.4 })
  })
})

async function openAddForm(): Promise<void> {
  byTestId('add-transaction-btn').click()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="tx-modal"]')?.className).toMatch(/show/)
  })
}

const modalOpen = () =>
  /show/.test(host.querySelector('[data-test-id="tx-modal"]')?.className ?? '')

function choose(el: HTMLInputElement, value: string, event: 'input' | 'change' = 'input'): void {
  el.value = value
  el.dispatchEvent(new Event(event, { bubbles: true }))
}

/** The words under a control, error first: what a screen reader says after its name. */
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

/** The account field's own element: the select, or the group in its place with no accounts. */
const accountControl = (): HTMLElement =>
  host.querySelector<HTMLElement>('[data-test-id="tx-account"]') ??
  host
    .querySelector<HTMLElement>('[data-test-id="tx-create-cash-account"]')!
    .closest('[role="group"]')!

const flush = () => new Promise((resolve) => setTimeout(resolve, 50))

async function count(): Promise<number> {
  return (await (await getDB()).getAll('transactions')).length
}

async function storedBy(description: string): Promise<Row | undefined> {
  const rows = (await (await getDB()).getAll('transactions')) as Row[]
  return rows.find((r) => r.description === description)
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

/** Fills in a whole expense the rules take. */
function fillExpense(description = 'Market run', amount = '23.50'): void {
  type(byTestId('tx-description'), description)
  type(byTestId('tx-amount'), amount)
  choose(byTestId('tx-category'), String(GROCERIES), 'change')
  choose(byTestId('tx-account'), String(EVERYDAY))
}

describe('a new entry the form refuses', () => {
  it('marks every field that is wrong, focuses the first, and sends nothing', async () => {
    await mountPage()
    await openAddForm()
    choose(byTestId('tx-account'), '')
    const before = await count()

    save()
    await flush()

    expect(byTestId('tx-description').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(byTestId('tx-description'))).toBe(F.description)
    expect(describedBy(byTestId('tx-amount'))).toBe(M.amount)
    expect(describedBy(byTestId('tx-category'))).toBe(F.category)
    expect(describedBy(byTestId('tx-account'))).toBe(F.accountExpense)
    expect(document.activeElement).toBe(byTestId('tx-description'))
    expect(await count()).toBe(before)
    expect(failureToasts()).toEqual([])
    expect(modalOpen()).toBe(true)
  })

  it.each([
    ['an amount of zero', '0', M.amountPositive],
    ['a negative amount', '-5', M.amountPositive],
    ['an amount with three decimals', '12.345', M.amountCents],
  ])('says what is wrong with %s, under the amount', async (_, amount, message) => {
    await mountPage()
    await openAddForm()
    fillExpense('Market run', amount)

    save()
    await flush()

    expect(describedBy(byTestId('tx-amount'))).toBe(message)
    expect(document.activeElement).toBe(byTestId('tx-amount'))
    expect(await storedBy('Market run')).toBeUndefined()
  })

  it('asks for the date it happened', async () => {
    await mountPage()
    await openAddForm()
    fillExpense()
    type(byTestId('tx-date'), '')

    save()
    await flush()

    expect(describedBy(byTestId('tx-date'))).toBe(F.date)
    expect(await storedBy('Market run')).toBeUndefined()
  })

  it('asks for the account the money went into, for income', async () => {
    await mountPage()
    await openAddForm()
    byTestId('tx-type-income').click()
    type(byTestId('tx-description'), 'Salary')
    type(byTestId('tx-amount'), '2500')
    choose(byTestId('tx-category'), String(SALARY), 'change')
    choose(byTestId('tx-account'), '')

    save()
    await flush()

    expect(describedBy(byTestId('tx-account'))).toBe(F.accountIncome)
    expect(document.activeElement).toBe(byTestId('tx-account'))
  })

  it('asks a transfer for both accounts, and for two different ones', async () => {
    await mountPage()
    await openAddForm()
    byTestId('tx-type-transfer').click()
    type(byTestId('tx-description'), 'To savings')
    type(byTestId('tx-amount'), '50')
    choose(byTestId('tx-account'), '')

    save()
    await flush()

    expect(describedBy(byTestId('tx-transfer-account'))).toBe(M.transferTo)
    expect(describedBy(byTestId('tx-account'))).toBe(M.transferFrom)
    expect(document.activeElement).toBe(byTestId('tx-transfer-account'))

    choose(byTestId('tx-account'), String(EVERYDAY))
    choose(byTestId('tx-transfer-account'), String(EVERYDAY))
    save()
    await flush()

    expect(describedBy(byTestId('tx-transfer-account'))).toBe(M.transferSame)
    expect(byTestId('tx-account').getAttribute('aria-invalid')).toBeNull()
    expect(await storedBy('To savings')).toBeUndefined()
    expect(failureToasts()).toEqual([])
  })

  it('lets a message go as soon as its field is fixed', async () => {
    await mountPage()
    await openAddForm()
    save()
    await flush()

    type(byTestId('tx-description'), 'M')

    expect(byTestId('tx-description').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(byTestId('tx-amount'))).toBe(M.amount)
  })
})

describe('a save', () => {
  it('adds an expense with a tag, says so, and closes', async () => {
    await mountPage()
    await openAddForm()
    fillExpense()
    byTestId('tx-advanced-toggle').click()
    await vi.waitFor(() => {
      expect(host.querySelector('button[aria-label="Add tag Trip"]')).not.toBeNull()
    })
    host.querySelector<HTMLButtonElement>('button[aria-label="Add tag Trip"]')!.click()

    save()

    await vi.waitFor(async () => {
      expect(await storedBy('Market run')).toMatchObject({
        type: 'expense',
        amount: 23.5,
        category_id: GROCERIES,
        account_id: EVERYDAY,
        tag_ids: [TRIP],
      })
    })
    await vi.waitFor(() => {
      expect(modalOpen()).toBe(false)
    })
    expect(successToasts()).toEqual(['Added "Market run" to your transactions.'])
    expect(failureToasts()).toEqual([])
  })

  it('adds a transfer between two accounts, and moves both balances', async () => {
    await mountPage()
    await openAddForm()
    byTestId('tx-type-transfer').click()
    type(byTestId('tx-description'), 'To savings')
    type(byTestId('tx-amount'), '50')
    choose(byTestId('tx-account'), String(EVERYDAY))
    choose(byTestId('tx-transfer-account'), String(SAVINGS))

    save()

    await vi.waitFor(async () => {
      expect(await storedBy('To savings')).toMatchObject({
        type: 'transfer',
        account_id: EVERYDAY,
        transfer_account_id: SAVINGS,
        category_id: null,
      })
    })
    const db = await getDB()
    expect(((await db.get('accounts', EVERYDAY)) as { balance: number }).balance).toBeCloseTo(950)
    expect(((await db.get('accounts', SAVINGS)) as { balance: number }).balance).toBeCloseTo(550)
    expect(successToasts()).toEqual(['Added "To savings" to your transactions.'])
  })

  it('saves an edit, and names it in the toast', async () => {
    await mountPage()
    await editRow('Weekly groceries')
    type(byTestId('tx-description'), 'Groceries, week 40')

    save()

    await vi.waitFor(async () => {
      expect(await stored(PLAIN)).toMatchObject({ description: 'Groceries, week 40', amount: 82.4 })
    })
    await vi.waitFor(() => {
      expect(modalOpen()).toBe(false)
    })
    expect(successToasts()).toEqual(['Saved your changes to "Groceries, week 40".'])
  })

  it('saves a description change to a row an import stored with three decimals', async () => {
    await mountPage()
    await editRow('Imported fuel')
    type(byTestId('tx-description'), 'Fuel')

    save()

    await vi.waitFor(async () => {
      expect(await stored(CENTS)).toMatchObject({ description: 'Fuel', amount: 12.345 })
    })
    expect(failureToasts()).toEqual([])
  })

  it('puts a refusal it could not see coming under its field, and keeps the dialog open', async () => {
    await mountPage()
    await openAddForm()
    fillExpense()
    // Deleted in another tab after the list was read: only the router can know.
    await (await getDB()).delete('categories', GROCERIES)

    save()

    await vi.waitFor(() => {
      expect(byTestId('tx-category').getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(byTestId('tx-category'))).toBe(M.category)
    expect(document.activeElement).toBe(byTestId('tx-category'))
    expect(await storedBy('Market run')).toBeUndefined()
    expect(modalOpen()).toBe(true)
    expect(failureToasts()).toEqual([])
  })
})

describe('the Cash account', () => {
  beforeEach(async () => {
    const db = await getDB()
    await db.clear('accounts')
  })

  it('is created from the account field and chosen for the entry', async () => {
    await mountPage()
    await openAddForm()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="tx-create-cash-account"]')).not.toBeNull()
    })

    byTestId('tx-create-cash-account').click()

    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="tx-account"]')).not.toBeNull()
    })
    const accounts = (await (await getDB()).getAll('accounts')) as { id: number; name: string }[]
    expect(accounts.map((a) => a.name)).toEqual(['Cash'])
    await vi.waitFor(() => {
      expect(byTestId('tx-account').value).toBe(String(accounts[0].id))
    })
    expect(failureToasts()).toEqual([])
  })

  it('says why it could not be created, under the account field', async () => {
    // The base currency is USD and this browser asks for EUR: the router refuses with a 409.
    await (await getDB()).put('settings', { key: 'currency', value: 'USD' })
    await mountPage()
    await openAddForm()
    await vi.waitFor(() => {
      expect(host.querySelector('[data-test-id="tx-create-cash-account"]')).not.toBeNull()
    })

    byTestId('tx-create-cash-account').click()

    const conflict =
      'Account balances use USD. Change the base currency in Settings before adding financial data.'
    await vi.waitFor(() => {
      expect(describedBy(accountControl())).toBe(conflict)
    })
    expect(accountControl().getAttribute('aria-invalid')).toBe('true')
    expect(await (await getDB()).getAll('accounts')).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})
