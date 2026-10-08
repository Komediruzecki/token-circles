/**
 * The Goals dialog and a goal's "Add Funds" form, run against the real local-first router on
 * fake-indexeddb.
 *
 * Every refused save said "Failed to save goal" or "Failed to add contribution" in a toast, with
 * nothing in the dialog marked, and an amount the form could not read was "Please enter a valid
 * positive amount" in a toast too. A category deleted while the dialog was open was the same
 * toast, with no word about which field.
 *
 * Now both forms check the values with the rules both runtimes run (shared/goalSchema.ts) and mark
 * the field in its own words, and a field the runtime refuses is marked the same way. An edit
 * checks only what it changes, so a goal saved under older rules can still be edited.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GOAL_MESSAGES as M } from '../../../../shared/goalSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

vi.mock('../../components/Chart', () => ({ default: () => null }))

const HOLIDAY = 1
const SAVINGS = 7
const LONG_NAME = 'Round the world '.repeat(8).trim()

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Goals'), import('../../core/storage/localApiRouter')])
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
    id: SAVINGS,
    profile_id: 1,
    name: 'Savings',
    type: 'expense',
    color: '#22C55E',
  } as never)
  await db.add('goals', {
    id: HOLIDAY,
    profile_id: 1,
    name: 'Holiday',
    target_amount: 1000,
    current_amount: 100,
    deadline: '2027-06-01',
    category_id: null,
    monthly_contribution: 0,
    tracking_start_date: null,
    notes: '',
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)
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
  setPage('goals')
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
  const { default: Goals } = await import('../Goals')
  dispose = render(() => <Goals />, host)
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-test-id="goal-card"]').length).toBeGreaterThan(0)
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="goals-modal"]')

async function openAdd(): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-test-id="add-goal-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

function card(name: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="goal-card"]')).find(
    (c) => c.querySelector('[data-test-id="goal-name"]')?.textContent === name
  )
  if (!found) throw new Error(`no goal "${name}"`)
  return found
}

async function openEdit(name: string): Promise<void> {
  card(name).querySelector<HTMLButtonElement>('[data-test-id="goal-edit-btn"]')!.click()
  await vi.waitFor(() => {
    expect(field('Goal Name').value).toBe(name)
  })
}

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string, within: HTMLElement = dialog()!): HTMLInputElement {
  const label = Array.from(within.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<HTMLInputElement>('input, select')!
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(within: HTMLElement = dialog()!): void {
  within.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function goals(): Promise<Row[]> {
  return (await (await getDB()).getAll('goals')) as Row[]
}

const holiday = async () => (await (await getDB()).get('goals', HOLIDAY)) as Row

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

describe('adding a goal', () => {
  it('marks a blank name and a missing target in their own words, focuses the name, and sends nothing', async () => {
    await mountPage()
    await openAdd()

    submit()
    await settle()

    expect(field('Goal Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Goal Name'))).toBe(M.name)
    expect(describedBy(field('Target Amount'))).toBe(M.target)
    expect(document.activeElement).toBe(field('Goal Name'))
    expect(await goals()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('marks a target of zero and a monthly amount it cannot read, under each', async () => {
    await mountPage()
    await openAdd()
    type(field('Goal Name'), 'New bike')
    type(field('Target Amount'), '0')
    type(field('Monthly Contribution'), 'lots')

    submit()
    await settle()

    expect(describedBy(field('Target Amount'))).toBe(M.targetPositive)
    expect(describedBy(field('Monthly Contribution'))).toBe(M.monthly)
    expect(document.activeElement).toBe(field('Target Amount'))
    expect(await goals()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })

  it('takes the mark away once the field is fixed', async () => {
    await mountPage()
    await openAdd()
    submit()
    await settle()

    type(field('Goal Name'), 'New bike')

    expect(field('Goal Name').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(field('Target Amount'))).toBe(M.target)
  })

  it('adds a goal with a comma for the cents, says so, and closes', async () => {
    await mountPage()
    await openAdd()
    type(field('Goal Name'), 'New bike')
    type(field('Target Amount'), '1250,50')
    type(field('Target Date'), '2027-03-01')

    submit()

    await vi.waitFor(async () => {
      expect((await goals()).find((g) => g.name === 'New bike')).toMatchObject({
        target_amount: 1250.5,
        current_amount: 0,
        deadline: '2027-03-01',
        category_id: null,
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "New bike" to your goals.'])
    expect(failureToasts()).toEqual([])
  })

  it('marks a category deleted while the dialog was open, under the category', async () => {
    await mountPage()
    await openAdd()
    type(field('Goal Name'), 'Rainy day')
    type(field('Target Amount'), '500')
    type(field('Linked Category'), String(SAVINGS))
    // Deleted in another tab: this page still offers it.
    await (await getDB()).delete('categories', SAVINGS)

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('Linked Category'))).toContain(M.category)
    })
    expect(field('Linked Category').getAttribute('aria-invalid')).toBe('true')
    expect(dialog()).not.toBeNull()
    expect(await goals()).toHaveLength(1)
    expect(failureToasts()).toEqual([])
  })
})

describe('editing a goal', () => {
  it('forgets the goal it edited once closed by its backdrop', async () => {
    await mountPage()
    await openEdit('Holiday')
    dialog()!.click()
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })

    await openAdd()

    expect(host.querySelector('[data-test-id="goals-modal-title"]')?.textContent).toBe('New Goal')
    expect(field('Goal Name').value).toBe('')
    expect(field('Target Amount').value).toBe('')
  })

  it('saves a new name and target, keeps the date, and names it in the toast', async () => {
    await mountPage()
    await openEdit('Holiday')
    type(field('Goal Name'), 'Summer holiday')
    type(field('Target Amount'), '1500')

    submit()

    await vi.waitFor(async () => {
      expect(await holiday()).toMatchObject({
        name: 'Summer holiday',
        target_amount: 1500,
        current_amount: 100,
        deadline: '2027-06-01',
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to "Summer holiday".'])
  })

  it('marks a target the edit blanks, and saves nothing', async () => {
    await mountPage()
    await openEdit('Holiday')
    type(field('Target Amount'), ' ')

    submit()
    await settle()

    expect(describedBy(field('Target Amount'))).toBe(M.target)
    expect(document.activeElement).toBe(field('Target Amount'))
    expect((await holiday()).target_amount).toBe(1000)
    expect(failureToasts()).toEqual([])
  })

  it('saves a goal kept under older rules, checking only what changed', async () => {
    const db = await getDB()
    await db.put('goals', { ...(await holiday()), name: LONG_NAME, target_amount: 0 })
    await mountPage()
    await openEdit(LONG_NAME)
    type(field('Target Date'), '2028-01-31')

    submit()

    await vi.waitFor(async () => {
      expect(await holiday()).toMatchObject({
        name: LONG_NAME,
        target_amount: 0,
        deadline: '2028-01-31',
      })
    })
    expect(failureToasts()).toEqual([])
  })
})

describe('adding money to a goal', () => {
  async function openFunds(name: string): Promise<HTMLElement> {
    card(name).querySelector<HTMLButtonElement>('[data-test-id="goal-contribute-btn"]')!.click()
    await vi.waitFor(() => {
      expect(card(name).querySelector('[data-test-id="goal-contribute-form"]')).not.toBeNull()
    })
    return card(name).querySelector<HTMLElement>('[data-test-id="goal-contribute-form"]')!
  }

  it('marks an amount it cannot read, under the amount, and sends nothing', async () => {
    await mountPage()
    const form = await openFunds('Holiday')
    type(field('Amount to add', form), 'abc')

    submit(form)
    await settle()

    expect(describedBy(field('Amount to add', form))).toBe(M.contributionNumber)
    expect(document.activeElement).toBe(field('Amount to add', form))
    expect((await holiday()).current_amount).toBe(100)
    expect(failureToasts()).toEqual([])
  })

  it('marks an amount of zero', async () => {
    await mountPage()
    const form = await openFunds('Holiday')
    type(field('Amount to add', form), '0')

    submit(form)
    await settle()

    expect(describedBy(field('Amount to add', form))).toBe(M.contributionPositive)
    expect((await holiday()).current_amount).toBe(100)
  })

  it('adds the amount to the cent, says how much and to which goal, and closes', async () => {
    await mountPage()
    const form = await openFunds('Holiday')
    type(field('Amount to add', form), '49,99')

    submit(form)

    await vi.waitFor(async () => {
      expect(await holiday()).toMatchObject({ current_amount: 149.99 })
    })
    await vi.waitFor(() => {
      expect(card('Holiday').querySelector('[data-test-id="goal-contribute-form"]')).toBeNull()
    })
    expect(successToasts()).toEqual(['Added €49.99 to "Holiday".'])
    expect(failureToasts()).toEqual([])
  })

  it('says so in the form when the goal was deleted while it was open', async () => {
    await mountPage()
    const form = await openFunds('Holiday')
    type(field('Amount to add', form), '10')
    await (await getDB()).delete('goals', HOLIDAY)

    submit(form)

    await vi.waitFor(() => {
      expect(form.querySelector('[role="alert"]')?.textContent).toBe('Goal not found')
    })
    expect(failureToasts()).toEqual([])
  })
})
