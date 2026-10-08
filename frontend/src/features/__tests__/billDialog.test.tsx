/**
 * The Bills dialog, run against the real local-first router on fake-indexeddb.
 *
 * Every refused save said "Failed to save bill" in a toast, with nothing in the dialog marked. And
 * no bill the dialog saved ever had a category: the options carried each category's name, which
 * the save read as a number, so it sent none. An edit opened on "No category" whatever the bill
 * had, because it read a `category` field neither runtime sends.
 *
 * Now the dialog checks the values with the rules both runtimes run (shared/billSchema.ts) and
 * marks the field in its own words, a field the runtime refuses is marked the same way, and the
 * category goes by its id. An edit checks only what it changes, so a bill saved under older rules
 * can still be edited.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BILL_MESSAGES as M } from '../../../../shared/billSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

const RENT = 1
const UTILITIES = 11
const HOUSING = 12

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Bills'), import('../../core/storage/localApiRouter')])
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
  for (const [id, name] of [
    [UTILITIES, 'Utilities'],
    [HOUSING, 'Housing'],
  ] as const) {
    await db.add('categories', {
      id,
      profile_id: 1,
      name,
      type: 'expense',
      color: '#F97316',
    } as never)
  }
  await db.add('bills', bill({ id: RENT, name: 'Rent', amount: 900, category_id: HOUSING }))
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
  setPage('bills')
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

/** A bill as local-first stores one. */
function bill(fields: Row): never {
  return {
    profile_id: 1,
    due_date: '2026-11-01',
    day_of_month: null,
    frequency: 'monthly',
    category_id: null,
    account_id: null,
    notes: '',
    type: 'bill',
    autopay: 0,
    last_paid_date: null,
    next_due_date: null,
    recurring: 1,
    is_active: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...fields,
  } as never
}

async function mountPage(): Promise<void> {
  const { default: Bills } = await import('../Bills')
  dispose = render(() => <Bills />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="bill-card"]').length).toBeGreaterThan(0)
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="bill-modal"]')

