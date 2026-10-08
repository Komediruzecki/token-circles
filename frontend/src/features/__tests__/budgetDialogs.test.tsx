/**
 * The dialogs that set a category's budget for a month, run against the real local-first router on
 * fake-indexeddb: the Budgets page's Allocate, its Set Budget on a category card, and the Set
 * Budget on a Categories page card.
 *
 * Allocate sent no month, so a budget allocated while another month was on screen was set on this
 * month instead, where the page did not show it. Both Set Budget dialogs added a budget on every
 * save (POST /api/budgets), so a category set twice had two budgets that month, and the Budgets
 * page's set this month's whatever month was on screen.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { defaultPeriod, monthPeriod } from '../../utils/period'
import type { JSX } from 'solid-js'

vi.mock('../../components/Chart', () => ({ default: () => null }))

const GROCERIES = 1

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([
    import('../Budgets'),
    import('../Categories'),
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
  await db.add('categories', {
    id: GROCERIES,
    profile_id: 1,
    name: 'Groceries',
    type: 'expense',
    color: '#59d2a2',
    icon: 'cart',
    parent_id: null,
    tax_deductible: false,
  } as never)
  for (const toast of toasts()) removeToast(toast.id)

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

async function mount(page: 'budgets' | 'categories', Page: () => JSX.Element): Promise<void> {
  setPage(page)
  dispose = render(() => <Page />, host)
  await vi.waitFor(() => {
    expect(host.textContent).toContain('Groceries')
  })
}

async function mountBudgets(): Promise<void> {
  const { default: Budgets } = await import('../Budgets')
  await mount('budgets', Budgets)
  await vi.waitFor(() => {
    expect(
      host.querySelector<HTMLButtonElement>('[data-test-id="budgets-add-allocation-btn"]')?.disabled
    ).toBe(false)
  })
}

/** January next year: never the month it is now. */
function anotherMonth(): { period: ReturnType<typeof monthPeriod>; start: string } {
  const year = new Date().getFullYear() + 1
  return { period: monthPeriod(year, 0), start: `${year}-01-01` }
}

const byText = (root: ParentNode, text: string): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text
  )
  if (!button) throw new Error(`no button reads ${text}`)
  return button
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const allocateDialog = () =>
  host.querySelector<HTMLElement>('[data-test-id="budgets-allocate-modal"]')

async function openAllocate(): Promise<HTMLElement> {
  host.querySelector<HTMLButtonElement>('[data-test-id="budgets-add-allocation-btn"]')!.click()
  await vi.waitFor(() => {
    expect(allocateDialog()).not.toBeNull()
  })
  return allocateDialog()!
}

async function budgets(): Promise<Row[]> {
  return (await (await getDB()).getAll('budgets')) as Row[]
}

describe('Allocate', () => {
  it('sets the budget of the month on screen', async () => {
    const other = anotherMonth()
    setPeriod(other.period)
    await mountBudgets()
    const dialog = await openAllocate()
    type(dialog.querySelector('input')!, '250')

    byText(dialog, 'Allocate').click()

    await vi.waitFor(async () => {
      expect(await budgets()).toEqual([
        expect.objectContaining({ category_id: GROCERIES, amount: 250, start_date: other.start }),
      ])
    })
  })
})

/** This month's first day, as the runtimes write a budget's start. */
function thisMonthStart(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

async function setBudgetOn(open: () => void, amount: string): Promise<void> {
  open()
  let input: HTMLInputElement | null = null
  await vi.waitFor(() => {
    input = host.querySelector<HTMLInputElement>('input[placeholder="500.00"]')
    expect(input).not.toBeNull()
  })
  type(input!, amount)
  byText(host, 'Save Budget').click()
  await vi.waitFor(() => {
    expect(host.querySelector('input[placeholder="500.00"]')).toBeNull()
  })
}

describe('Set Budget on a Budgets page card', () => {
  const openSetBudget = () => {
    host
      .querySelector<HTMLButtonElement>(
        '[data-test-id="budgets-category-actions"] button[title="Set Budget"]'
      )!
      .click()
  }

  it("changes the month's budget instead of adding one", async () => {
    await mountBudgets()

    await setBudgetOn(openSetBudget, '250')
    await setBudgetOn(openSetBudget, '300')

    await vi.waitFor(async () => {
      expect(await budgets()).toEqual([
        expect.objectContaining({
          category_id: GROCERIES,
          amount: 300,
          start_date: thisMonthStart(),
        }),
      ])
    })
  })

  it('sets the budget of the month on screen', async () => {
    const other = anotherMonth()
    setPeriod(other.period)
    await mountBudgets()

    await setBudgetOn(openSetBudget, '250')

    await vi.waitFor(async () => {
      expect(await budgets()).toEqual([
        expect.objectContaining({ category_id: GROCERIES, amount: 250, start_date: other.start }),
      ])
    })
  })
})

describe('Set Budget on a Categories page card', () => {
  it("changes this month's budget instead of adding one", async () => {
    const { default: Categories } = await import('../Categories')
    await mount('categories', Categories)
    const openSetBudget = () => {
      byText(host, 'Budget').click()
    }

    await setBudgetOn(openSetBudget, '250')
    await setBudgetOn(openSetBudget, '300')

    await vi.waitFor(async () => {
      expect(await budgets()).toEqual([
        expect.objectContaining({
          category_id: GROCERIES,
          amount: 300,
          start_date: thisMonthStart(),
        }),
      ])
    })
  })
})
