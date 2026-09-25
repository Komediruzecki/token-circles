/**
 * The recurring list on Transactions follows recurring writes from anywhere, profile switches and
 * resume — and reloads once for its own writes, through the counter they bump.
 *
 * It used to load once per session in onMount. A profile switch left the previous profile's rules
 * on screen, and adding a row to transactions moved its next date on the server while the list
 * kept showing the old one. Its own saves and deletes reloaded it by hand.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import RecurringSection from '../RecurringSection'

let listReads = 0

const RULE = {
  id: 1,
  description: 'Rent',
  amount: 500,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-10-01',
  category_id: null,
  account_id: null,
  transfer_account_id: null,
  notes: null,
}

/** Each write does what apiFetch does for it: bump the counters its URL names. */
const writes = {
  deleteRecurring: vi.fn(async (id: number) => {
    invalidateForRequest(`/api/recurring/${id}`, 'DELETE', true)
  }),
  populateRecurring: vi.fn(async (id: number) => {
    invalidateForRequest(`/api/recurring/${id}/populate`, 'POST', true)
    return { ok: true }
  }),
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    toast: vi.fn(),
    api: {
      getRecurring: async () => {
        listReads += 1
        return [RULE]
      },
      deleteRecurring: (id: number) => writes.deleteRecurring(id),
      populateRecurring: (id: number) => writes.populateRecurring(id),
    },
  }
})

vi.mock('../../core/confirmStore', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, showConfirm: vi.fn(async () => true) }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

beforeEach(() => {
  __resetDataVersionsForTest()
  listReads = 0
  writes.deleteRecurring.mockClear()
  writes.populateRecurring.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

/** The section lives on the Transactions page, and loads only while that page is visible. */
async function mountSection() {
  setPage('transactions')
  dispose = render(() => <RecurringSection categories={[]} accounts={[]} />, host)
  await settle()
  // The rows render in the expanded section.
  host.querySelector<HTMLElement>('[class*="sectionHeader"]')!.click()
  await settle()
}

function button(title: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  expect(found, `no button titled ${title}`).not.toBeNull()
  return found!
}

describe('the recurring list', () => {
  it('reads once on mount', async () => {
    await mountSection()
    expect(listReads).toBe(1)
  })

  it('refetches once when a recurring rule is written elsewhere', async () => {
    await mountSection()
    invalidateEntity('recurring')
    await settle()
    expect(listReads).toBe(2)
  })

  it('refetches once on a profile switch', async () => {
    await mountSection()
    bumpProfileVersion()
    await settle()
    expect(listReads).toBe(2)
  })

  it('refetches once when the app resumes', async () => {
    await mountSection()
    invalidateAllEntities()
    await settle()
    expect(listReads).toBe(2)
  })

  it('defers while Transactions is hidden and refetches once on the next show', async () => {
    await mountSection()
    setPage('dashboard')
    await flush()
    invalidateEntity('recurring')
    invalidateAllEntities()
    await settle()
    expect(listReads).toBe(1)

    setPage('transactions')
    await settle()
    expect(listReads).toBe(2)
  })

  it('reloads once after its own delete', async () => {
    await mountSection()
    button('Delete').click()
    await settle()

    expect(writes.deleteRecurring).toHaveBeenCalledWith(1)
    // Two: the mount and the write's own bump. A third is the old manual reload.
    expect(listReads).toBe(2)
  })

  it('shows the moved next date after adding a row to transactions', async () => {
    await mountSection()
    button('Add to transactions').click()
    await settle()

    expect(writes.populateRecurring).toHaveBeenCalledWith(1)
    // Populating advances the rule's next date on the server; the list has to reload to show it.
    expect(listReads).toBe(2)
  })
})
