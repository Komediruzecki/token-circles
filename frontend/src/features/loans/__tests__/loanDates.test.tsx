/**
 * The loan's own page shows each due date as the schedule gives it, in every timezone.
 *
 * Moved from the amortisation table's tests when Month by month and Extra payments replaced it.
 * Two kinds of date went wrong there before: rows formatted in the local zone, where a bare
 * YYYY-MM-DD is midnight UTC and reads a day early west of Greenwich; and labels recomputed with
 * Date#setMonth, which overflows, so one month after 31 January was 3 March, not 28 February.
 * The zone is pinned west of UTC here, where both show.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateLoan } from '../../../../../shared/loanSchedule'
import { formatsFor } from '../loanCopy'
import { savedExtras } from '../loanData'
import LoanExtras from '../LoanExtras'
import LoanSchedule, { scheduleCsv } from '../LoanSchedule'

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

const f = formatsFor('EUR')
let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

function mount(view: () => any): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(view, host)
  return host
}

describe('loan dates', () => {
  it('runs west of UTC', () => {
    expect(new Date('2026-07-01T00:00:00Z').getTimezoneOffset()).not.toBe(0)
  })

  it('shows the schedule rows on their own dates, not a day early', () => {
    const rows = calculateLoan(LOAN).schedule
    const root = mount(() => (
      <LoanSchedule rows={rows} loanName={LOAN.name} neverPaysOffFrom={null} formats={f} />
    ))
    const dates = [...root.querySelectorAll('[data-test-id="loans-schedule-row"]')]
      .slice(0, 3)
      .map((tr) => tr.querySelectorAll('td')[1]?.textContent)
    expect(dates).toEqual(['Jan 31, 2026', 'Feb 28, 2026', 'Mar 31, 2026'])
  })

  it('dates an extra payment in month 2 of a loan starting 31 January on 28 February', () => {
    const root = mount(() => (
      <LoanExtras
        loanName={LOAN.name}
        startDate={LOAN.start_date}
        baseRate={LOAN.interest_rate}
        extras={savedExtras(LOAN)}
        ratePeriods={LOAN.rate_periods}
        lastMonth={24}
        nextMonth={1}
        canWrite
        ownerName="Me"
        compareHref="#loans/1/compare"
        formats={f}
        onAdd={async () => true}
        onDelete={async () => {}}
        onEditRates={() => {}}
      />
    ))
    const item = root.querySelector('[data-test-id="loans-extra-item"]')!
    expect(item.textContent).toContain('Payment 2, Feb 28, 2026')
    expect(item.textContent).toContain('bonus')
    expect(item.textContent).toContain('€500.00')
    // A rate period from month 4 starts on 30 April.
    expect(root.querySelector('[data-test-id="loans-rate-period"]')!.textContent).toBe(
      'From payment 4 (from Apr 30, 2026)6%'
    )
  })

  it('downloads the schedule in the columns the export has always had', () => {
    const csv = scheduleCsv(calculateLoan(LOAN).schedule).split('\n')
    expect(csv[0]).toBe('Month,Date,Payment,Principal,Interest,Balance,Rate,Prepayment,Note')
    expect(csv[2].startsWith('2,2026-02-28,')).toBe(true)
    expect(csv[2].endsWith(',500.00,bonus')).toBe(true)
    expect(csv).toHaveLength(1 + calculateLoan(LOAN).schedule.length)
  })
})
