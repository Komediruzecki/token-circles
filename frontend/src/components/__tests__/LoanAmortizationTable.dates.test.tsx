/**
 * The amortisation table shows each due date as the schedule gives it, in every timezone.
 *
 * The table drew three kinds of date. Schedule rows came from the API but were formatted in the
 * local zone, and a bare YYYY-MM-DD is midnight UTC, so west of Greenwich every row read one day
 * early. The prepayment and rate-period labels, and the detailed table's rows, were recomputed
 * from the start date with Date#setMonth, which overflows: one month after 31 January is
 * 3 March, not 28 February. The zone is pinned west of UTC here, where both show.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { calculateLoan } from '../../../../shared/loanSchedule'

process.env.TZ = 'America/New_York'

const LOAN = {
  id: 1,
  name: 'Car loan',
  principal: 12000,
  interest_rate: 5,
  term_months: 24,
  start_date: '2026-01-31',
  rate_periods: [{ rate: 6, start_month: 4, end_month: null }],
  prepayments: [{ month: 2, amount: 500, note: 'bonus' }],
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiPost: vi.fn(async () => calculateLoan(LOAN)),
    showToast: vi.fn(),
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await import('../LoanAmortizationTable')
}, 120_000)

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

async function mount(): Promise<HTMLDivElement> {
  const { default: LoanAmortizationTable } = await import('../LoanAmortizationTable')
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(() => <LoanAmortizationTable loanId={LOAN.id} loan={LOAN} />, host)
  await settle()
  return host
}

/** The first label under the section heading `title` (Prepayments, Rate Periods). */
function sectionDate(root: HTMLElement, title: string): string | undefined {
  const heading = [...root.querySelectorAll('h4')].find((h) => h.textContent === title)
  return heading?.nextElementSibling?.querySelector('span')?.textContent ?? undefined
}

describe('LoanAmortizationTable dates', () => {
  it('runs west of UTC', () => {
    expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
  })

  it('dates an extra payment in month 2 of a loan starting 31 January on 28 February', async () => {
    const root = await mount()
    expect(sectionDate(root, 'Prepayments')).toBe('Feb 28, 2026')
  })

  it('dates a rate period from month 4 on 30 April', async () => {
    const root = await mount()
    expect(sectionDate(root, 'Rate Periods')).toBe('Apr 30, 2026')
  })

  it('shows the schedule rows on their own dates, not a day early', async () => {
    const root = await mount()
    const firstDates = [...root.querySelectorAll('table tbody tr')]
      .slice(0, 3)
      .map((tr) => tr.querySelectorAll('td')[1]?.textContent)
    expect(firstDates).toEqual(['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026'])
  })

  it("shows the detailed table's rows on the schedule's dates", async () => {
    const root = await mount()
    const toggle = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'View Amortization'
    )
    toggle!.click()
    await settle()
    const tables = root.querySelectorAll('table')
    const detailed = tables[tables.length - 1]
    const dates = [...detailed.querySelectorAll('tbody tr')]
      .slice(0, 3)
      .map((tr) => tr.querySelectorAll('td')[1]?.textContent)
    expect(dates).toEqual(['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026'])
  })
})
