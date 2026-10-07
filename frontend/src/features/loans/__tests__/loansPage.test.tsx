/**
 * The Loans page as a person uses it: What if from a card, the comparison the address names,
 * both modes side by side, Use as A, and an extra payment saved on Extra payments moving A.
 *
 * The example loan is the one plan 03 works through: 100,000 at 5 % over 120 months, first
 * payment 2026-01-01, seen on 2025-12-15 so the next payment is the first. Its golden figures are
 * worked out in closed form in core/__tests__/loanScenarios.test.ts; here they are read off the
 * page. Money is the app's currency (EUR unless set), whole units in a sentence.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../../core/appStore'
import { __resetDataVersionsForTest, invalidateForRequest } from '../../../core/dataVersions'

let listed: Record<string, unknown>[] = []
let nextId = 100

vi.mock('../../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const loanOf = (path: string) =>
    listed.find((l) => l.id === Number(/\/api\/loans\/(\d+)/.exec(path)?.[1]))
  return {
    ...original,
    // A fresh copy per read, as IndexedDB and the network both give.
    apiHouseholdGet: vi.fn(async () => structuredClone(listed)),
    apiGet: vi.fn(async (path: string) => structuredClone(loanOf(path))),
    // A write lands in the store and bumps the data version, as apiFetch does after one.
    apiPost: vi.fn(async (path: string, body: Record<string, unknown>) => {
      const loan = loanOf(path)
      if (loan && path.endsWith('/prepayments')) {
        ;(loan.prepayments as unknown[]).push({ id: ++nextId, ...body })
      }
      invalidateForRequest(path, 'POST', true)
      return { ok: true }
    }),
    apiDelete: vi.fn(async (path: string) => {
      invalidateForRequest(path, 'DELETE', true)
      return { ok: true }
    }),
    apiPut: vi.fn(async () => ({ ok: true })),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy({}, { get: () => async () => [] }),
  }
})

const LOAN = {
  id: 1,
  name: 'Mortgage',
  principal: 100000,
  interest_rate: 5,
  term_months: 120,
  start_date: '2026-01-01',
  profile_id: 1,
  rate_periods: [],
  prepayments: [],
}

let host: HTMLDivElement
let dispose: (() => void) | undefined

/** Every element asked to scroll into view, and how. jsdom has no scrollIntoView of its own. */
let scrolled: { chip: string | null; options: unknown }[] = []

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((res) => setTimeout(res, 0))
}

beforeAll(async () => {
  await import('../../Loans')
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
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
  listed = [structuredClone(LOAN)]
  scrolled = []
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
    scrolled.push({ chip: this.getAttribute('data-test-id'), options })
  }
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  history.replaceState(null, '', '#')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount(hash: string): Promise<HTMLDivElement> {
  history.replaceState(null, '', hash)
  setPage('loans')
  const { default: Loans } = await import('../../Loans')
  dispose = render(() => <Loans />, host)
  await settle()
  return host
}

const el = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const text = (root: HTMLElement, id: string) => el(root, id)?.textContent ?? ''

async function click(root: HTMLElement, id: string) {
  const target = el(root, id)
  if (!target) throw new Error(`no ${id} on the page`)
  target.click()
  await settle()
}

/** The query of the address, as the page wrote it. */
const query = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '')

const ONE_OFF = 'one-payment.10000.12'

