/**
 * The chart under a card, drawn: the line splits at today, today sits on it at what is owed, this
 * year is the one picked out, and the end of the line says when the loan is done, or that it never
 * is. The loan is a boat: 24,000 at 6 % over 48 months from 2024-03-10, seen on 2025-12-15, after
 * its 22nd payment.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    // The title names it; the description, read after, says what it shows.
    expect(svg.getAttribute('aria-labelledby')).toBe('test-chart-title')
    expect(svg.getAttribute('aria-describedby')).toBe('test-chart-desc')
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

  // Its first payment next year: nothing on the axis is this year, so a Today there would stand at
  // the start of next year. The whole line is still to come.
  it('has no today on a loan whose first payment is in a later year', () => {
    const root = draw({ ...BOAT, start_date: '2026-02-10' })
    expect(one(root, 'loans-payoff-today')).toBeNull()
    expect(one(root, 'loans-payoff-this-year')).toBeNull()
    expect(all(root, 'loans-payoff-year').filter((y) => y.hasAttribute('data-current'))).toEqual([])
    expect(one(root, 'loans-payoff-past')).toBeNull()
    expect(points(one(root, 'loans-payoff-future'))).toHaveLength(49)
  })

  it('keeps today at the start of a loan whose first payment is later this year', () => {
    const root = draw({ ...BOAT, start_date: '2025-12-20' })
    expect(one(root, 'loans-payoff-today')).not.toBeNull()
    expect(one(root, 'loans-payoff-this-year')).not.toBeNull()
  })

  it('puts a label that would run off the right edge on the left of its mark', () => {
    const root = draw({ ...BOAT, prepayments: [{ month: 46, amount: 1000 }] })
    const extra = one(root, 'loans-payoff-extra')!
    const label = extra.querySelector('text')!
    const mark = extra.querySelector('circle')!
    expect(label.textContent).toBe('+€1,000')
    expect(label.getAttribute('text-anchor')).toBe('end')
    expect(Number(label.getAttribute('x'))).toBeLessThan(Number(mark.getAttribute('cx')))
  })

  it('keeps a label clear of today and the glow around it', () => {
    // An extra payment with the payment made today: its mark is where today is.
    const root = draw({ ...BOAT, prepayments: [{ month: 22, amount: 1000 }] })
    const dot = one(root, 'loans-payoff-today')!.querySelectorAll('circle')
    const halo = Number(dot[0].getAttribute('r'))
    const todayX = Number(dot[0].getAttribute('cx'))
    const label = one(root, 'loans-payoff-extra')!.querySelector('text')!
    expect(label.textContent).toBe('+€1,000')
    const x = Number(label.getAttribute('x'))
    if (label.getAttribute('text-anchor') === 'end') expect(x).toBeLessThanOrEqual(todayX - halo)
    else expect(x).toBeGreaterThanOrEqual(todayX + halo)
  })

  it('puts a label on the left when its right would cross the glow, level with it', () => {
    // The payment before today's: its mark sits just past the glow and about level with it, so a
    // label on its right would run across today's dot.
    const root = draw({ ...BOAT, prepayments: [{ month: 21, amount: 1000 }] })
    const dot = one(root, 'loans-payoff-today')!.querySelectorAll('circle')
    const halo = Number(dot[0].getAttribute('r'))
    const todayX = Number(dot[0].getAttribute('cx'))
    const extra = one(root, 'loans-payoff-extra')!
    expect(todayX - Number(extra.querySelector('circle')!.getAttribute('cx'))).toBeGreaterThan(halo)
    const label = extra.querySelector('text')!
    expect(label.textContent).toBe('+€1,000')
    expect(label.getAttribute('text-anchor')).toBe('end')
    expect(Number(label.getAttribute('x'))).toBeLessThanOrEqual(todayX - halo)
  })
})

describe("an extra payment's label on a narrow chart", () => {
  // The demo's Investment Property Loan: 200,000 at 4.2 % over 240 months from June 2023, seen on
  // 19 November 2026 after its 42nd payment, with 5,000 paid extra at payment 20 and 8,000 planned
  // at payment 150. On a narrow chart the first mark sits under the Today pill, with the plot's
  // edge on its left: neither side above it has room.
  const PROPERTY: LoanInput = {
    principal: 200000,
    interest_rate: 4.2,
    start_date: '2023-06-01',
    term_months: 240,
    rate_periods: [],
    prepayments: [
      { month: 20, amount: 5000 },
      { month: 150, amount: 8000 },
    ],
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const num = (el: Element | null | undefined, name: string) => Number(el?.getAttribute(name))
  /** A label's box: 12 px text standing on its y, from 12 px above it to 3 below. */
  const boxOf = (label: Element) => {
    const x = num(label, 'x')
    const y = num(label, 'y')
    const width = (label.textContent ?? '').length * 7.2
    const x0 = label.getAttribute('text-anchor') === 'end' ? x - width : x
    return { x0, x1: x0 + width, top: y - 12, bottom: y + 3 }
  }
  type Rect = ReturnType<typeof boxOf>
  const meets = (a: Rect, b: Rect) =>
    a.x0 < b.x1 && a.x1 > b.x0 && a.top < b.bottom && a.bottom > b.top
  /** The line's highest and lowest y between two x: where it runs inside them. */
  const lineBetween = (line: number[][], x0: number, x1: number) => {
    const at = (x: number) => {
      const i = line.findIndex(([px]) => px >= x)
      if (i <= 0) return line[Math.max(0, i)][1]
      const [ax, ay] = line[i - 1]
      const [bx, by] = line[i]
      return ay + ((by - ay) * (x - ax)) / (bx - ax || 1)
    }
    const ys = [at(x0), at(x1), ...line.filter(([px]) => px > x0 && px < x1).map(([, py]) => py)]
    return { high: Math.min(...ys), low: Math.max(...ys) }
  }

  it.each([
    ['on a phone', 308],
    ['in a window 600 px wide', 494],
    ['in a window 820 px wide, with the sidebar shown', 426],
  ])('labels both %s, by its mark, clear of the line, Today and each other', (_, width) => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width)
    const root = draw(PROPERTY, '2026-11-19')
    const line = [
      ...points(one(root, 'loans-payoff-past')),
      ...points(one(root, 'loans-payoff-future')),
    ].sort((a, b) => a[0] - b[0])
    const left = line[0][0]
    const right = line[line.length - 1][0]
    const base = num(one(root, 'loans-payoff-end')!.querySelector('circle'), 'cy')
    const today = one(root, 'loans-payoff-today')!
    const glowEl = today.querySelectorAll('circle')[0]
    const r = num(glowEl, 'r')
    const glow = {
      x0: num(glowEl, 'cx') - r,
      x1: num(glowEl, 'cx') + r,
      top: num(glowEl, 'cy') - r,
      bottom: num(glowEl, 'cy') + r,
    }
    const pillEl = today.querySelector('rect')
    const pill = {
      x0: num(pillEl, 'x'),
      x1: num(pillEl, 'x') + num(pillEl, 'width'),
      top: num(pillEl, 'y'),
      bottom: num(pillEl, 'y') + num(pillEl, 'height'),
    }

    const extras = all(root, 'loans-payoff-extra')
    expect(extras).toHaveLength(2)
    const boxes = extras.map((extra) => {
      const label = extra.querySelector('text')
      expect(label?.textContent ?? 'no label').toMatch(/^\+€[58],000$/)
      const b = boxOf(label!)
      const mark = num(extra.querySelector('circle'), 'cx')
      // By its mark: under it, or beside it.
      expect(Math.max(b.x0 - mark, mark - b.x1, 0)).toBeLessThanOrEqual(7.1)
      // Inside the plot.
      expect(b.x0).toBeGreaterThanOrEqual(left - 0.1)
      expect(b.x1).toBeLessThanOrEqual(right + 0.1)
      expect(b.bottom).toBeLessThanOrEqual(base + 0.1)
      // Never across the line: it runs wholly above the label or wholly under it.
      const run = lineBetween(line, b.x0, b.x1)
      expect(run.low < b.top || run.high > b.bottom).toBe(true)
      expect(meets(b, glow)).toBe(false)
      expect(meets(b, pill)).toBe(false)
      return b
    })
    expect(meets(boxes[0], boxes[1])).toBe(false)
  })
})
