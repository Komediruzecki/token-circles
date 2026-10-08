/**
 * What the Bills page's cards say about when each bill is due, run against the real local-first
 * router on fake-indexeddb.
 *
 * The cards read due_date, the first date a bill was saved with, which never moves. A monthly bill
 * saved in August said "49 days overdue" in October and was drawn as overdue, and once paid it
 * still showed its August date. Both runtimes answer next_due_date (shared/billSchedule.ts); the
 * cards say that one.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import styles from '../BillsPage.module.css'

const UTILITIES = 11

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Bills'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 8, 12))
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  await db.add('categories', {
    id: UTILITIES,
    profile_id: 1,
    name: 'Utilities',
    type: 'expense',
    color: '#F97316',
  } as never)
  // Saved in August, unpaid: due on the 20th of every month.
  await db.add('bills', bill({ id: 1, name: 'Power', due_date: '2026-08-20' }))
  // Due on the 5th, paid on the 3rd: paid up for October.
  await db.add(
    'bills',
    bill({ id: 2, name: 'Water', due_date: '2026-09-05', last_paid_date: '2026-10-03' })
  )
  // Its day passed unpaid.
  await db.add('bills', bill({ id: 3, name: 'Phone', due_date: '2026-09-02' }))

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A monthly bill as local-first stores one. */
function bill(fields: Record<string, unknown>): never {
  return {
    profile_id: 1,
    amount: 60,
    day_of_month: null,
    frequency: 'monthly',
    category_id: UTILITIES,
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
    expect(host.querySelectorAll('[data-test-id="bill-name"]').length).toBe(3)
  })
}

function card(name: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="bill-name"]')).find(
    (h) => h.firstChild?.textContent?.trim() === name
  )
  if (!found) throw new Error(`no bill "${name}"`)
  let el: HTMLElement | null = found
  while (el && !el.classList.contains(styles.billCard)) el = el.parentElement
  if (!el) throw new Error(`no card holds "${name}"`)
  return el
}

const details = (name: string) =>
  card(name).querySelector('[data-test-id="bill-details"]')!.textContent!.replace(/\s+/g, ' ')

describe('the bill cards', () => {
  it('say when an unpaid bill falls due this month, not the date it was first due', async () => {
    await mountPage()

    expect(details('Power')).toBe('Oct 20, 2026 • Due in 12 days • Monthly')
    expect(card('Power').classList.contains(styles.overdue)).toBe(false)
  })

  it('call an unpaid bill whose day has passed overdue, by that day', async () => {
    await mountPage()

    expect(details('Phone')).toBe('Oct 2, 2026 • 6 days overdue • Monthly')
    expect(card('Phone').classList.contains(styles.overdue)).toBe(true)
  })

  it('say when a paid bill is next due, and its category', async () => {
    await mountPage()

    expect(card('Water').closest('[data-test-id="bills-paid-section"]')).not.toBeNull()
    expect(details('Water')).toBe('Next due Nov 5, 2026 • Monthly • Utilities')
  })
})
