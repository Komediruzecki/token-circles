/**
 * The Loans page shows what the schedule says is owed today, and the payment actually due.
 *
 * It used to work out its own figures: the remaining balance was the principal minus one whole
 * installment for every 30 days since the start, ignoring interest, extra payments and rate
 * changes, and the installment was the annuity at the loan's base rate whatever the rate periods
 * said. 100,000 at 5 % over 120 months, 60 payments in, showed 36,360.69 remaining and 64 % paid,
 * where the schedule owes 56,204.87 and 44 % of the principal is repaid. Progress, the summary
 * card and both charts all read that figure.
 *
 * The list now carries remaining_balance and monthly_payment from the shared engine, in both
 * storage modes, and the page shows them. A server that predates the fields gets the same engine
 * run on the page instead.
 *
 * Three more figures were never worked out at all. Next Payment read "Not set" on every loan,
 * because nothing set the date. The amount beside the progress bar read "0.00 paid" next to
 * "44% paid", because it was hard-coded to 0. And every loan was Active, paid off or not. The page
 * now shows the principal repaid, and an end line that follows what is still owed: "Done in" or
 * "Paid off in". The next payment's date moves to the loan's own page with the relayout (plan 03).
 * The zone is pinned west of UTC, where a due date formatted in the local zone reads a day early.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loanStatus } from '../../../../shared/loanSchedule'
import { formatCurrency } from '../../core/api'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'

process.env.TZ = 'America/New_York'

let listed: unknown[] = []

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    // The loan's own read, which the loan's page makes when the list row has no rate periods.
    apiGet: vi.fn(async (path: string) => {
      const id = Number(path.split('/').pop())
      const loan = (listed as { id: number }[]).find((l) => l.id === id)
      return { rate_periods: [], prepayments: [], ...loan }
    }),
    apiHouseholdGet: vi.fn(async () => listed),
    apiPost: vi.fn(async () => ({ ok: true })),
    apiPut: vi.fn(async () => ({ ok: true })),
    apiDelete: vi.fn(async () => ({ ok: true })),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy({}, { get: () => async () => [] }),
  }
})

// 100,000 at 5 % over 120 months from 2021-01-01, seen on 2025-12-15: sixty payments are due.
// A = P r (1+r)^n / ((1+r)^n - 1) = 1,060.66; B_60 = P (1+r)^60 - A ((1+r)^60 - 1) / r = 56,204.87.
const r = 0.05 / 12
const A = (100000 * r * (1 + r) ** 120) / ((1 + r) ** 120 - 1)
const B60 = 100000 * (1 + r) ** 60 - (A * ((1 + r) ** 60 - 1)) / r
const LOAN = {
  id: 1,
  name: 'Mortgage',
  principal: 100000,
  interest_rate: 5,
  term_months: 120,
  start_date: '2021-01-01',
  profile_id: 1,
  created_at: '2021-01-01 00:00:00',
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((res) => setTimeout(res, 0))
}

beforeAll(async () => {
  await import('../Loans')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  // Only Date is faked: Solid and the page's loaders need real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2025-12-15T12:00:00Z'))
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
  history.replaceState(null, '', '#')
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount(hash = '#loans'): Promise<HTMLDivElement> {
  history.replaceState(null, '', hash)
  setPage('loans')
  const { default: Loans } = await import('../Loans')
  dispose = render(() => <Loans />, host)
  await settle()
  return host
}

const text = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-test-id="${id}"]`)?.textContent ?? ''

/** Every element with the test id, in page order: one per loan card. */
const texts = (root: HTMLElement, id: string) =>
  [...root.querySelectorAll(`[data-test-id="${id}"]`)].map((el) => el.textContent ?? '')

/** The summary card whose label is `label`. */
const summary = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('[data-test-id="loans-summary-card"]')].find((c) =>
    c.textContent?.startsWith(label)
  )?.textContent ?? ''

/** The example loan as the list returns it on 2025-12-15, its figures worked out. */
const LISTED = {
  ...LOAN,
  remaining_balance: B60,
  monthly_payment: A,
  next_payment_date: '2026-01-01',
  payoff_date: '2030-12-01',
}

