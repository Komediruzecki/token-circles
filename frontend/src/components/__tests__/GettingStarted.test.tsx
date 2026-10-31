/**
 * Dashboard's Getting started card: the first three next steps from the profile's own data, each
 * with its reason and a link to its page. It shows while the account has a Getting started record
 * that is not hidden and a step applies; Hide hides it. It works the steps out only while it can
 * show and Dashboard is on screen, once per evaluation, after the page has painted.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAccountStateForTest } from '../../core/accountState'
import { evaluateAchievements } from '../../core/achievements/evaluate'
import { setPage } from '../../core/appStore'
import {
  __resetGettingStartedForTest,
  hideGettingStarted,
  LOCAL_GETTING_STARTED_KEY,
} from '../../core/gettingStarted'
import { workOut } from '../../core/guidance'
import { setOnboardingOwner } from '../../core/onboardingStore'
import { GettingStartedCard } from '../GettingStarted'
import type { AchievementsSnapshot } from '../../core/achievementsStore'
import type { orientationFacts as OrientationFacts } from '../../core/orientation'

const store = vi.hoisted(() => ({ set: null as ((s: unknown) => void) | null }))
const workedOut = vi.hoisted(() => ({ calls: 0 }))

vi.mock('../../core/achievementsStore', async () => {
  const { createRoot, createSignal } = await import('solid-js')
  return createRoot(() => {
    const [snapshot, setSnapshot] = createSignal<unknown>(null)
    store.set = (s) => setSnapshot(() => s)
    return { snapshot }
  })
})

// Counts how often the steps are worked out: each time reads every entry.
vi.mock('../../core/orientation', async (importOriginal) => {
  const real = await importOriginal<{ orientationFacts: typeof OrientationFacts }>()
  return {
    ...real,
    orientationFacts: (...args: Parameters<typeof OrientationFacts>) => {
      workedOut.calls++
      return real.orientationFacts(...args)
    },
  }
})

/** 'YYYY-MM' `n` months before this one. */
function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

type Row = AchievementsSnapshot['transactions'][number]

function row(date: string, over: Partial<Row> = {}): Row {
  return {
    id: 0,
    description: 'CORNER SHOP',
    amount: -20,
    date,
    beneficiary: '',
    payor: '',
    category_id: 1,
    type: 'expense',
    notes: '',
    reconciled: false,
    ...over,
  } as Row
}

/**
 * Four months of entries, the last of them spent more than it earned, and a loan. The shopping
 * comes to a different amount each month: one amount on one day every month is a regular payment,
 * which the subscription scan proposes.
 */
function fourMonths(over: Partial<AchievementsSnapshot> = {}): AchievementsSnapshot {
  const transactions = [4, 3, 2, 1].flatMap((n) => [
    row(`${monthsAgo(n)}-03`, { type: 'income', amount: 100, category_id: 2 }),
    row(`${monthsAgo(n)}-05`, { amount: -(80 + 9 * n), category_id: 1 }),
    row(`${monthsAgo(n)}-09`, { amount: -(60 + 9 * n), category_id: 1 }),
  ])
  return {
    profileId: 1,
    transactions,
    budgets: [],
    goals: [],
    importLogs: [],
    loans: [],
    categories: [
      { id: 1, name: 'Groceries' },
      { id: 2, name: 'Salary' },
    ],
    bills: [],
    accounts: [],
    evaluation: evaluateAchievements({
      transactions,
      budgets: [],
      goals: [],
      importLogs: [],
      loans: [],
      selfHosted: false,
      today,
    }),
    today,
    ...over,
  }
}

/** A savings account holding `balance`, as the accounts list reads it. */
const savings = (balance: number) =>
  [
    { id: 1, name: 'Savings', type: 'savings', currency: 'EUR', balance, profile_id: 1 },
  ] as AchievementsSnapshot['accounts']

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  vi.stubGlobal('fetch', async () => new Response('[]'))
  setOnboardingOwner(null)
  __resetAccountStateForTest()
  __resetGettingStartedForTest()
  setOnboardingOwner('local')
  setPage('dashboard')
  store.set!(null)
  workedOut.calls = 0
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  setOnboardingOwner(null)
  setPage('dashboard')
  vi.unstubAllGlobals()
  localStorage.clear()
})

const card = () => host.querySelector('[data-test-id="getting-started"]')
const steps = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-test-id="next-step"]')).map((step) => ({
    id: step.dataset.step,
    title: step.querySelector('[data-test-id="next-step-link"] span')?.textContent,
    href: step.querySelector('a')?.getAttribute('href'),
    reason: step.querySelector('[data-test-id="next-step-reason"]')?.textContent,
  }))