describe('Compare', () => {
  it('opens the comparison the address names, with the golden payoff date', async () => {
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.shorten`)
    expect(text(root, 'loans-compare-sentence')).toBe(
      'You pay €10,000 extra and €5,236 less interest. Done in October 2034, 14 months sooner.'
    )
    expect(text(root, 'loans-compare-a-payoff')).toBe('Dec 2035')
    expect(text(root, 'loans-compare-b-payoff')).toBe('Oct 203414 months sooner')
    expect(text(root, 'loans-compare-b-saved')).toBe('€5,236.32')
    expect(el(root, 'loans-template-one-payment')?.getAttribute('aria-pressed')).toBe('true')
    expect((el(root, 'loans-preset-amount') as HTMLSelectElement).value).toBe('10000')
    expect((el(root, 'loans-preset-inMonths') as HTMLSelectElement).value).toBe('12')
  })

  it('shows the golden installment when the extra lowers the payments instead', async () => {
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.lower`)
    expect(text(root, 'loans-compare-sentence')).toBe(
      'You pay €10,000 extra and €2,439 less interest. From January 2027 the installment is €945.48 instead of €1,060.66.'
    )
    expect(text(root, 'loans-compare-b-installment')).toBe('€1,060.66then €945.48 from Jan 2027')
    expect(text(root, 'loans-compare-b-payoff')).toBe('Dec 2035same end date')
  })

  it('switches mode in place and sets both modes side by side', async () => {
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.shorten`)
    await click(root, 'loans-mode-lower')
    expect(query().get('b')).toBe(`${ONE_OFF}.lower`)
    expect(text(root, 'loans-compare-b-installment')).toContain('€945.48')

    await click(root, 'loans-mode-both')
    expect(query().get('b')).toBe(`${ONE_OFF}.both`)
    expect(text(root, 'loans-compare-sentence')).toBe(
      'Finishing sooner saves €2,798 more interest and ends in October 2034. Paying less each month frees €115.17 a month from January 2027.'
    )
    expect(text(root, 'loans-compare-shorten-title')).toBe('Finish sooner')
    expect(text(root, 'loans-compare-lower-title')).toBe('Pay less each month')
    expect(text(root, 'loans-compare-shorten-payoff')).toBe('Oct 203414 months sooner')
    expect(text(root, 'loans-compare-lower-installment')).toBe(
      '€1,060.66then €945.48 from Jan 2027'
    )
    // Both sides are B, so neither can be pinned as A.
    expect(el(root, 'loans-use-as-a')).toBeNull()
  })

  it('pins B as A, compares the next what-if against it, and goes back to as planned', async () => {
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.shorten`)
    await click(root, 'loans-use-as-a')
    expect(query().get('a')).toBe(`${ONE_OFF}.shorten`)
    expect(query().get('b')).toBeNull()
    expect(text(root, 'loans-compare-a-title')).toBe('€10,000 in a year')
    expect(text(root, 'loans-compare-a-payoff')).toBe('Oct 2034')
    expect(text(root, 'loans-compare-prompt')).toBe('Pick a what-if above to compare it with A.')

    await click(root, 'loans-template-more-each-month')
    expect(query().get('b')).toBe('more-each-month.50.shorten')
    // B is measured against the pinned A: 50 more a month ends 8 months after it.
    expect(text(root, 'loans-compare-b-payoff')).toBe('Jun 20358 months later')

    await click(root, 'loans-reset-a')
    expect(query().get('a')).toBeNull()
    expect(text(root, 'loans-compare-a-title')).toBe('As planned')
    expect(text(root, 'loans-compare-b-payoff')).toBe('Jun 20356 months sooner')
  })

  it('opens What if from a card on the first preset, with its own place in history', async () => {
    const root = await mount('#loans')
    await click(root, 'loans-item-what-if')
    expect(window.location.hash.split('?')[0]).toBe('#loans/1/compare')
    expect(query().get('b')).toBe('more-each-month.50.shorten')
    expect(text(root, 'loans-compare-b-title')).toBe('€50 more each month')
    expect(text(root, 'loans-compare-b-installment')).toBe('€1,060.66plus €50.00 extra a month')
  })

  it('compares on payment numbers when the start date cannot be read', async () => {
    listed = [{ ...structuredClone(LOAN), start_date: '' }]
    const root = await mount('#loans/1/compare?b=more-each-month.50.shorten')
    expect(text(root, 'loans-compare-a-payoff')).toBe('Month 120')
    expect(text(root, 'loans-compare-b-payoff')).toBe('Month 1146 months sooner')
    expect(text(root, 'loans-compare-sentence')).toContain('Done in month 114, 6 months sooner.')
  })

  it('reads an address it cannot use as no what-if, not as an error', async () => {
    const root = await mount('#loans/1/compare?b=one-payment.-5.x.lower')
    expect(query().get('b')).toBe('one-payment.-5.x.lower')
    expect(text(root, 'loans-compare-prompt')).toBe(
      'Pick a what-if above to compare it with your loan as planned.'
    )
  })

  it('has nothing to compare on a paid-off loan', async () => {
    listed = [{ ...structuredClone(LOAN), start_date: '2010-01-01' }]
    const root = await mount('#loans/1/compare')
    expect(text(root, 'loans-compare-done')).toBe(
      'This loan is paid off, so there is nothing left to compare.'
    )
  })
})