async function openAdd(): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-test-id="add-bill-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(name: string): Promise<void> {
  const card = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="bill-card"]')).find(
    (c) => c.querySelector('[data-test-id="bill-name"]')?.textContent?.trim() === name
  )
  if (!card) throw new Error(`no bill "${name}"`)
  card.querySelector<HTMLButtonElement>('[data-test-id="bill-edit-btn"]')!.click()
  await vi.waitFor(() => {
    expect(field('Bill Name').value).toBe(name)
  })
}

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(dialog()!.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field in the dialog`)
  return label.parentElement!.querySelector<HTMLInputElement>('input, select')!
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(): void {
  dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function bills(): Promise<Row[]> {
  return (await (await getDB()).getAll('bills')) as Row[]
}

const rent = async () => (await (await getDB()).get('bills', RENT)) as Row

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('adding a bill', () => {
  it('marks a blank name, a missing amount and a missing date, focuses the name, and sends nothing', async () => {
    await mountPage()
    await openAdd()

    submit()
    await settle()

    expect(field('Bill Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Bill Name'))).toBe(M.name)
    expect(describedBy(field('Amount'))).toBe(M.amount)
    expect(describedBy(field('Due Date'))).toBe(M.dueDate)
    expect(document.activeElement).toBe(field('Bill Name'))
    expect(await bills()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount of zero, and one it cannot read', async () => {
    await mountPage()
    await openAdd()
    type(field('Bill Name'), 'Water')
    type(field('Due Date'), '2026-11-15')
    type(field('Amount'), '0')

    submit()
    await settle()

    expect(describedBy(field('Amount'))).toBe(M.amountPositive)
    expect(document.activeElement).toBe(field('Amount'))

    type(field('Amount'), 'twelve')
    expect(describedBy(field('Amount'))).toBe(M.amountNumber)
    expect(await bills()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('saves the category it was given', async () => {
    await mountPage()
    await openAdd()
    type(field('Bill Name'), 'Power')
    type(field('Amount'), '60')
    type(field('Due Date'), '2026-11-20')
    type(field('Category'), String(UTILITIES))

    submit()

    await vi.waitFor(async () => {
      expect((await bills()).find((b) => b.name === 'Power')).toMatchObject({
        category_id: UTILITIES,
      })
    })
  })

  it('adds a bill with a comma for the cents, says so, and closes', async () => {
    await mountPage()
    await openAdd()
    type(field('Bill Name'), 'Water')
    type(field('Amount'), '42,50')
    type(field('Due Date'), '2026-11-15')

    submit()

    await vi.waitFor(async () => {
      expect((await bills()).find((b) => b.name === 'Water')).toMatchObject({
        amount: 42.5,
        due_date: '2026-11-15',
        frequency: 'monthly',
        type: 'bill',
        category_id: null,
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Water" to your bills.'])
    expect(failureToasts()).toEqual([])
  })

  it("opens empty after an edit, without the edited bill's frequency or autopay", async () => {
    const db = await getDB()
    await db.put('bills', { ...(await rent()), frequency: 'yearly', autopay: 1 })
    await mountPage()
    await openEdit('Rent')
    Array.from(dialog()!.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Cancel')!
      .click()
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })

    await openAdd()

    expect(field('Bill Name').value).toBe('')
    expect(field('Frequency').value).toBe('monthly')
    expect(dialog()!.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('adds a subscription from the Subscriptions tab, and says so', async () => {
    await mountPage()
    host.querySelector<HTMLButtonElement>('[data-test-id="bills-tab-subscriptions"]')!.click()
    await openAdd()
    expect(field('Type').value).toBe('subscription')
    type(field('Bill Name'), 'Music')
    type(field('Amount'), '9.99')
    type(field('Due Date'), '2026-11-03')

    submit()

    await vi.waitFor(async () => {
      expect((await bills()).find((b) => b.name === 'Music')).toMatchObject({
        type: 'subscription',
      })
    })
    expect(successToasts()).toEqual(['Added "Music" to your subscriptions.'])
  })

  it('marks a category deleted while the dialog was open, under the category', async () => {
    await mountPage()
    await openAdd()
    type(field('Bill Name'), 'Power')
    type(field('Amount'), '60')
    type(field('Due Date'), '2026-11-20')
    type(field('Category'), String(UTILITIES))
    // Deleted in another tab: this page still offers it.
    await (await getDB()).delete('categories', UTILITIES)

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('Category'))).toBe(M.category)
    })
    expect(dialog()).not.toBeNull()
    expect(await bills()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })
})

describe('editing a bill', () => {
  it("opens on the bill's own category, and keeps it when the amount changes", async () => {
    await mountPage()
    await openEdit('Rent')
    expect(field('Category').value).toBe(String(HOUSING))
    type(field('Amount'), '950')

    submit()

    await vi.waitFor(async () => {
      expect(await rent()).toMatchObject({ amount: 950, category_id: HOUSING })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to "Rent".'])
  })

  it('keeps a category that is not on the list, an income one set elsewhere', async () => {
    const db = await getDB()
    await db.add('categories', {
      id: 13,
      profile_id: 1,
      name: 'Side income',
      type: 'income',
      color: '#22C55E',
    } as never)
    await db.put('bills', { ...(await rent()), category_id: 13 })
    await mountPage()
    await openEdit('Rent')
    expect(field('Category').value).toBe('13')
    type(field('Amount'), '950')

    submit()

    await vi.waitFor(async () => {
      expect(await rent()).toMatchObject({ amount: 950, category_id: 13 })
    })
  })

  it("names a category it cannot find This bill's category", async () => {
    await (await getDB()).put('bills', { ...(await rent()), category_id: 99 })
    await mountPage()
    await openEdit('Rent')

    const category = field('Category') as unknown as HTMLSelectElement
    expect(category.value).toBe('99')
    expect(category.selectedOptions[0]?.textContent?.trim()).toBe("This bill's category")
  })

  it('takes the category off when No category is chosen', async () => {
    await mountPage()
    await openEdit('Rent')
    type(field('Category'), '')

    submit()

    await vi.waitFor(async () => {
      expect((await rent()).category_id).toBeNull()
    })
  })

  it('marks an amount the edit blanks, and saves nothing', async () => {
    await mountPage()
    await openEdit('Rent')
    type(field('Amount'), '')

    submit()
    await settle()

    expect(describedBy(field('Amount'))).toBe(M.amount)
    expect((await rent()).amount).toBe(900)
    expect(failureToasts()).toEqual([])
  })

  it('saves a bill kept under older rules, checking only what changed', async () => {
    const db = await getDB()
    await db.put('bills', { ...(await rent()), amount: 0, frequency: 'daily' })
    await mountPage()
    await openEdit('Rent')
    type(field('Bill Name'), 'Flat rent')

    submit()

    await vi.waitFor(async () => {
      expect(await rent()).toMatchObject({ name: 'Flat rent', amount: 0, frequency: 'daily' })
    })
    expect(failureToasts()).toEqual([])
  })
})
