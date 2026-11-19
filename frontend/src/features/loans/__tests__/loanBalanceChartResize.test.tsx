/**
 * The what-if chart on Compare takes its width from a ResizeObserver. A new width gives it a new
 * height (the payoff labels wrap into more rows when it is narrow), so a width set inside the
 * observer's callback resizes the box it is watching, in the same frame: Chromium reports that as
 * "ResizeObserver loop completed with undelivered notifications". On 19 Nov it did so on every
 * opening of Compare, at 390, 600, 820 and 1440 px. The width is measured once when the chart
 * mounts, and every later one is taken a frame after the observer reports it.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { amortize } from '../../../../../shared/loanSchedule'
import LoanBalanceChart from '../LoanBalanceChart'
import type { LoanInput } from '../../../../../shared/loanSchedule'

const KAYAK: LoanInput = {
  principal: 12000,
  interest_rate: 5,
  start_date: '2025-01-15',
  term_months: 60,
  rate_periods: [],
  prepayments: [],
}

let dispose: (() => void) | undefined
let host: HTMLDivElement
let report: ResizeObserverCallback | undefined
let frames: FrameRequestCallback[]

beforeEach(() => {
  frames = []
  report = undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        report = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(520)
})
afterEach(() => {
  dispose?.()
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function draw(): SVGSVGElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  const rows = amortize(KAYAK)
  dispose = render(
    () => (
      <LoanBalanceChart
        series={[{ key: 'a', label: 'As planned', rows, payoffMonth: rows.length }]}
        from={1}
        startBalance={KAYAK.principal}
        axisMoney={(amount) => `€${Math.round(amount / 1000)}K`}
        description="The balance falls."
      />
    ),
    host
  )
  return host.querySelector('svg')!
}

const resize = (width: number) => {
  report!([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
}
const runFrames = () => {
  for (const frame of frames.splice(0)) frame(0)
}

describe("the what-if chart's width", () => {
  it('is the width of its box from the first paint', () => {
    expect(draw().getAttribute('width')).toBe('520')
  })

  it('changes a frame after the observer reports it, never inside the report', () => {
    const svg = draw()
    resize(300)
    // Inside the callback nothing has moved: a size changed here is the loop Chromium reports.
    expect(svg.getAttribute('width')).toBe('520')
    runFrames()
    expect(svg.getAttribute('width')).toBe('300')
  })

  it('takes only the last of several reports in one frame', () => {
    const svg = draw()
    resize(300)
    resize(410)
    runFrames()
    expect(svg.getAttribute('width')).toBe('410')
  })
})