describe('the picked what-if on a phone', () => {
  // On a phone the chips scroll sideways and a reload starts them at the left end, where the last
  // one, Rate change, is out of sight. jsdom lays nothing out, so this checks what is asked of the
  // browser; tests/release/s16-loans.spec.ts measures the chip inside the strip at 390x844.
  const INTO_VIEW = { block: 'nearest', inline: 'center' }

  it('is brought into view when the page opens on it, at once', async () => {
    await mount('#loans/1/compare?b=rate-change.1')
    expect(scrolled).toEqual([
      { chip: 'loans-template-rate-change', options: { ...INTO_VIEW, behavior: 'auto' } },
    ])
  })

  it('glides to a new pick, and stays put for another preset of the same one', async () => {
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.shorten`)
    await click(root, 'loans-template-rate-change')
    expect(scrolled.slice(1)).toEqual([
      { chip: 'loans-template-rate-change', options: { ...INTO_VIEW, behavior: 'smooth' } },
    ])

    const points = el(root, 'loans-preset-points') as HTMLSelectElement
    points.value = [...points.options].map((o) => o.value).find((v) => v !== points.value)!
    points.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(query().get('b')).not.toBe('rate-change.1')
    expect(scrolled).toHaveLength(2)
  })

  it('jumps instead of gliding when motion is turned down', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }))
    const root = await mount(`#loans/1/compare?b=${ONE_OFF}.shorten`)
    await click(root, 'loans-template-rate-change')
    expect(scrolled.map((s) => s.options)).toEqual([
      { ...INTO_VIEW, behavior: 'auto' },
      { ...INTO_VIEW, behavior: 'auto' },
    ])
  })
})

describe('the tour', () => {
  const anchors = (root: HTMLElement) =>
    ['loans-header', 'loans-add', 'loans-list', 'loans-what-if'].filter(
      (key) => !root.querySelector(`[data-tour="${key}"]`)
    )

  it('finds every anchor with no loans at all', async () => {
    listed = []
    const root = await mount('#loans')
    expect(el(root, 'loans-empty')).not.toBeNull()
    expect(anchors(root)).toEqual([])
  })

  it('finds every anchor when every loan is paid off', async () => {
    listed = [{ ...structuredClone(LOAN), start_date: '2010-01-01' }]
    const root = await mount('#loans')
    expect(el(root, 'loans-item-what-if')).toBeNull()
    expect(anchors(root)).toEqual([])
  })

  it('points What if at the first loan that still has payments to make', async () => {
    listed = [
      { ...structuredClone(LOAN), id: 2, name: 'Old car', start_date: '2010-01-01' },
      structuredClone(LOAN),
    ]
    const root = await mount('#loans')
    const target = root.querySelector('[data-tour="loans-what-if"]')
    expect(target?.getAttribute('data-test-id')).toBe('loans-item-what-if')
    expect(target?.closest('[data-test-id="loans-item"]')?.textContent).toContain('Mortgage')
  })
})

describe('the loan page', () => {
  it('says plainly when a loan is not there, with a way back', async () => {
    const root = await mount('#loans/99/schedule')
    expect(text(root, 'loans-detail-not-found')).toContain('This loan is not here')
    expect(el(root, 'loans-detail-back')?.getAttribute('href')).toMatch(/^#loans(\?|$)/)
  })

  it('follows the address from tab to tab', async () => {
    const root = await mount('#loans/1/schedule')
    expect(el(root, 'loans-schedule-table')).not.toBeNull()
    expect(root.querySelectorAll('[data-test-id="loans-schedule-row"]')).toHaveLength(120)
    window.location.hash = '#loans/1/extras'
    await settle()
    expect(el(root, 'loans-extras')).not.toBeNull()
    expect(el(root, 'loans-tab-extras')?.getAttribute('aria-selected')).toBe('true')
  })

  it('moves A when an extra payment is saved on Extra payments', async () => {
    const root = await mount(`#loans/1/extras?b=more-each-month.50.shorten`)
    const month = el(root, 'loans-extra-month') as HTMLSelectElement
    month.value = '12'
    month.dispatchEvent(new Event('change', { bubbles: true }))
    const amount = el(root, 'loans-extra-amount') as HTMLInputElement
    amount.focus()
    amount.value = '10000'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    el(root, 'loans-extra-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
    await settle()

    // Nothing reloaded by hand: the write bumped `loans`, the list came back with the payment.
    expect(text(root, 'loans-extra-item')).toBe('Payment 12, Dec 1, 2026€10,000.00')

    await click(root, 'loans-tab-compare')
    expect(text(root, 'loans-compare-a-payoff')).toBe('Oct 2034')
    expect(root.textContent).toContain('With your saved extra payment')
  })
})
