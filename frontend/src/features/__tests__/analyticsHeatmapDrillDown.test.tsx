/**
 * A day on the spending heatmap opens the transactions of that day.
 *
 * The drill-down read the list from `transactions` or `rows` of the answer. That is the Worker's
 * envelope; local-first answers /api/transactions with a bare array, so every day said "No expense
 * transactions for this day", however much was spent on it.
 *
 * This runs the real page against the real local-first router on fake-indexeddb.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'

// The heatmap shows the current year.
const YEAR = new Date().getFullYear()
const DAY = `${YEAR}-03-10`

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  // Heavy imports, paid once here rather than inside the test's own waits.
  await Promise.all([import('../Analytics'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'Groceries',
    type: 'expense',
    color: '#59d2a2',
    icon: 'tag',
    parent_id: null,
  } as never)
  const row = (id: number, values: Record<string, unknown>) =>
    db.add('transactions', {
      id,
      profile_id: 1,
      type: 'expense',
      currency: 'EUR',
      exchange_rate: 1,
      category_id: 1,
      account_id: null,
      notes: '',
      created_at: `${YEAR}-01-01T09:00:00.000Z`,
      ...values,
    } as never)
  await row(1, { description: 'Market stall', amount: 12.5, amount_local: 12.5, date: DAY })
  await row(2, { description: 'Bakery', amount: 4, amount_local: 4, date: DAY })
  await row(3, {
    description: 'Hardware shop',
    amount: 30,
    amount_local: 30,
    date: `${YEAR}-03-11`,
  })
  await row(4, { description: 'Refund', amount: 9, amount_local: 9, date: DAY, type: 'income' })
  // The other profile's spending that day.
  await db.add('profiles', { id: 2, name: 'Partner', created_at: '2026-01-01T00:00:00.000Z' })
  await row(5, {
    profile_id: 2,
    category_id: null,
    description: 'Their market',
    amount: 100,
    amount_local: 100,
    date: DAY,
  })

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
  // The heatmap re-renders on resize; jsdom has no ResizeObserver.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

/** Opens Analytics and clicks 10 March on the heatmap. */
async function clickTheTenthOfMarch() {
  setPage('analytics')
  const { default: Analytics } = await import('../Analytics')
  dispose = render(() => <Analytics />, host)

  // d3 loads on the heatmap's first render; the cells appear once it has.
  const cell = await vi.waitFor(
    () => {
      const found = [...host.querySelectorAll('rect.cell')].find((el) => {
        const day = (el as unknown as { __data__?: Date }).__data__
        return day?.getMonth() === 2 && day.getDate() === 10
      })
      expect(found, 'no cell for 10 March').toBeDefined()
      return found!
    },
    { timeout: 10_000 }
  )
  cell.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('the spending heatmap in local-first', () => {
  it('lists the expenses of the day that was clicked', async () => {
    await clickTheTenthOfMarch()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Market stall')
    })
    expect(document.body.textContent).toContain('Bakery')
    expect(document.body.textContent).not.toContain('No expense transactions for this day')
    // Only that day, only its expenses, and only this profile's.
    expect(document.body.textContent).not.toContain('Hardware shop')
    expect(document.body.textContent).not.toContain('Refund')
    expect(document.body.textContent).not.toContain('Their market')
  })

  // The heatmap sums the profiles selected in the household; the day's list reads the same ones.
  it('lists both profiles of the household when both are selected', async () => {
    localStorage.setItem('selectedProfileIds', JSON.stringify([1, 2]))
    await clickTheTenthOfMarch()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Their market')
    })
    expect(document.body.textContent).toContain('Market stall')
    expect(document.body.textContent).toContain('Bakery')
  })

  it("lists the other profile's alone when it is the one in use", async () => {
    localStorage.setItem('currentProfileId', '2')
    localStorage.setItem('selectedProfileIds', JSON.stringify([2]))
    await clickTheTenthOfMarch()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Their market')
    })
    expect(document.body.textContent).not.toContain('Market stall')
    expect(document.body.textContent).not.toContain('Bakery')
  })
})
