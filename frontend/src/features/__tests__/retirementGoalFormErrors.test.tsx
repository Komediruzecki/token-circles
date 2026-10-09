/**
 * The Retirement page's goal dialog, run against the real local-first router on fake-indexeddb.
 *
 * Every refused save said "Failed to save retirement goal" in a toast, whatever was wrong, with
 * nothing in the dialog marked; the browser's own bubbles were the only check, and a goal saved at
 * 0 % was shown, and opened for editing, at 7 %.
 *
 * Now the dialog checks the values with the rules both runtimes run
 * (shared/retirementGoalSchema.ts), marks the field in its own words, and marks a field the
 * runtime refuses the same way. An edit checks only what it changes, so a goal an older version
 * stored under no rules can still be renamed.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { retirementForm } from '../../../../shared/contract/scenarios/retirement'
import { RETIREMENT_GOAL_MESSAGES as M } from '../../../../shared/retirementGoalSchema'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'
import { retirementGoalBody } from '../retirementGoalForm'

// The planner above the goals draws on a canvas jsdom does not have.
vi.mock('../../components/Chart', () => ({ default: () => null }))

const PLAN = 1
const OLD = 2

type Row = Record<string, any>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Retirement'), import('../../core/storage/localApiRouter')])
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
  await db.add('retirement_goals', {
    id: PLAN,
    profile_id: 1,
    name: 'Cash plan',
    target_amount: 300000,
    current_amount: 10000,
    deadline: null,
    notes: '',
    current_age: 40,
    retirement_age: 67,
    monthly_contribution: 400,
    expected_return_rate: 0,
    created_at: '2026-01-02T00:00:00.000Z',
  } as never)
  // Stored under no rules at all: no target, an age of 0, a return of 35 %.
  await db.add('retirement_goals', {
    id: OLD,
    profile_id: 1,
    name: 'Old plan',
    target_amount: 0,
    current_amount: 15000.555,
    deadline: '2050-01-01',
    notes: '',
    current_age: 0,
    retirement_age: 400,
    monthly_contribution: 0,
    expected_return_rate: 35,
    created_at: '2026-01-01T00:00:00.000Z',
  } as never)
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

const byTestId = (id: string, within: ParentNode = host) =>
  within.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const dialog = () => byTestId('retirement-modal')
const cards = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="retirement-goal-card"]'))
const card = (name: string) => cards().find((c) => c.textContent?.includes(name))

async function mountPage(): Promise<void> {
  const { default: Retirement } = await import('../Retirement')
  dispose = render(() => <Retirement />, host)
  await vi.waitFor(() => {
    expect(cards()).toHaveLength(2)
  })
}

async function openAdd(): Promise<void> {
  byTestId('add-retirement-goal-btn')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(name: string): Promise<void> {
  const found = card(name)
  if (!found) throw new Error(`no goal "${name}"`)
  byTestId('retirement-goal-edit-btn', found)!.click()
  await vi.waitFor(() => {
    expect(field('Goal Name').value).toBe(name)
  })
}

/** The control under the label that reads `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(dialog()!.querySelectorAll('label')).find(
    (l) => l.textContent?.trim() === text
  )
  if (!label) throw new Error(`no ${text} field`)
  return document.getElementById(label.getAttribute('for')!) as HTMLInputElement
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

async function goals(): Promise<Row[]> {
  return (await (await getDB()).getAll('retirement_goals')) as Row[]
}
const stored = async (id: number) => (await (await getDB()).get('retirement_goals', id)) as Row

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

function fillNewGoal(): void {
  type(field('Goal Name'), 'Retire early')
  type(field('Target Amount'), '750000')
  type(field('Current Amount'), '42000,50')
  type(field('Current Age'), '38')
  type(field('Retirement Age'), '60')
  type(field('Target Date (optional)'), '2050-01-01')
  type(field('Monthly Contribution'), '1200')
  type(field('Expected Annual Return (%)'), '6,5')
}

describe('adding a retirement goal', () => {
  it('marks every missing field in its own words, focuses the first, and sends nothing', async () => {
    await mountPage()
    await openAdd()

    submit()
    await settle()

    expect(field('Goal Name').getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(field('Goal Name'))).toBe(M.name)
    expect(describedBy(field('Target Amount'))).toBe(M.target)
    expect(describedBy(field('Current Age'))).toBe(M.currentAge)
    expect(describedBy(field('Retirement Age'))).toBe(M.retirementAge)
    expect(describedBy(field('Expected Annual Return (%)'))).toBe(M.returnRate)
    // Blank, these are zero and none.
    expect(field('Current Amount').getAttribute('aria-invalid')).toBeNull()
    expect(field('Monthly Contribution').getAttribute('aria-invalid')).toBeNull()
    expect(field('Target Date (optional)').getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(field('Goal Name'))
    expect(await goals()).toHaveLength(2)
    expect(failureToasts()).toEqual([])
  })

  it('marks an age and a return outside what the page asks for', async () => {
    await mountPage()
    await openAdd()
    fillNewGoal()
    type(field('Current Age'), '17')
    type(field('Expected Annual Return (%)'), '25')

    submit()
    await settle()

    expect(describedBy(field('Current Age'))).toBe(M.currentAge)
    expect(describedBy(field('Expected Annual Return (%)'))).toBe(M.returnRange)
    expect(document.activeElement).toBe(field('Current Age'))
    expect(await goals()).toHaveLength(2)
    expect(failureToasts()).toEqual([])
  })

  it('adds the goal, says so, and closes', async () => {
    await mountPage()
    await openAdd()
    fillNewGoal()

    submit()

    await vi.waitFor(async () => {
      expect((await goals()).find((g) => g.name === 'Retire early')).toMatchObject({
        target_amount: 750000,
        current_amount: 42000.5,
        deadline: '2050-01-01',
        current_age: 38,
        retirement_age: 60,
        monthly_contribution: 1200,
        expected_return_rate: 6.5,
      })
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "Retire early" to your retirement goals.'])
    expect(failureToasts()).toEqual([])
  })
})

describe('a goal on its card', () => {
  it('shows a 0 % return as 0 %, and a goal with no date as having none', async () => {
    await mountPage()
    expect(byTestId('retirement-expected-return', card('Cash plan'))?.textContent).toBe('0%')
    expect(byTestId('retirement-target-date', card('Cash plan'))?.textContent).toBe(
      'No target date'
    )
  })
})

describe('editing a retirement goal', () => {
  it('opens a 0 % goal at 0 %, saves a change, and says so', async () => {
    await mountPage()
    await openEdit('Cash plan')
    expect(field('Expected Annual Return (%)').value).toBe('0')
    type(field('Goal Name'), 'Cash plan at 62')
    type(field('Retirement Age'), '62')

    submit()

    await vi.waitFor(async () => {
      expect(await stored(PLAN)).toMatchObject({
        name: 'Cash plan at 62',
        retirement_age: 62,
        expected_return_rate: 0,
      })
    })
    expect(successToasts()).toEqual(['Saved your changes to "Cash plan at 62".'])
    expect(failureToasts()).toEqual([])
  })

  it('renames a goal stored under no rules, and changes nothing else', async () => {
    await mountPage()
    const before = await stored(OLD)
    await openEdit('Old plan')
    type(field('Goal Name'), 'Sea view')

    submit()

    await vi.waitFor(async () => {
      expect(await stored(OLD)).toEqual({ ...before, name: 'Sea view' })
    })
    expect(failureToasts()).toEqual([])
  })

  it('marks what an edit changes and the rules refuse, under the field', async () => {
    await mountPage()
    await openEdit('Old plan')
    type(field('Target Amount'), '0,5')
    type(field('Current Age'), '120')

    submit()
    await settle()

    expect(describedBy(field('Current Age'))).toBe(M.currentAge)
    // The target changed, and is more than zero: only the age is wrong.
    expect(field('Target Amount').getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(field('Current Age'))
    expect((await stored(OLD)).target_amount).toBe(0)
    expect(failureToasts()).toEqual([])
  })

  it('marks a field the runtime refuses, when another tab changed what the dialog opened on', async () => {
    await mountPage()
    await openEdit('Old plan')
    // Another tab set the age: the dialog still sends back the 0 it opened on, as unchanged.
    const db = await getDB()
    await db.put('retirement_goals', { ...(await stored(OLD)), current_age: 40 } as never)
    type(field('Goal Name'), 'Sea view')

    submit()

    await vi.waitFor(() => {
      expect(describedBy(field('Current Age'))).toBe(M.currentAge)
    })
    expect(dialog()).not.toBeNull()
    expect((await stored(OLD)).name).toBe('Old plan')
    expect(failureToasts()).toEqual([])
  })

  it('says in the notice that a goal another tab deleted is not there', async () => {
    await mountPage()
    await openEdit('Cash plan')
    await (await getDB()).delete('retirement_goals', PLAN)
    type(field('Goal Name'), 'Cash plan at 62')

    submit()

    await vi.waitFor(() => {
      expect(byTestId('retirement-form-notice')?.textContent).toBe('Retirement goal not found')
    })
    expect(failureToasts()).toEqual([])
  })
})

describe('the body the dialog sends', () => {
  it('is the body the contract scenarios send to both runtimes', () => {
    expect(
      retirementGoalBody({
        name: 'Retire at 60',
        target_amount: '750000',
        current_amount: '42000,50',
        deadline: '2050-01-01',
        monthly_contribution: '1200',
        expected_return_rate: '6.5',
        current_age: '38',
        retirement_age: '60',
      })
    ).toEqual(retirementForm())
  })
})