describe('Loans page figures', () => {
  it('runs west of UTC', () => {
    expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
  })

  it('shows the remaining balance, payment and progress the list worked out', async () => {
    listed = [LISTED]
    const root = await mount()
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(B60))
    expect(formatCurrency(B60)).toBe(formatCurrency(56204.87))
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(A))
    // (100,000 - 56,204.87) / 100,000 = 43.8 %.
    expect(text(root, 'loans-item-progress-percent')).toBe('44% repaid')
    expect(summary(root, 'Owed in total')).toBe(`Owed in total${formatCurrency(B60)}`)
  })

  it('shows the next payment after a rate change, not the base-rate annuity', async () => {
    // 8 % from month 13: the payment due next is the recomputed one, 1,198.93.
    const terms = { ...LOAN, rate_periods: [{ rate: 8, start_month: 13, end_month: null }] }
    const status = loanStatus(terms, '2025-12-15')
    listed = [{ ...terms, ...status }]
    const root = await mount()
    expect(status.monthly_payment).toBeCloseTo(1198.93, 2)
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(status.monthly_payment))
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(status.remaining_balance))
  })

  it('runs the shared engine itself when the list does not carry the figures', async () => {
    // A server from before the fields: a row with only what is stored, plus the rate periods and
    // extra payments local-first rows carry.
    const terms = {
      ...LOAN,
      rate_periods: [{ rate: 8, start_month: 13, end_month: null }],
      prepayments: [{ month: 12, amount: 10000 }],
    }
    listed = [terms]
    const expected = loanStatus(terms, '2025-12-15')
    const root = await mount()
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(expected.remaining_balance))
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(expected.monthly_payment))
    expect(expected.next_payment_date).toBe('2026-01-01')
  })

  it('says when a loan was paid off, and that one with no start date has no due dates', async () => {
    // Neither row carries the figures, so the page runs the engine: one loan ended in 2019, the
    // other was saved without a start date.
    listed = [
      { ...LOAN, id: 1, start_date: '2010-01-01' },
      { ...LOAN, id: 2, start_date: '' },
    ]
    const root = await mount()
    expect(texts(root, 'loans-item-payoff')).toEqual([
      'Paid off in December 2019',
      'No due dates: the start date cannot be read',
    ])
  })

  it('shows the principal repaid beside the progress bar, what the percentage measures', async () => {
    // 100,000 - 56,204.87 = 43,795.13 repaid: the 44 % the bar shows.
    listed = [LISTED]
    const root = await mount()
    expect(text(root, 'loans-item-total-paid')).toBe(formatCurrency(100000 - B60))
    expect(formatCurrency(100000 - B60)).toBe(formatCurrency(43795.13))
  })

  it('marks a loan with nothing left to pay as paid off, and leaves it out of the totals', async () => {
    listed = [
      LISTED,
      {
        ...LOAN,
        id: 2,
        name: 'Car loan',
        remaining_balance: 0,
        monthly_payment: 0,
        next_payment_date: null,
        payoff_date: '2019-12-01',
      },
    ]
    const root = await mount()
    expect(texts(root, 'loans-item-payoff')).toEqual([
      'Done in December 2030',
      'Paid off in December 2019',
    ])
    expect(summary(root, 'Owed in total')).toBe(`Owed in total${formatCurrency(B60)}`)
    expect(summary(root, 'Paid each month')).toBe(`Paid each month${formatCurrency(A)}for 1 loan`)
    expect(summary(root, 'Next to finish')).toBe('Next to finishMortgagein December 2030')
    expect(texts(root, 'loans-item-total-paid')[1]).toBe(formatCurrency(100000))
    // Nothing is left to compare on a paid-off loan, so only the open one offers What if.
    expect(texts(root, 'loans-item-what-if')).toEqual(['What if'])
  })

  it('shows a paid-off loan as owing nothing and paying nothing', async () => {
    listed = [{ ...LOAN, start_date: '2010-01-01' }]
    const root = await mount()
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(0))
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(0))
    expect(text(root, 'loans-item-progress-percent')).toBe('100% repaid')
  })
})
