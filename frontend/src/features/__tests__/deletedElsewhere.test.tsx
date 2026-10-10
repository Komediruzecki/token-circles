/**
 * Deleting a housing expense, a holding or a tag that another tab or device deleted first. Both
 * runtimes answer 404, and gone is what was asked: the page says so, as information, and drops the
 * row, as Goals, Bills, Budgets and Categories do (#612) and the recurring list does. Each said
 * the runtime's "not found" as an error, and kept the row on screen.
 *
 * Housing and Portfolio list every selected profile's rows in the household view, and a delete
 * goes to the open profile, so another profile's row answers 404 too. That one is still there when
 * the list is read again, so it is not said to be deleted.
 *
 * The pages run against the real local-first router on fake-indexeddb, and a row is deleted
 * behind the page's back, as another tab does.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { defaultPeriod } from '../../utils/period'
import type { Component } from 'solid-js'

vi.mock('../../components/Chart', () => ({ default: () => null }))

type Page = 'housing' | 'portfolio' | 'tags'

const MODULES: Record<Page, string> = {
  housing: '../Housing',
  portfolio: '../Portfolio',
  tags: '../Tags',
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Paid here, not inside the first test's waitFor: the pages and the router are heavy imports.
  await Promise.all([
    ...Object.values(MODULES).map((module) => import(/* @vite-ignore */ module)),
    import('../../core/storage/localApiRouter'),
  ])
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
  for (const toast of toasts()) removeToast(toast.id)
  for (const request of confirmRequests()) resolveConfirm(request.id, false)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
  setPeriod(defaultPeriod())
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
  // Portfolio asks with the browser's own confirm.
  vi.stubGlobal('confirm', () => true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  setPeriod(defaultPeriod())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A second profile, selected beside the first: the household view. */
async function household(): Promise<void> {
  await (
    await getDB()
  ).add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  localStorage.setItem('selectedProfileIds', '[1,2]')
}

async function mount(page: Page, ready: () => boolean): Promise<void> {
  setPage(page)
  const { default: Page } = (await import(/* @vite-ignore */ MODULES[page])) as {
    default: Component
  }
  dispose = render(() => <Page />, host)
  await vi.waitFor(() => {
    expect(ready()).toBe(true)
  })
}

async function click(find: () => HTMLElement | null | undefined): Promise<void> {
  let el: HTMLElement | null | undefined
  await vi.waitFor(() => {
    el = find()
    expect(el).toBeTruthy()
  })
  el!.click()
}

/** Says yes to the confirmation the action asks for. */
async function confirm(): Promise<void> {
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  resolveConfirm(confirmRequests()[0]!.id, true)
}

/** The page said `message` as information, and said nothing else. */
async function toldOnly(message: string): Promise<void> {
  await vi.waitFor(() => {
    expect(toasts().map((t) => [t.type, t.message])).toEqual([['info', message]])
  })
}

/** The page said one thing, as an error, and nothing as information. */
async function failedOnce(): Promise<void> {
  await vi.waitFor(() => {
    expect(toasts().map((t) => t.type)).toEqual(['error'])
  })
}

describe('Housing, deleting an expense already deleted', () => {
  async function seed(profileId: number): Promise<number> {
    return (await (
      await getDB()
    ).add('housings', {
      profile_id: profileId,
      name: 'Flat 5',
      type: 'rent',
      monthly_amount: 850,
      due_date: '01-15',
      autopay: 0,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
    } as never)) as number
  }
  const cards = () => host.querySelectorAll('[data-test-id="housing-card"]').length
  const deleteFirst = async () => {
    await click(() =>
      host.querySelector<HTMLButtonElement>('[data-test-id="housing-card-delete"] button')
    )
    await confirm()
  }

  it('says it was already deleted, and drops it', async () => {
    const id = await seed(1)
    await mount('housing', () => cards() === 1)
    await (await getDB()).delete('housings', id)

    await deleteFirst()

    await toldOnly('That housing expense was already deleted.')
    await vi.waitFor(() => {
      expect(cards()).toBe(0)
    })
  })

  it("does not say another profile's expense, which the household view lists, was deleted", async () => {
    await household()
    await seed(2)
    await mount('housing', () => cards() === 1)

    await deleteFirst()

    await failedOnce()
    expect(cards()).toBe(1)
  })
})

describe('Portfolio, deleting a holding already deleted', () => {
  async function seed(profileId: number): Promise<number> {
    return (await (
      await getDB()
    ).add('portfolioHoldings', {
      profile_id: profileId,
      ticker: 'EXMPL',
      shares: 10,
      purchase_price: 100,
      purchase_date: '2026-02-10',
      notes: '',
      created_at: '2026-02-10T09:00:00.000Z',
    } as never)) as number
  }
  const rows = () => host.querySelectorAll('[data-test-id="portfolio-holding-row"]').length
  const deleteFirst = () =>
    click(() =>
      host.querySelector<HTMLButtonElement>(
        '[data-test-id="portfolio-holding-row"] button[title="Delete"]'
      )
    )

  it('says it was already deleted, and drops it', async () => {
    const id = await seed(1)
    await mount('portfolio', () => rows() === 1)
    await (await getDB()).delete('portfolioHoldings', id)

    await deleteFirst()

    await toldOnly('That holding was already deleted.')
    await vi.waitFor(() => {
      expect(rows()).toBe(0)
    })
  })

  it("does not say another profile's holding, which the household view lists, was deleted", async () => {
    await household()
    await seed(2)
    await mount('portfolio', () => rows() === 1)

    await deleteFirst()

    await failedOnce()
    expect(rows()).toBe(1)
  })
})

describe('Tags, deleting a tag already deleted', () => {
  const TRIP = 1

  it('says it was already deleted, and drops it', async () => {
    await (await getDB()).add('tags', { id: TRIP, profile_id: 1, name: 'Trip', color: '#22aa66' })
    const card = () => host.querySelector(`[data-test-id="tag-card-${String(TRIP)}"]`)
    await mount('tags', () => card() !== null)
    await (await getDB()).delete('tags', TRIP)

    await click(() =>
      Array.from(card()?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent?.trim() === 'Delete'
      )
    )
    await confirm()

    await toldOnly('That tag was already deleted.')
    await vi.waitFor(() => {
      expect(card()).toBeNull()
    })
  })
})
