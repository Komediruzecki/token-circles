/**
 * The retirement planner's save, run against the real local-first router on fake-indexeddb.
 *
 * A save used to send whatever was on screen and have it moved into range without a word: a
 * withdrawal rate of 0 % was saved as 0.1 %, a lifestyle costing nothing was dropped, and a
 * spending period ending before it started lost its end. A save that failed was a toast that said
 * only that it failed.
 *
 * Now the panel checks the plan with the rules both runtimes run (shared/retirementPlanSchema.ts)
 * and marks the field in its own words, a row's under the field of its row, and a field the runtime
 * refuses is marked the same way. A plan an older version stored opens, and saves with only what
 * was changed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RETIREMENT_PLAN_MESSAGES as M } from '../../../../shared/retirementPlanSchema'
import { normalizeSettings } from '../../../../shared/retirementSettings'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

// The chart draws on a canvas jsdom does not have.
vi.mock('../../components/Chart', () => ({ default: () => null }))

/**
 * Set by a test to change the body on its way to the router: what a client that did not run the
 * page's own check would send. Null sends what the page sends.
 */
const tamper = vi.hoisted(() => ({
  body: null as null | ((body: Record<string, any>) => Record<string, any>),
}))

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<{
    apiPut: (path: string, body: unknown) => Promise<unknown>
  }>()
  return {
    ...original,
    apiPut: (path: string, body: Record<string, any>) =>
      original.apiPut(path, tamper.body ? tamper.body(body) : body),
  }
})

const KEY = 'retirement_settings:1'

/** What an older version stored: nothing today's rules would take. */
const OLD_PLAN = {
  mode: 'advanced',
  lifeExpectancyAge: 300,
  annualInflationPct: -4,
  netWorth: 'lots',
  expensePeriods: [{ fromMonth: '2030-05', toMonth: '2030-01', monthlyAmount: 300 }],
  lifestyles: [
    { id: 'old', label: '', monthlySpendToday: 0 },
    { id: 'cosy', label: 'Cosy', monthlySpendToday: 1800.555 },
  ],
}

type Plan = Record<string, any>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../RetirementPlanner'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  tamper.body = null
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

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('retirement')
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

const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const input = (id: string) => byTestId(id) as HTMLInputElement
const saveButton = () => byTestId('retirement-save-settings') as HTMLButtonElement
const notice = () => byTestId('retirement-assumptions-notice')!

