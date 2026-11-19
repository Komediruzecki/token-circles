/**
 * The chart under a card, drawn: the line splits at today, today sits on it at what is owed, this
 * year is the one picked out, and the end of the line says when the loan is done, or that it never
 * is. The loan is a boat: 24,000 at 6 % over 48 months from 2024-03-10, seen on 2025-12-15, after
 * its 22nd payment.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { formatsFor } from '../loanCopy'
import LoanPayoffChart from '../LoanPayoffChart'
import { loanTimeline } from '../loanTimeline'
import type { LoanInput } from '../../../../../shared/loanSchedule'

const BOAT: LoanInput = {
  principal: 24000,
  interest_rate: 6,
  start_date: '2024-03-10',
  term_months: 48,
  rate_periods: [],
  prepayments: [],
}

let dispose: (() => void) | undefined
let host: HTMLDivElement

afterEach(() => {
  dispose?.()
  host.remove()
})

function draw(loan: LoanInput, today = '2025-12-15'): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <LoanPayoffChart
        timeline={loanTimeline(loan, today)}
        axisMoney={(amount) => `€${Math.round(amount / 1000)}K`}
        formats={formatsFor('EUR')}
        today={today}
        id="test-chart"
        description="The balance falls."
      />
    ),
    host
  )
  return host
}

const one = (root: HTMLElement, id: string) => root.querySelector(`[data-test-id="${id}"]`)
const all = (root: HTMLElement, id: string) => [...root.querySelectorAll(`[data-test-id="${id}"]`)]
/** A polyline's points as [x, y] pairs. */
const points = (line: Element | null) =>
  (line?.getAttribute('points') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.split(',').map(Number))

describe('the payoff chart', () => {
  it('is one image, named and described, for a screen reader', () => {
    const svg = one(draw(BOAT), 'loans-payoff-chart')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-labelledby')).toBe('test-chart-title test-chart-desc')
    expect(svg.querySelector('#test-chart-desc')?.textContent).toBe('The balance falls.')
  })

  it('splits the line at today, with today on it at what is owed', () => {
    const root = draw(BOAT)
    const past = points(one(root, 'loans-payoff-past'))
    const future = points(one(root, 'loans-payoff-future'))
    // Payment 0 (the amount borrowed) to payment 22, then 22 to 48.
    expect(past).toHaveLength(23)
    expect(future).toHaveLength(27)
    expect(future[0]).toEqual(past[past.length - 1])

    const dot = one(root, 'loans-payoff-today')!.querySelectorAll('circle')[1]
    expect([Number(dot.getAttribute('cx')), Number(dot.getAttribute('cy'))]).toEqual(
      past[past.length - 1]
    )
    expect(one(root, 'loans-payoff-today')!.textContent).toBe('Today')
  })

  it('picks out this year and ends on the month of the last payment', () => {
    const root = draw(BOAT)
    const current = all(root, 'loans-payoff-year').filter((y) => y.hasAttribute('data-current'))
    expect(current.map((y) => y.textContent)).toEqual(['2025'])
    expect(one(root, 'loans-payoff-this-year')).not.toBeNull()
    const end = one(root, 'loans-payoff-end')!
    expect(end.textContent).toBe('Feb 2028')
    expect(end.hasAttribute('data-paid')).toBe(false)
  })

  it('names every so many years counted from this one when the years are narrow', () => {
    // Twenty years in a chart drawn 640 wide: about 29 px a year, so every other year is named.
    const root = draw({
      ...BOAT,
      principal: 200000,
      interest_rate: 4.2,
      start_date: '2023-06-01',
      term_months: 240,
    })
    const named = all(root, 'loans-payoff-year').map((y) => Number(y.textContent))
    expect(named).toContain(2025)
    expect(named.length).toBeGreaterThan(4)
    expect(named.filter((year) => (year - 2025) % 2 !== 0)).toEqual([])
  })

  it('labels a few extra payments, and only marks many', () => {
    const few = draw({
      ...BOAT,
      prepayments: [
        { month: 6, amount: 2000 },
        { month: 30, amount: 1500 },
      ],
    })
    expect(all(few, 'loans-payoff-extra').map((e) => e.querySelector('text')?.textContent)).toEqual(
      ['+€2,000', '+€1,500']
    )
    dispose?.()
    host.remove()

    const many = draw({
      ...BOAT,
      prepayments: [2, 4, 6, 8, 10, 12, 14].map((month) => ({ month, amount: 100 })),
    })
    expect(all(many, 'loans-payoff-extra')).toHaveLength(7)
    expect(many.querySelector('[data-test-id="loans-payoff-extra"] text')).toBeNull()
  })

  it('has no today on a loan paid off, and the whole line is the past', () => {
    const root = draw(BOAT, '2030-01-01')
    expect(one(root, 'loans-payoff-today')).toBeNull()
    expect(one(root, 'loans-payoff-future')).toBeNull()
    expect(points(one(root, 'loans-payoff-past'))).toHaveLength(49)
    expect(one(root, 'loans-payoff-end')!.hasAttribute('data-paid')).toBe(true)
  })

  it('says a loan is never repaid where its line stops, with no end month', () => {
    const root = draw({
      ...BOAT,
      on_rate_change: 'keep-installment',
      rate_periods: [{ rate: 40, start_month: 13 }],
    })
    expect(one(root, 'loans-payoff-never')?.textContent).toBe('Never repaid at this rate')
    expect(one(root, 'loans-payoff-end')).toBeNull()
  })

  it('draws a loan with no start date on payment numbers, with no today and no years', () => {
    const root = draw({ ...BOAT, start_date: '' })
    expect(one(root, 'loans-payoff-today')).toBeNull()
    expect(all(root, 'loans-payoff-year')).toHaveLength(0)
    expect(one(root, 'loans-payoff-end')).not.toBeNull()
  })
})
