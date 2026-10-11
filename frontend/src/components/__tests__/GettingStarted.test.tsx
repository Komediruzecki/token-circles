/**
 * Dashboard's Getting started card: the first three next steps from the profile's own data, each
 * with its reason and a link to its page. It shows while the account has a Getting started record
 * that is not hidden and a step applies; Hide hides it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetAccountStateForTest } from '../../core/accountState'
import { evaluateAchievements } from '../../core/achievements/evaluate'
import { __resetGettingStartedForTest, LOCAL_GETTING_STARTED_KEY } from '../../core/gettingStarted'
import { setOnboardingOwner } from '../../core/onboardingStore'
import { GettingStartedCard } from '../GettingStarted'
import type { AchievementsSnapshot } from '../../core/achievementsStore'

const store = vi.hoisted(() => ({ set: null as ((s: unknown) => void) | null }))

vi.mock('../../core/achievementsStore', async () => {
  const { createRoot, createSignal } = await import('solid-js')
  return createRoot(() => {
    const [snapshot, setSnapshot] = createSignal<unknown>(null)
    store.set = (s) => setSnapshot(() => s)
    return { snapshot }
  })
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

/** Four months of entries, the last of them spent more than it earned, and a loan. */
function fourMonths(over: Partial<AchievementsSnapshot> = {}): AchievementsSnapshot {
  const transactions = [4, 3, 2, 1].flatMap((n) => [
    row(`${monthsAgo(n)}-03`, { type: 'income', amount: 100, category_id: 2 }),
    row(`${monthsAgo(n)}-05`, { amount: -80, category_id: 1 }),
    row(`${monthsAgo(n)}-09`, { amount: -60, category_id: 1 }),
  ])
  return {
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
  store.set!(null)
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  setOnboardingOwner(null)
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

const monthName = (ym: string) =>
  new Date(`${ym}-15T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })

describe('with the card on the account', () => {
  beforeEach(() => {
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: false }))
  })

  it('shows the first three steps, each with its reason and its page', () => {
    store.set!(fourMonths())
    mount()

    const last = monthsAgo(1)
    expect(steps()).toEqual([
      {
        id: 'import-year',
        title: 'Import the rest of your year',
        href: '#import',
        reason:
          'You have 4 tracked months from the past year. A month counts once it holds 3 entries.',
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

  it('follows the data: a step that is done makes way for the next', () => {
    store.set!(fourMonths())
    mount()
    expect(steps().map((s) => s.id)).not.toContain('loan-payoff')

    // A budget for Groceries, and a loan on file.
    store.set!(
      fourMonths({
        budgets: [
          {
            category_id: 1,
            amount: 200,
            period: 'monthly',
            start_date: '2020-01-01',
            end_date: null,
            created_at: '2020-01-01',
          },
        ],
        loans: [
          {
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
    expect(steps().map((s) => s.id)).toEqual(['import-year', 'heavy-month', 'loan-payoff'])
  })

  it('hides for good', () => {
    store.set!(fourMonths())
    mount()

    host.querySelector<HTMLButtonElement>('[data-test-id="getting-started-hide"]')!.click()

    expect(card()).toBeNull()
    expect(JSON.parse(localStorage.getItem(LOCAL_GETTING_STARTED_KEY)!)).toEqual({ hidden: true })
  })

  it('shows nothing before the first evaluation, or with nothing left to do', () => {
    mount()
    expect(card()).toBeNull()

    // A year on file, every entry sorted and budgeted, and a month that earned more than it spent.
    const transactions = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((n) => [
      row(`${monthsAgo(n)}-03`, { type: 'income', amount: 500, category_id: 2 }),
      row(`${monthsAgo(n)}-05`, { amount: -80, category_id: 1 }),
      row(`${monthsAgo(n)}-09`, { amount: -60, category_id: 1 }),
    ])
    store.set!(
      fourMonths({
        transactions,
        budgets: [
          {
            category_id: 1,
            amount: 200,
            period: 'monthly',
            start_date: '2020-01-01',
            end_date: null,
            created_at: '2020-01-01',
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
    expect(card()).toBeNull()
  })
})

describe('without the card', () => {
  it('shows nothing for an account that never got one, or hid it', () => {
    store.set!(fourMonths())
    mount()
    expect(card()).toBeNull()

    dispose?.()
    localStorage.setItem(LOCAL_GETTING_STARTED_KEY, JSON.stringify({ hidden: true }))
    __resetGettingStartedForTest()
    mount()
    expect(card()).toBeNull()
  })
})
