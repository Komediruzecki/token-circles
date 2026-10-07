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
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { loanStatus } from '../../../../shared/loanSchedule'
import { formatCurrency } from '../../core/api'
import { setPage } from '../../core/appStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'

let listed: unknown[] = []

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async () => ({})),
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
  dispose?.()
  dispose = undefined
  host?.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount(): Promise<HTMLDivElement> {
  setPage('loans')
  const { default: Loans } = await import('../Loans')
  dispose = render(() => <Loans />, host)
  await settle()
  return host
}

const text = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-test-id="${id}"]`)?.textContent ?? ''

/** The summary card whose label is `label`. */
const summary = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('[data-test-id="loans-summary-card"]')].find((c) =>
    c.textContent?.startsWith(label)
  )?.textContent ?? ''

describe('Loans page figures', () => {
  it('shows the remaining balance, payment and progress the list worked out', async () => {
    listed = [{ ...LOAN, remaining_balance: B60, monthly_payment: A, payoff_date: '2030-12-01' }]
    const root = await mount()
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(B60))
    expect(formatCurrency(B60)).toBe(formatCurrency(56204.87))
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(A))
    // (100,000 - 56,204.87) / 100,000 = 43.8 %.
    expect(text(root, 'loans-item-progress-percent')).toBe('44% paid')
    expect(summary(root, 'Remaining Balance')).toBe(`Remaining Balance${formatCurrency(B60)}`)
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
  })

  it('shows a paid-off loan as owing nothing and paying nothing', async () => {
    listed = [{ ...LOAN, start_date: '2010-01-01' }]
    const root = await mount()
    expect(text(root, 'loans-item-remaining')).toBe(formatCurrency(0))
    expect(text(root, 'loans-item-monthly')).toBe(formatCurrency(0))
    expect(text(root, 'loans-item-progress-percent')).toBe('100% paid')
  })
})