const mount = () => {
  dispose = render(() => <GettingStartedCard />, host)
}

/** Once the card's pending work has run: it waits for a frame and a task, as this does after it. */
const painted = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

const monthName = (ym: string) =>
  new Date(`${ym}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

describe('with the card on the account', () => {
  beforeEach(() => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: false }))
  })

  it('shows the first three steps, each with its reason and its page', async () => {
    store.set!(fourMonths())
    mount()
    await painted()

    const last = monthsAgo(1)
    expect(steps()).toEqual([
      {
        id: 'import-year',
        title: 'Import the rest of your year',
        href: '#import',
        reason: '4 of the last 13 months are tracked. A month counts once it holds 3 entries.',
      },
      {
        id: 'budget-top-category',
        title: 'Set a budget for Groceries',
        href: '#budgets',
        reason: `You spent more on it in ${monthName(last)} than on any other category with no budget or bill.`,
      },
      {
        id: 'heavy-month',
        title: `See what put ${monthName(last)} in the red`,
        href: `#transactions?period=${last}`,
        reason: `${monthName(last)} spent more than it earned.`,
      },
    ])
  })

  it('follows the data: a step that is done makes way for the next', async () => {
    store.set!(fourMonths())
    mount()
    await painted()
    expect(steps().map((s) => s.id)).not.toContain('loan-payoff')

    // This month's budget for Groceries (an earlier month's has lapsed), and a loan on file.
    store.set!(
      fourMonths({
        budgets: [
          {
            category_id: 1,
            amount: 200,
            period: 'monthly',
            start_date: `${today.slice(0, 7)}-01`,
            end_date: null,
            created_at: `${today.slice(0, 7)}-01`,
          },
        ],
        loans: [
          {
            id: 1,
            name: 'Car loan',
            principal: 1000,
            interest_rate: 5,
            start_date: '2025-01-01',
            term_months: 24,
            rate_periods: [],
            prepayments: [],
          },
        ],
      })
    )
    await painted()
    expect(steps().map((s) => s.id)).toEqual(['import-year', 'heavy-month', 'loan-payoff'])
  })

  it('hides for good', async () => {
    store.set!(fourMonths())
    mount()
    await painted()

    host.querySelector<HTMLButtonElement>('[data-test-id="getting-started-hide"]')!.click()

    expect(card()).toBeNull()
    expect(JSON.parse(localStorage.getItem(LOCAL_GETTING_STARTED_KEY)!)).toEqual({ hidden: true })
  })

  it('shows nothing before the first evaluation, or with nothing left to do', async () => {
    mount()
    await painted()
    expect(card()).toBeNull()

    // A year on file, every entry sorted and budgeted, and a month that earned more than it spent.
    const transactions = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => [
      row(`${monthsAgo(n)}-03`, { type: 'income', amount: 500, category_id: 2 }),
      row(`${monthsAgo(n)}-05`, { amount: -(80 + 9 * n), category_id: 1 }),
      row(`${monthsAgo(n)}-09`, { amount: -(60 + 9 * n), category_id: 1 }),
    ])
    store.set!(
      fourMonths({
        transactions,
        budgets: [
          {
            category_id: 1,
            amount: 200,
            period: 'monthly',
            start_date: `${today.slice(0, 7)}-01`,
            end_date: null,
            created_at: `${today.slice(0, 7)}-01`,
          },
        ],
        evaluation: evaluateAchievements({
          transactions,
          budgets: [],
          goals: [],
          importLogs: [],
          loans: [],
          selfHosted: false,
          today,
        }),
      })
    )
    await painted()
    expect(workedOut.calls).toBe(1)
    expect(card()).toBeNull()
  })

  it('suggests a cushion under a month of what is needed, and drops it at a month', async () => {
    // A year on file, sorted, budgeted, and no month in the red: nothing else to do. Groceries is
    // needed every month: 257 a month on average.
    const transactions = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => [
      row(`${monthsAgo(n)}-03`, { type: 'income', amount: 500, category_id: 2 }),
      row(`${monthsAgo(n)}-05`, { amount: -(80 + 9 * n), category_id: 1 }),
      row(`${monthsAgo(n)}-09`, { amount: -(60 + 9 * n), category_id: 1 }),
    ])
    const settled = (accounts: AchievementsSnapshot['accounts']) =>
      fourMonths({
        transactions,
        budgets: [
          {
            category_id: 1,
            amount: 200,
            period: 'monthly',
            start_date: `${today.slice(0, 7)}-01`,
            end_date: null,
            created_at: `${today.slice(0, 7)}-01`,
          },
        ],
        evaluation: evaluateAchievements({
          transactions,
          budgets: [],
          goals: [],
          importLogs: [],
          loans: [],
          selfHosted: false,
          today,
        }),
        accounts,
      })

    store.set!(settled(savings(200)))
    mount()
    await painted()
    expect(steps()).toEqual([
      {
        id: 'cushion',
        title: 'Build a one-month cushion',
        href: '#goals',
        reason: 'The money you can reach covers 23 days of what you need.',
      },
    ])

    store.set!(settled(savings(257)))
    await painted()
    expect(card()).toBeNull()
  })

  // While less than a year is on file, Dashboard shows this card beside the circles' Your next
  // step, which takes these steps: one scan of the entries per evaluation, not one per reader.
  it('works the facts out once per evaluation, and the circles read the same ones', async () => {
    const inputs = { profileId: 1, answers: {}, withdrawalRatePct: 4, currency: 'EUR', holdings: 0 }
    const first = fourMonths()
    store.set!(first)
    mount()
    await painted()
    expect(workedOut.calls).toBe(1)
    const view = workOut(first, inputs, false)
    expect(workedOut.calls).toBe(1)
    expect(view.next.title).toBe(steps()[0].title)

    // The circles first this time: the card takes what they worked out.
    const second = fourMonths()
    workOut(second, inputs, false)
    expect(workedOut.calls).toBe(2)
    store.set!(second)
    await painted()
    expect(workedOut.calls).toBe(2)
    expect(steps()).toHaveLength(3)
  })

  it('works the steps out once per evaluation, after the page has painted', async () => {
    store.set!(fourMonths())
    mount()
    // Not inside the render: nothing is worked out until the page has painted.
    expect(workedOut.calls).toBe(0)
    await painted()
    expect(workedOut.calls).toBe(1)

    // Two evaluations before the next paint: only the last is worked out.
    store.set!(fourMonths())
    store.set!(fourMonths())
    await painted()
    expect(workedOut.calls).toBe(2)
    expect(steps()).toHaveLength(3)
  })

  it('works nothing out while Dashboard is not the page on screen, and catches up once back', async () => {
    store.set!(fourMonths())
    mount()
    await painted()
    expect(workedOut.calls).toBe(1)

    // Pages stay mounted: a write on Transactions evaluates the badges again, twice here.
    setPage('transactions')
    store.set!(fourMonths())
    store.set!(fourMonths())
    await painted()
    expect(workedOut.calls).toBe(1)

    // Back on Dashboard: once, for the evaluation that is current.
    setPage('dashboard')
    await painted()
    expect(workedOut.calls).toBe(2)

    // An evaluation, and a move to another page before the paint: nothing is worked out.
    store.set!(fourMonths())
    setPage('transactions')
    await painted()
    expect(workedOut.calls).toBe(2)
    setPage('dashboard')
    await painted()
    expect(workedOut.calls).toBe(3)

    // Away and back with nothing new: nothing to work out.
    setPage('budgets')
    setPage('dashboard')
    await painted()
    expect(workedOut.calls).toBe(3)
    expect(card()).not.toBeNull()
  })
})

describe('without the card', () => {
  it('shows nothing for an account that never got one, or hid it', async () => {
    store.set!(fourMonths())
    mount()
    await painted()
    expect(card()).toBeNull()

    dispose?.()
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: true }))
    __resetGettingStartedForTest()
    mount()
    await painted()
    expect(card()).toBeNull()
  })

  // Every account from before the card, and every one that hid it: nobody sees the steps, so
  // nobody pays for them, however often the badges are evaluated.
  it('works nothing out for an account with no card', async () => {
    mount()
    store.set!(fourMonths())
    store.set!(fourMonths())
    await painted()
    expect(card()).toBeNull()
    expect(workedOut.calls).toBe(0)
  })

  it('works nothing out once the card is hidden while it waited for the paint', async () => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: false }))
    store.set!(fourMonths())
    mount()
    hideGettingStarted()
    await painted()
    expect(card()).toBeNull()
    expect(workedOut.calls).toBe(0)
  })

  it('works nothing out for a hidden card', async () => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: true }))
    mount()
    store.set!(fourMonths())
    store.set!(fourMonths())
    await painted()
    expect(card()).toBeNull()
    expect(workedOut.calls).toBe(0)
  })
})
