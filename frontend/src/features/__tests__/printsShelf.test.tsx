/**
 * Prints on Progress (PrintsShelf): every state from the empty plate to every print, worked out
 * from the badges' snapshot, with the seal's own description as its label and no amount anywhere
 * on the page.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackedMonthsOf } from '../../../../shared/trackedMonths'
import { addMonths } from '../../core/achievements/months'
import * as store from '../../core/achievementsStore'
import { sharePrint } from '../../core/prints/share'
import { addToast } from '../../core/toastStore'
import PrintsShelf, { engraveMs, resetEngravings } from '../PrintsShelf'
import type { JSX } from 'solid-js'

vi.mock('../../core/prints/share', () => ({ sharePrint: vi.fn() }))
vi.mock('../../core/toastStore', () => ({ addToast: vi.fn() }))

vi.mock('../../core/achievementsStore', async () => {
  const { createSignal } = await import('solid-js')
  const [snapshot, setSnapshot] = createSignal<unknown>(null)
  return { snapshot, setSnapshot }
})
const setSnapshot = (store as unknown as { setSnapshot: (v: unknown) => void }).setSnapshot

interface Entry {
  date: string
  type: string
  amount: number
}

/** Four entries a month: pay, rent and two shops. Five-digit amounts, so a leak is plain. */
function aMonth(month: string, n = 4, pay = 31457.25, shop = 2468.75): Entry[] {
  return [
    { date: `${month}-01`, type: 'income', amount: pay },
    { date: `${month}-02`, type: 'expense', amount: -12345.5 },
    { date: `${month}-10`, type: 'expense', amount: -shop },
    { date: `${month}-21`, type: 'expense', amount: -shop },
  ].slice(0, n)
}

const months = (from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => addMonths(from, i))

function snap(transactions: Entry[], today: string) {
  return {
    transactions,
    evaluation: { trackedMonths: trackedMonthsOf(transactions.map((t) => t.date)) },
    today,
  }
}