/** The `index`th control in a list row, by the name its row field gives it. */
const inRow = (label: string, index = 0) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`))[index]!

async function mountPlanner(): Promise<void> {
  const { default: RetirementPlanner } = await import('../RetirementPlanner')
  dispose = render(() => <RetirementPlanner />, host)
  await vi.waitFor(() => {
    expect(byTestId('retirement-assumptions')).not.toBeNull()
  })
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** A month picker is a month select and a year select. */
function pickMonth(picker: HTMLElement, value: string): void {
  const [month, year] = Array.from(picker.querySelectorAll('select'))
  const [y, m] = value.split('-')
  year.value = y
  year.dispatchEvent(new Event('change', { bubbles: true }))
  month.value = String(Number(m))
  month.dispatchEvent(new Event('change', { bubbles: true }))
}

function submit(): void {
  saveButton().click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function storedPlan(): Promise<Plan | undefined> {
  const row = await (await getDB()).get('settings', KEY)
  return (row as { value: Plan } | undefined)?.value
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('a save the rules refuse', () => {
  it('marks a value outside its range in its own words, focuses it, and saves nothing', async () => {
    await mountPlanner()
    type(input('retirement-input-swr'), '0')

    submit()
    await settle()

    const swr = input('retirement-input-swr')
    expect(swr.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(swr)).toBe(M.safeWithdrawalRatePct)
    expect(document.activeElement).toBe(swr)
    expect(await storedPlan()).toBeUndefined()
    expect(failureToasts()).toEqual([])
    expect(notice().textContent).toBe('')
  })

  it('lets the mark go as soon as the field is fixed', async () => {
    await mountPlanner()
    type(input('retirement-input-swr'), '25')
    submit()
    await settle()
    expect(describedBy(input('retirement-input-swr'))).toBe(M.safeWithdrawalRatePct)

    type(input('retirement-input-swr'), '4.5')

    expect(input('retirement-input-swr').hasAttribute('aria-invalid')).toBe(false)
    expect(describedBy(input('retirement-input-swr'))).toBe('')
  })

  it('marks a lifestyle costing nothing under its own row, and the mark follows the row', async () => {
    await mountPlanner()
    byTestId('retirement-add-lifestyle')!.click()
    await settle()
    type(inRow("Monthly spending in today's money", 1) as HTMLInputElement, '0')

    submit()
    await settle()

    const spend = inRow("Monthly spending in today's money", 1)
    expect(spend.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(spend)).toBe(M.lifestyleSpend)
    expect(document.activeElement).toBe(spend)
    expect(inRow("Monthly spending in today's money", 0).hasAttribute('aria-invalid')).toBe(false)

    // The first lifestyle goes; the one costing nothing is the first row now, and so is its mark.
    ;(inRow('Remove lifestyle', 0) as HTMLButtonElement).click()
    await settle()
    expect(inRow("Monthly spending in today's money", 0).getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(inRow("Monthly spending in today's money", 0))).toBe(M.lifestyleSpend)
    expect(await storedPlan()).toBeUndefined()
  })

  it('marks a spending period that ends before it starts, at its end', async () => {
    await mountPlanner()
    byTestId('retirement-mode-advanced')!.click()
    await settle()
    byTestId('retirement-add-period')!.click()
    await settle()
    pickMonth(inRow('Spending period start'), '2031-06')
    pickMonth(inRow('Spending period end'), '2031-01')

    submit()
    await settle()

    const [endMonth, endYear] = Array.from(
      inRow('Spending period end').querySelectorAll<HTMLSelectElement>('select')
    )
    for (const select of [endMonth, endYear]) {
      expect(select.getAttribute('aria-invalid')).toBe('true')
      expect(describedBy(select)).toBe(M.periodEnd)
    }
    expect(document.activeElement).toBe(endMonth)
    expect(await storedPlan()).toBeUndefined()
  })

  it('says a value the panel does not show in the notice, beside the button', async () => {
    await mountPlanner()
    byTestId('retirement-mode-advanced')!.click()
    await settle()
    type(input('retirement-input-income'), '-100')
    byTestId('retirement-mode-simple')!.click()
    await settle()

    submit()
    await settle()

    expect(notice().textContent).toBe(M.monthlyIncome)
    expect(await storedPlan()).toBeUndefined()
  })
})

describe('a save the runtime refuses', () => {
  it('marks the field it names, though the page would have caught it first', async () => {
    tamper.body = (body) => ({
      ...body,
      lifestyles: [{ ...body.lifestyles[0], monthlySpendToday: 0 }],
    })
    await mountPlanner()
    type(input('retirement-input-networth'), '30000')

    submit()

    await vi.waitFor(() => {
      expect(inRow("Monthly spending in today's money").getAttribute('aria-invalid')).toBe('true')
    })
    expect(describedBy(inRow("Monthly spending in today's money"))).toBe(M.lifestyleSpend)
    expect(document.activeElement).toBe(inRow("Monthly spending in today's money"))
    expect(await storedPlan()).toBeUndefined()
    expect(failureToasts()).toEqual([])
    expect(successToasts()).toEqual([])
  })

  it('says a failure with no words for a person beside the button, with no toast', async () => {
    tamper.body = () => {
      throw new TypeError('Failed to fetch')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await mountPlanner()
    type(input('retirement-input-networth'), '30000')

    submit()

    await vi.waitFor(() => {
      expect(notice().textContent).toBe("Couldn't save your retirement assumptions. Try again.")
    })
    expect(failureToasts()).toEqual([])
    expect(saveButton().getAttribute('aria-disabled')).toBeNull()
  })
})

describe('a save that passes', () => {
  it('saves the plan, says so, and the button says it is saved', async () => {
    await mountPlanner()
    type(input('retirement-input-networth'), '30000')
    type(input('retirement-input-contribution'), '1500.50')

    submit()

    await vi.waitFor(async () => {
      expect(await storedPlan()).toMatchObject({ netWorth: 30000, monthlyContribution: 1500.5 })
    })
    await vi.waitFor(() => {
      expect(saveButton().textContent).toBe('Saved')
    })
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(successToasts()).toEqual(['Saved your retirement assumptions.'])
    expect(failureToasts()).toEqual([])
  })

  it('opens what an older version stored, and saves it with only the change', async () => {
    await (await getDB()).put('settings', { key: KEY, value: OLD_PLAN })
    await mountPlanner()
    // What the panel opens on is what normalizeSettings reads the old plan as: a life
    // expectancy of 120, inflation at 0 %, the lifestyle costing nothing gone, and the spending
    // period with no end.
    const opened = normalizeSettings(OLD_PLAN)
    expect(input('retirement-input-life').value).toBe('120')
    expect(input('retirement-input-inflation').value).toBe('0')
    expect((inRow('Lifestyle name') as HTMLInputElement).value).toBe('Cosy')
    expect(host.querySelectorAll('[aria-label="Lifestyle name"]')).toHaveLength(1)
    expect(opened.expensePeriods).toEqual([{ fromMonth: '2030-05', monthlyAmount: 300 }])

    type(input('retirement-input-networth'), '12000')
    submit()

    await vi.waitFor(async () => {
      expect(await storedPlan()).toEqual({ ...opened, netWorth: 12000 })
    })
    expect(successToasts()).toEqual(['Saved your retirement assumptions.'])
    expect(failureToasts()).toEqual([])
  })
})
