/**
 * The Bills dialog's category, run against the real local-first router on fake-indexeddb.
 *
 * No bill the dialog saved ever had a category: the options carried each category's name, which
 * the save read as a number, so it sent none. An edit opened on "No category" whatever the bill
 * had, because it read a `category` field neither runtime sends, and choosing "No category" in an
 * edit left the bill's category on.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

async function bills(): Promise<Row[]> {
  return (await (await getDB()).getAll('bills')) as Row[]
}

const rent = async () => (await (await getDB()).get('bills', RENT)) as Row

describe("the Bills dialog's category", () => {
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

  it("opens an edit on the bill's own category, and keeps it when the amount changes", async () => {
    await mountPage()
    await openEdit('Rent')
    expect(field('Category').value).toBe(String(HOUSING))
    type(field('Amount'), '950')

    submit()

    await vi.waitFor(async () => {
      expect(await rent()).toMatchObject({ amount: 950, category_id: HOUSING })
    })
  })

  it('takes the category off when an edit chooses No category', async () => {
    await mountPage()
    await openEdit('Rent')
    type(field('Category'), '')

    submit()

    await vi.waitFor(async () => {
      expect((await rent()).category_id).toBeNull()
    })
  })
})