let host: HTMLDivElement
let dispose: (() => void) | undefined
let reduce = false
beforeEach(() => {
  // The shelf renders a task after it mounts; mount() below runs that task.
  vi.useFakeTimers()
  reduce = false
  resetEngravings()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
})
afterEach(() => {
  dispose?.()
  host?.remove()
  setSnapshot(null)
  vi.useRealTimers()
})
const mount = (el: () => JSX.Element): HTMLDivElement => {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(el, host)
  vi.advanceTimersByTime(0)
  return host
}
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-test-id="${id}"]`)

describe('Prints on Progress', () => {
  it('holds its place for the task after Progress first renders, then shows', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <PrintsShelf />, host)
    expect(q(host, 'progress-prints')?.getAttribute('aria-busy')).toBe('true')
    expect(q(host, 'prints-seal')).toBeNull()
    vi.advanceTimersByTime(0)
    expect(q(host, 'progress-prints')?.hasAttribute('aria-busy')).toBe(false)
    expect(q(host, 'prints-seal')).not.toBeNull()
  })

  it('waits for the snapshot without saying anything yet', () => {
    const c = mount(() => <PrintsShelf />)
    expect(q(c, 'progress-prints')?.getAttribute('aria-busy')).toBe('true')
    expect(q(c, 'prints-seal')).toBeNull()
  })

  it('shows an empty plate that says how a month counts', () => {
    setSnapshot(snap(aMonth('2026-10', 2), '2026-10-05'))
    const c = mount(() => <PrintsShelf />)
    const seal = q(c, 'prints-seal')!
    expect(seal.getAttribute('data-kind')).toBe('empty')
    expect(seal.getAttribute('role')).toBe('img')
    expect(seal.getAttribute('aria-label')).toBe(
      'An empty seal with twelve places, one for each month you track.'
    )
    expect(c.textContent).toContain('Your first print')
    expect(c.textContent).toContain(
      'It fills in here, one petal for each month you track. A month counts once it holds three entries.'
    )
    expect(seal.querySelector('.seal-petal')).toBeNull()
    expect(q(c, 'prints-next')).toBeNull()
    expect(q(c, 'prints-every')).toBeNull()
  })

  it('fills the plate in, and says how many more months finish it', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    const seal = q(c, 'prints-seal')!
    expect(seal.getAttribute('data-kind')).toBe('plate')
    expect(q(c, 'prints-title')?.textContent).toBe('6 of 12 months')
    expect(q(c, 'prints-plate-line')?.textContent).toBe(
      'Six more tracked months in a row finish it.'
    )
    expect(seal.getAttribute('aria-label')).toMatch(
      /^A seal with 6 of its 12 petals so far, April 2026 to September 2026\./
    )
    expect(seal.querySelectorAll('.seal-petal')).toHaveLength(6)
  })

  it('names the month that stopped the run, with the entries it holds', () => {
    const entries = [...months('2026-01', 6).flatMap((m) => aMonth(m)), ...aMonth('2026-07', 2)]
    setSnapshot(snap(entries, '2026-10-05'))
    const c = mount(() => <PrintsShelf />)
    expect(q(c, 'prints-title')?.textContent).toBe('6 of 12 months, up to June 2026')
    expect(q(c, 'prints-plate-line')?.textContent).toBe(
      'July 2026 has 2 entries; a month counts once it holds three.'
    )
  })

  it('says when this month is on the seal and still running', () => {
    setSnapshot(
      snap(
        months('2026-05', 6).flatMap((m) => aMonth(m)),
        '2026-10-25'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(c.textContent).toContain('October 2026 is still running, so its petal can still change.')
  })

  it('shows the first print on paper, and when the next one starts', () => {
    setSnapshot(
      snap(
        months('2025-10', 12).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    const seal = q(c, 'prints-seal')!
    expect(seal.getAttribute('data-kind')).toBe('print')
    expect(q(c, 'prints-eyebrow')?.textContent).toBe('Your first print')
    expect(q(c, 'prints-title')?.textContent).toBe('October 2025 to September 2026')
    expect(c.textContent).toContain('Only the shape of your year is on it.')
    expect(q(c, 'prints-next-status')?.textContent).toBe('Starts with October 2026.')
    // One print is not a shelf of them yet.
    expect(q(c, 'prints-every')).toBeNull()
  })

  it('shows the newest print, the next plate and every print, newest first', () => {
    setSnapshot(
      snap(
        months('2000-01', 322).flatMap((m) => aMonth(m)),
        '2026-10-15'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(q(c, 'prints-eyebrow')?.textContent).toBe('Print 26')
    expect(q(c, 'prints-title')?.textContent).toBe('January 2025 to December 2025')
    expect(q(c, 'prints-next-status')?.textContent).toBe('10 of 12 months')
    const buttons = [...q(c, 'prints-every')!.querySelectorAll('button')]
    expect(buttons).toHaveLength(26)
    expect(buttons[0].getAttribute('aria-label')).toBe(
      'Show the print for January 2025 to December 2025'
    )
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
  })

  it('features a print picked from every print', () => {
    setSnapshot(
      snap(
        months('2000-01', 322).flatMap((m) => aMonth(m)),
        '2026-10-15'
      )
    )
    const c = mount(() => <PrintsShelf />)
    const pick = q(c, 'prints-every')!.querySelector<HTMLButtonElement>('[data-from="2003-01"]')!
    pick.click()
    expect(q(c, 'prints-eyebrow')?.textContent).toBe('Print 4')
    expect(q(c, 'prints-title')?.textContent).toBe('January 2003 to December 2003')
    expect(q(c, 'prints-seal')?.getAttribute('data-from')).toBe('2003-01')
    expect(pick.getAttribute('aria-pressed')).toBe('true')
  })

  it('follows the snapshot to another profile', () => {
    setSnapshot(
      snap(
        months('2025-10', 12).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(q(c, 'prints-seal')?.getAttribute('data-kind')).toBe('print')
    setSnapshot(snap([], '2026-10-05'))
    expect(q(c, 'prints-seal')?.getAttribute('data-kind')).toBe('empty')
  })

  it('leaves no amount anywhere on the page', () => {
    const entries = months('2025-04', 15).flatMap((m, i) =>
      aMonth(m, 4, 31457.25 + i * 1013.17, 2468.75 + i * 97.41)
    )
    setSnapshot(snap(entries, '2026-07-20'))
    const c = mount(() => <PrintsShelf />)
    // Class names are left out: CSS modules hash them, and a hash can hold five digits.
    const page = c.cloneNode(true) as HTMLElement
    for (const el of page.querySelectorAll('[class]')) el.removeAttribute('class')
    const html = page.innerHTML
    expect(html).not.toMatch(/\d{5,}/)
    for (const t of entries) {
      const a = Math.abs(t.amount)
      expect(html).not.toContain(a.toFixed(2))
      expect(html).not.toContain(String(Math.trunc(a)))
    }
  })
})

describe('engraving the seal', () => {
  /** Every box on screen: the seal is in view from the start. */
  const inView = { top: 100, bottom: 500, left: 0, right: 400, width: 400, height: 400 }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(inView as DOMRect)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const figure = (c: HTMLElement) => q(c, 'prints-figure') as HTMLElement

  it('waits for the seal to settle in view, engraves it, then leaves it finished', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(figure(c).dataset.engraving).toBe('armed')
    vi.advanceTimersByTime(30 + 500)
    expect(figure(c).dataset.engraving).toBe('engraving')
    vi.advanceTimersByTime(engraveMs(6, false))
    expect(figure(c).dataset.engraving).toBeUndefined()
    // Petals go in turn from the first month: --i counts from 0.
    const turns = [...c.querySelectorAll('.seal-petal')].map((g) =>
      (g as SVGElement).style.getPropertyValue('--i')
    )
    expect(turns).toEqual(['0', '1', '2', '3', '4', '5'])
  })

  it('engraves only the new month when the plate grows in the same page load', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    vi.advanceTimersByTime(30 + 500 + engraveMs(6, false))
    setSnapshot(
      snap(
        months('2026-04', 7).flatMap((m) => aMonth(m)),
        '2026-11-05'
      )
    )
    const seal = q(c, 'prints-seal')!
    expect(seal.querySelectorAll('.seal-petal[data-drawn]')).toHaveLength(6)
    expect(seal.querySelectorAll('.seal-petal:not([data-drawn])')).toHaveLength(1)
    expect(figure(c).dataset.engraving).toBe('armed')
    vi.advanceTimersByTime(30 + 500 + engraveMs(1, false))
    expect(figure(c).dataset.engraving).toBeUndefined()
  })

  it('shows a seal seen before in this page load finished, with nothing held back', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const first = mount(() => <PrintsShelf />)
    vi.advanceTimersByTime(30 + 500 + engraveMs(6, false))
    dispose?.()
    first.remove()
    const c = mount(() => <PrintsShelf />)
    expect(figure(c).dataset.engraving).toBeUndefined()
    expect(q(c, 'prints-seal')!.querySelectorAll('.seal-petal:not([data-drawn])')).toHaveLength(0)
  })

  it('engraves the hour marks of an empty plate once', () => {
    setSnapshot(snap([], '2026-10-05'))
    const c = mount(() => <PrintsShelf />)
    expect(figure(c).dataset.engraving).toBe('armed')
    expect(c.querySelectorAll('.seal-hours path')).toHaveLength(12)
    vi.advanceTimersByTime(30 + 500 + engraveMs(12, true))
    expect(figure(c).dataset.engraving).toBeUndefined()
  })

  it('with reduced motion, shows the seal finished and never holds any of it back', () => {
    reduce = true
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(figure(c).dataset.engraving).toBeUndefined()
    expect(q(c, 'prints-seal')!.querySelectorAll('.seal-petal:not([data-drawn])')).toHaveLength(0)
    vi.advanceTimersByTime(10_000)
    expect(figure(c).dataset.engraving).toBeUndefined()
  })

  it('never stays held back: half in view, it engraves 3 s after it first showed', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...inView,
      top: 568,
      bottom: 968,
    } as DOMRect)
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    vi.advanceTimersByTime(30 + 2999)
    expect(figure(c).dataset.engraving).toBe('armed')
    vi.advanceTimersByTime(1)
    expect(figure(c).dataset.engraving).toBe('engraving')
    vi.advanceTimersByTime(engraveMs(6, false))
    expect(figure(c).dataset.engraving).toBeUndefined()
  })
})

describe('reading a month', () => {
  /** Six months from April 2026, each spending a little more than the one before. */
  const sixRising = () =>
    snap(
      months('2026-04', 6).flatMap((m, i) => aMonth(m, 4, 31457.25, 1000 + 250 * i)),
      '2026-10-05'
    )
  const wedge = (c: HTMLElement, m: number) =>
    c.querySelector(`[data-test-id="prints-wedge"][data-slot="${m}"]`)!
  const tap = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const point = (el: Element, type: string, pointerType = 'mouse') =>
    el.dispatchEvent(Object.assign(new Event(type), { pointerType }))
  const faded = (c: HTMLElement) =>
    [...q(c, 'prints-seal')!.querySelectorAll('[data-dim]')].map((g) => g.getAttribute('data-slot'))
  const HINT = 'Tap a petal to see its month.'
  const JUNE = 'June 2026 spent the fourth most of these 6 months, and kept money.'
  const APRIL = 'April 2026 spent the least of these 6 months, and kept money.'
  const SEPTEMBER = 'September 2026 spent the most of these 6 months, and kept money.'

  it('gives the line of a tapped month and fades the others until it is tapped again', () => {
    setSnapshot(sixRising())
    const c = mount(() => <PrintsShelf />)
    const readout = q(c, 'prints-readout')!
    expect(readout.textContent).toBe(HINT)
    expect(readout.getAttribute('aria-live')).toBe('polite')
    // One target per month on the seal, hidden from assistive technology.
    expect(c.querySelectorAll('[data-test-id="prints-wedge"]')).toHaveLength(6)
    expect(wedge(c, 0).closest('svg')!.getAttribute('aria-hidden')).toBe('true')

    tap(wedge(c, 2))
    expect(readout.textContent).toBe(JUNE)
    // Each month is a petal and a stretch of the band: both fade, June's stay.
    expect(faded(c).sort()).toEqual(['0', '0', '1', '1', '3', '3', '4', '4', '5', '5'])

    tap(wedge(c, 5))
    expect(readout.textContent).toBe(SEPTEMBER)
    tap(wedge(c, 5))
    expect(readout.textContent).toBe(HINT)
    expect(faded(c)).toEqual([])
  })

  it('previews the month a mouse points at, and goes back to the tapped one after', () => {
    setSnapshot(sixRising())
    const c = mount(() => <PrintsShelf />)
    const readout = q(c, 'prints-readout')!
    tap(wedge(c, 5))
    point(wedge(c, 0), 'pointerenter')
    expect(readout.textContent).toBe(APRIL)
    expect(faded(c)).not.toContain('0')
    point(wedge(c, 0), 'pointerleave')
    expect(readout.textContent).toBe(SEPTEMBER)
    // A finger touching down is no preview: the tap that follows picks the month.
    point(wedge(c, 1), 'pointerenter', 'touch')
    expect(readout.textContent).toBe(SEPTEMBER)
  })

  it('lists every month in clock order under Month by month', () => {
    setSnapshot(sixRising())
    const c = mount(() => <PrintsShelf />)
    const list = q(c, 'prints-months')!
    expect(list.querySelector('summary')?.textContent).toBe('Month by month')
    const lines = [...list.querySelectorAll('li')].map((li) => li.textContent)
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe(APRIL)
    expect(lines[2]).toBe(JUNE)
    expect(lines[5]).toBe(SEPTEMBER)
  })

  it('clears when another print is featured', () => {
    setSnapshot(
      snap(
        months('2000-01', 322).flatMap((m) => aMonth(m)),
        '2026-10-15'
      )
    )
    const c = mount(() => <PrintsShelf />)
    tap(wedge(c, 3))
    expect(q(c, 'prints-readout')!.textContent).not.toBe(HINT)
    q(c, 'prints-every')!.querySelector<HTMLButtonElement>('[data-from="2003-01"]')!.click()
    expect(q(c, 'prints-readout')!.textContent).toBe(HINT)
    expect(faded(c)).toEqual([])
  })

  it('has nothing to read on an empty plate', () => {
    setSnapshot(snap([], '2026-10-05'))
    const c = mount(() => <PrintsShelf />)
    expect(q(c, 'prints-readout')).toBeNull()
    expect(q(c, 'prints-months')).toBeNull()
    expect(c.querySelector('[data-test-id="prints-wedge"]')).toBeNull()
  })
})

describe('every print as an image', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  /** Each box on screen, except the thumbnails of prints listed as far away. */
  const place = (far: Set<string>) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const from = this.closest('[data-from]')?.getAttribute('data-from') ?? ''
      const top = far.has(from) ? 5000 : 100
      return { top, bottom: top + 96, left: 0, right: 96, width: 96, height: 96 } as DOMRect
    })
  const images = (c: HTMLElement) => q(c, 'prints-every')!.querySelectorAll('img')

  it('draws them two to a task once near the screen, as paper images', () => {
    const far = new Set(['2000-01'])
    place(far)
    setSnapshot(
      snap(
        months('2000-01', 322).flatMap((m) => aMonth(m)),
        '2026-10-15'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(images(c)).toHaveLength(0)
    vi.advanceTimersByTime(30)
    expect(images(c)).toHaveLength(0)
    vi.advanceTimersToNextTimer()
    expect(images(c)).toHaveLength(2)
    vi.advanceTimersToNextTimer()
    expect(images(c)).toHaveLength(4)
    for (let i = 0; i < 20; i++) vi.advanceTimersToNextTimer()
    // 25 of 26: the oldest is still far down the strip.
    expect(images(c)).toHaveLength(25)
    const oldest = q(c, 'prints-every')!.querySelector('[data-from="2000-01"]')!
    expect(oldest.querySelector('img')).toBeNull()
    far.clear()
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersToNextTimer()
    expect(oldest.querySelector('img')).not.toBeNull()
    const img = images(c)[0]
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('src')!.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    // The plate is drawn in the theme's colours, which an image cannot read: it stays inline.
    expect(q(c, 'prints-next')!.querySelector('svg')).not.toBeNull()
    expect(q(c, 'prints-next')!.querySelector('img')).toBeNull()
  })

  it('keeps each button and its image when the snapshot comes again', () => {
    place(new Set())
    const entries = months('2000-01', 40).flatMap((m) => aMonth(m))
    setSnapshot(snap(entries, '2026-10-15'))
    const c = mount(() => <PrintsShelf />)
    vi.advanceTimersByTime(30)
    vi.advanceTimersToNextTimer()
    vi.advanceTimersToNextTimer()
    const before = [...images(c)]
    expect(before).toHaveLength(3)
    setSnapshot(snap([...entries], '2026-10-15'))
    expect([...images(c)]).toEqual(before)
  })
})

describe('sharing a print', () => {
  const share = vi.mocked(sharePrint)
  const toast = vi.mocked(addToast)
  beforeEach(() => {
    share.mockReset()
    toast.mockReset()
  })
  const aYearOf = () =>
    snap(
      months('2025-10', 12).flatMap((m) => aMonth(m)),
      '2026-10-05'
    )
  const button = (c: HTMLElement) => q(c, 'prints-share') as HTMLButtonElement | null

  it('is offered on a finished print only', () => {
    setSnapshot(
      snap(
        months('2026-04', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      )
    )
    const c = mount(() => <PrintsShelf />)
    expect(button(c)).toBeNull()
    setSnapshot(aYearOf())
    expect(button(c)?.textContent).toBe('Share')
  })

  it('shares the featured print, the first one as "my first print", and says when it saved one', async () => {
    share.mockResolvedValue('downloaded')
    setSnapshot(aYearOf())
    const c = mount(() => <PrintsShelf />)
    button(c)!.click()
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Print saved as a PNG.', 'success', { channel: 'prints' })
    })
    expect(share).toHaveBeenCalledTimes(1)
    const [print, first] = share.mock.calls[0]
    expect(print.from).toBe('2025-10')
    expect(first).toBe(true)
  })

  it('says nothing after the share sheet shared it, or was closed', async () => {
    share.mockResolvedValueOnce('shared')
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    setSnapshot(aYearOf())
    const c = mount(() => <PrintsShelf />)
    button(c)!.click()
    await vi.waitFor(() => {
      expect(button(c)!.hasAttribute('aria-busy')).toBe(false)
    })
    button(c)!.click()
    await vi.waitFor(() => {
      expect(share).toHaveBeenCalledTimes(2)
      expect(button(c)!.hasAttribute('aria-busy')).toBe(false)
    })
    expect(toast).not.toHaveBeenCalled()
  })

  it('says so when the image could not be drawn', async () => {
    share.mockRejectedValue(new Error('share card did not render'))
    setSnapshot(aYearOf())
    const c = mount(() => <PrintsShelf />)
    button(c)!.click()
    await vi.waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Could not draw the print as an image.', 'error', {
        channel: 'prints',
      })
    })
  })
})
