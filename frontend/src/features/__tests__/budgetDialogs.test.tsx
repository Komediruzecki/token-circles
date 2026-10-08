/**
 * The dialogs that set a category's budget for a month, run against the real local-first router on
 * fake-indexeddb: the Budgets page's Allocate, its Set Budget on a category card, and the Set
 * Budget on a Categories page card.
 *
 * Allocate sent no month, so a budget allocated while another month was on screen was set on this
 * month instead, where the page did not show it. Both Set Budget dialogs added a budget on every
 * save (POST /api/budgets), so a category set twice had two budgets that month, and the Budgets
 * page's set this month's whatever month was on screen.
 *
 * Each refused save said "Failed to allocate budget" or "Failed to set budget" in a toast, with
 * nothing in the dialog marked. Now each checks the amount with the rules both runtimes run
 * (shared/budgetSchema.ts) and marks the field in its own words. The rollover switch, which has no
 * dialog, says why in the toast.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUDGET_MESSAGES as M } from '../../../../shared/budgetSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { defaultPeriod, localMonth, monthPeriod } from '../../utils/period'
import { monthName } from '../budgetForm'
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

/** The control under the label that starts with `text`, as a person finds it. */
function field(root: HTMLElement, text: string): HTMLInputElement {
  const label = Array.from(root.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<HTMLInputElement>('input, select')!
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

/** A budget for Groceries this month, as allocating stores one. */
async function budgetThisMonth(amount: number): Promise<number> {
  return (await (
    await getDB()
  ).add('budgets', {
    profile_id: 1,
    category_id: GROCERIES,
    amount,
    period: 'monthly',
    start_date: thisMonthStart(),
    end_date: null,
    rollover_enabled: false,
    rollover_amount: 0,
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)) as number
}

describe('Allocate, when the amount is wrong', () => {
  it('marks an amount it cannot read, under the amount, focuses it, and sends nothing', async () => {
    await mountBudgets()
    const dialog = await openAllocate()
    type(field(dialog, 'Amount'), 'lots')

    byText(dialog, 'Allocate').click()
    await settle()

    expect(field(dialog, 'Amount').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field(dialog, 'Amount'))).toContain(M.amountNumber)
    expect(document.activeElement).toBe(field(dialog, 'Amount'))
    expect(await budgets()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount below zero', async () => {
    await mountBudgets()
    const dialog = await openAllocate()
    type(field(dialog, 'Amount'), '-5')

    byText(dialog, 'Allocate').click()
    await settle()

    expect(describedBy(field(dialog, 'Amount'))).toContain(M.amountNegative)
    expect(await budgets()).toEqual([])
  })

  it('says what it set, for which month, and closes', async () => {
    await mountBudgets()
    const dialog = await openAllocate()
    type(field(dialog, 'Amount'), '250,50')

    byText(dialog, 'Allocate').click()

    await vi.waitFor(() => {
      expect(allocateDialog()).toBeNull()
    })
    expect(await budgets()).toEqual([expect.objectContaining({ amount: 250.5 })])
    expect(successToasts()).toEqual([
      `Set the Groceries budget for ${monthName(localMonth())} to €250.50.`,
    ])
    expect(failureToasts()).toEqual([])
  })

  it('marks a category deleted while the dialog was open, under the category', async () => {
    await mountBudgets()
    const dialog = await openAllocate()
    type(field(dialog, 'Amount'), '250')
    await (await getDB()).delete('categories', GROCERIES)

    byText(dialog, 'Allocate').click()

    await vi.waitFor(() => {
      expect(describedBy(field(dialog, 'Category'))).toBe(M.category)
    })
    expect(allocateDialog()).not.toBeNull()
    expect(await budgets()).toEqual([])
    expect(failureToasts()).toEqual([])
  })
})

describe('Set Budget, when the amount is wrong', () => {
  const amountInput = () => host.querySelector<HTMLInputElement>('input[placeholder="500.00"]')

  it("opens on the Budgets page with the month's budget, and marks an amount it cannot read", async () => {
    await budgetThisMonth(250)
    await mountBudgets()
    host
      .querySelector<HTMLButtonElement>(
        '[data-test-id="budgets-category-actions"] button[title="Set Budget"]'
      )!
      .click()
    await vi.waitFor(() => {
      expect(amountInput()?.value).toBe('250')
    })
    type(amountInput()!, 'abc')

    byText(host, 'Save Budget').click()
    await settle()

    expect(describedBy(amountInput()!)).toBe(M.amountNumber)
    expect(document.activeElement).toBe(amountInput())
    expect(await budgets()).toEqual([expect.objectContaining({ amount: 250 })])
    expect(failureToasts()).toEqual([])
  })

  it("opens on the Categories page with this month's budget, marks a wrong amount, then says what it set", async () => {
    await budgetThisMonth(250)
    const { default: Categories } = await import('../Categories')
    await mount('categories', Categories)
    byText(host, 'Budget').click()
    await vi.waitFor(() => {
      expect(amountInput()?.value).toBe('250')
    })
    type(amountInput()!, '-1')

    byText(host, 'Save Budget').click()
    await settle()

    expect(describedBy(amountInput()!)).toBe(M.amountNegative)
    expect(failureToasts()).toEqual([])

    type(amountInput()!, '320')
    byText(host, 'Save Budget').click()

    await vi.waitFor(() => {
      expect(amountInput()).toBeNull()
    })
    expect(await budgets()).toEqual([expect.objectContaining({ amount: 320 })])
    expect(successToasts()).toEqual([
      `Set the Groceries budget for ${monthName(localMonth())} to €320.00.`,
    ])
  })
})

// The app stored budgets like this: local-first's backfill summed 0.1, 0.2 and 0.3 to
// 0.6000000000000001, and older rows and MCP clients can carry the same. The dialogs opened on
// that text, and the cents rule refused it, so a budget nobody touched could not be saved.
describe('a budget stored with a float error', () => {
  const NOISY = 0.1 + 0.2 + 0.3

  it('opens Change on the amount to the cent, and saves it as it is', async () => {
    await budgetThisMonth(NOISY)
    await mountBudgets()
    byText(host, 'Change').click()
    await vi.waitFor(() => {
      expect(allocateDialog()).not.toBeNull()
    })
    expect(field(allocateDialog()!, 'Amount').value).toBe('0.6')

    byText(allocateDialog()!, 'Allocate').click()

    await vi.waitFor(() => {
      expect(allocateDialog()).toBeNull()
    })
    expect(await budgets()).toEqual([expect.objectContaining({ amount: 0.6 })])
    expect(successToasts()).toEqual([
      `Set the Groceries budget for ${monthName(localMonth())} to €0.60.`,
    ])
    expect(failureToasts()).toEqual([])
  })

  it('opens Set Budget on the amount to the cent, and saves it as it is', async () => {
    const amountInput = () => host.querySelector<HTMLInputElement>('input[placeholder="500.00"]')
    await budgetThisMonth(NOISY)
    await mountBudgets()
    host
      .querySelector<HTMLButtonElement>(
        '[data-test-id="budgets-category-actions"] button[title="Set Budget"]'
      )!
      .click()
    await vi.waitFor(() => {
      expect(amountInput()).not.toBeNull()
    })
    expect(amountInput()!.value).toBe('0.6')

    byText(host, 'Save Budget').click()

    await vi.waitFor(() => {
      expect(amountInput()).toBeNull()
    })
    expect(await budgets()).toEqual([expect.objectContaining({ amount: 0.6 })])
    expect(failureToasts()).toEqual([])
  })
})

describe('the rollover switch', () => {
  it("says why it could not change, in the runtime's words", async () => {
    const id = await budgetThisMonth(250)
    await mountBudgets()
    let toggle: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      toggle = host.querySelector<HTMLButtonElement>('button[title="Enable rollover"]')
      expect(toggle).not.toBeNull()
    })
    // Deleted in another tab.
    await (await getDB()).delete('budgets', id)

    toggle!.click()

    await vi.waitFor(() => {
      expect(failureToasts()).toEqual(['Budget not found'])
    })
  })
})
