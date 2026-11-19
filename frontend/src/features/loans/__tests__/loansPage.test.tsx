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
import { apiDelete, apiGet, apiPost, apiPut, showToast } from '../../../core/api'
import { ApiError } from '../../../core/apiError'
import { bumpProfileVersion, setCurrentProfile, setPage } from '../../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../../core/confirmStore'
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
    // A removal takes the row out of the store. One the store no longer has, because another tab
    // removed it first, is a 404 in the words both runtimes use, and bumps nothing.
    apiDelete: vi.fn(async (path: string) => {
      const ref = /\/prepayments\/(\d+)$/.exec(path)?.[1]
      if (ref !== undefined) {
        const extras = (loanOf(path)?.prepayments ?? []) as Record<string, unknown>[]
        const at = extras.findIndex((p) => String(p.id) === ref)
        if (at < 0) throw new ApiError(404, 'Extra payment not found')
        extras.splice(at, 1)
      } else {
        const loan = loanOf(path)
        if (!loan) throw new ApiError(404, 'Loan not found')
        listed = listed.filter((l) => l !== loan)
      }
      invalidateForRequest(path, 'DELETE', true)
      return { ok: true }
    }),
    // A changed extra payment lands in the store, found by its id as the Worker finds it.
    apiPut: vi.fn(async (path: string, body: Record<string, unknown>) => {
      const ref = /\/prepayments\/(\d+)$/.exec(path)?.[1]
      const extras = (loanOf(path)?.prepayments ?? []) as Record<string, unknown>[]
      const at = extras.findIndex((p) => String(p.id) === ref)
      if (ref !== undefined && at >= 0) extras[at] = { ...extras[at], ...body }
      invalidateForRequest(path, 'PUT', true)
      return { ok: true }
    }),
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
  boxes?.mockRestore()
  boxes = undefined
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

  it('keeps a tab picked while the loan is still loading, instead of going back to Compare', async () => {
    // The Worker's list rows carry no rate periods or extra payments, so the page fetches the loan
    // before it can work out the presets. A tab picked in that moment is where the person stays.
    const row: Record<string, unknown> = structuredClone(LOAN)
    delete row.rate_periods
    delete row.prepayments
    listed = [row]
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(apiGet).mockImplementationOnce(async () => {
      await held
      return structuredClone(LOAN)
    })
    const root = await mount('#loans')
    await click(root, 'loans-item-what-if')
    await click(root, 'loans-tab-extras')
    release()
    await settle()
    expect(window.location.hash.split('?')[0]).toBe('#loans/1/extras')
    expect(query().get('b')).toBeNull()
    expect(el(root, 'loans-extras')).not.toBeNull()
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

describe('an amount of your own', () => {
  /** Type into an amount box the way a person does: focused, one keystroke at a time. */
  async function typeInto(box: HTMLInputElement, text: string) {
    box.focus()
    box.value = text
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }

  it('steps a yearly bonus by about one installment, and takes a typed amount', async () => {
    const root = await mount('#loans/1/compare?b=yearly-bonus.1000.12.shorten')
    // A = 1,060.66, so a step is 1,000; the bonus cannot go below one step.
    expect(text(root, 'loans-step-up-amount')).toBe('+1,000')
    expect(el(root, 'loans-step-up-amount')?.getAttribute('aria-label')).toBe('Raise by €1,000')
    expect(el(root, 'loans-step-down-amount')?.hasAttribute('disabled')).toBe(true)

    await click(root, 'loans-step-up-amount')
    expect(query().get('b')).toBe('yearly-bonus.2000.12.shorten')
    expect((el(root, 'loans-amount-amount') as HTMLInputElement).value).toBe('2000')
    expect((el(root, 'loans-preset-amount') as HTMLSelectElement).value).toBe('2000')

    // Each keystroke moves B, and the box under the caret is the same one all the way.
    const box = el(root, 'loans-amount-amount') as HTMLInputElement
    for (const typed of ['1', '10', '100', '1000', '10000']) {
      await typeInto(box, typed)
      expect(document.activeElement).toBe(box)
    }
    expect(el(root, 'loans-amount-amount')).toBe(box)
    expect(query().get('b')).toBe('yearly-bonus.10000.12.shorten')
    expect(text(root, 'loans-compare-b-title')).toBe('€10,000 every December')
    // Not one of the suggested amounts, so the list beside the box names none.
    expect((el(root, 'loans-preset-amount') as HTMLSelectElement).value).toBe('')
  })

  it('keeps a typed amount whole, and an emptied box keeps the amount it had', async () => {
    const root = await mount('#loans/1/compare?b=more-each-month.50.shorten')
    const box = el(root, 'loans-amount-amount') as HTMLInputElement
    await typeInto(box, '123.6')
    expect(query().get('b')).toBe('more-each-month.124.shorten')
    await typeInto(box, '')
    expect(query().get('b')).toBe('more-each-month.124.shorten')
    box.blur()
    await settle()
    expect(box.value).toBe('124')
  })

  it('steps from a typed amount to the next multiple of the step, either way', async () => {
    const root = await mount('#loans/1/compare?b=one-payment.1234.12.lower')
    // 1 % of the 100,000 owed.
    expect(text(root, 'loans-step-down-amount')).toBe('−1,000')
    await click(root, 'loans-step-up-amount')
    expect(query().get('b')).toBe('one-payment.2000.12.lower')
    await click(root, 'loans-step-down-amount')
    await click(root, 'loans-step-down-amount')
    expect(query().get('b')).toBe('one-payment.1000.12.lower')
    expect(el(root, 'loans-step-down-amount')?.hasAttribute('disabled')).toBe(true)
  })

  it('picks a suggested amount from the list beside the box', async () => {
    const root = await mount('#loans/1/compare?b=one-payment.1234.12.shorten')
    const presets = el(root, 'loans-preset-amount') as HTMLSelectElement
    expect([...presets.options].map((o) => o.value)).toEqual(['', '1000', '5000', '10000'])
    presets.value = '5000'
    presets.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(query().get('b')).toBe('one-payment.5000.12.shorten')
    expect((el(root, 'loans-amount-amount') as HTMLInputElement).value).toBe('5000')
  })

  it('stops round up at the first amount that pays anything more', async () => {
    const root = await mount('#loans/1/compare?b=round-up.1100')
    expect(el(root, 'loans-step-down-target')?.hasAttribute('disabled')).toBe(true)
    await click(root, 'loans-step-up-target')
    expect(query().get('b')).toBe('round-up.1200')
    await click(root, 'loans-step-down-target')
    expect(query().get('b')).toBe('round-up.1100')
  })

  it('pays the round up amount every month, so it offers no way to pay less each month', async () => {
    const root = await mount('#loans/1/compare?b=round-up.1100.lower')
    expect(root.querySelector('[aria-label="What the extra payments do"]')).toBeNull()
    await click(root, 'loans-step-up-target')
    expect(query().get('b')).toBe('round-up.1200')
  })

  it('says why a round up that does not go over the installment changes nothing', async () => {
    const root = await mount('#loans/1/compare?b=round-up.900')
    expect(el(root, 'loans-compare-sentence')?.textContent).toBe(
      '€900 a month does not go over the €1,060.66 installment, so nothing extra goes to the loan.'
    )
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

describe('deleting a loan', () => {
  /** Pick Delete in the card's menu and confirm it. */
  async function deleteFromCard(root: HTMLElement, name: string) {
    root.querySelector<HTMLButtonElement>(`[aria-label="More actions for ${name}"]`)!.click()
    // The menu is portalled to <body>.
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-delete"]')!.click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    resolveConfirm(confirmRequests()[0]!.id, true)
    await settle()
  }

  it('drops a loan another tab deleted, and says it was already deleted', async () => {
    const root = await mount('#loans')
    expect(root.querySelectorAll('[data-test-id="loans-item"]')).toHaveLength(1)
    // Another tab deleted it: this page still lists it.
    listed = []
    vi.mocked(showToast).mockClear()

    await deleteFromCard(root, 'Mortgage')

    expect(vi.mocked(showToast).mock.calls).toEqual([['That loan was already deleted.', 'info']])
    expect(root.querySelectorAll('[data-test-id="loans-item"]')).toHaveLength(0)
  })

  it('says why a delete failed in the words it came with, or plainly when it has none', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = await mount('#loans')
    vi.mocked(showToast).mockClear()
    vi.mocked(apiDelete)
      .mockRejectedValueOnce(
        new ApiError(500, 'Something went wrong on our side. Try again in a moment.')
      )
      .mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'id')"))

    await deleteFromCard(root, 'Mortgage')
    await deleteFromCard(root, 'Mortgage')

    expect(vi.mocked(showToast).mock.calls).toEqual([
      ['Something went wrong on our side. Try again in a moment.', 'error'],
      ["Couldn't delete the loan. Try again.", 'error'],
    ])
    expect(root.querySelectorAll('[data-test-id="loans-item"]')).toHaveLength(1)
    quiet.mockRestore()
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

  it('drops an extra payment another tab removed, and says it was already removed', async () => {
    ;(listed[0].prepayments as unknown[]).push({ id: 7, month: 12, amount: 1000, note: '' })
    const root = await mount('#loans/1/extras')
    expect(root.querySelectorAll('[data-test-id="loans-extra-item"]')).toHaveLength(1)
    // Another tab removed it: this page still lists it.
    listed[0].prepayments = []
    vi.mocked(showToast).mockClear()

    root
      .querySelector<HTMLButtonElement>('[aria-label="Remove the extra payment with payment 12"]')!
      .click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    resolveConfirm(confirmRequests()[0]!.id, true)
    await settle()

    // Gone is what was asked: no error, and the page reads the loan again, without it.
    expect(vi.mocked(showToast).mock.calls).toEqual([
      ['That extra payment was already removed.', 'info'],
    ])
    expect(root.querySelectorAll('[data-test-id="loans-extra-item"]')).toHaveLength(0)
    expect(el(root, 'loans-extras-empty')).not.toBeNull()
  })

  it('says a failed add in plain words in the form, and keeps what was typed', async () => {
    vi.mocked(showToast).mockClear()
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('D1_ERROR: no such column: note'))
    const root = await mount('#loans/1/extras')
    const amount = el(root, 'loans-extra-amount') as HTMLInputElement
    amount.focus()
    amount.value = '10000'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    el(root, 'loans-extra-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
    await settle()

    expect(text(root, 'loans-extra-notice')).toBe("Couldn't save the extra payment. Try again.")
    expect(vi.mocked(showToast).mock.calls).toEqual([])
    expect((el(root, 'loans-extra-amount') as HTMLInputElement).value).toBe('10000')
  })

  it('marks the field the runtime refuses, under it, and sends nothing it can tell is wrong', async () => {
    vi.mocked(showToast).mockClear()
    vi.mocked(apiPost).mockClear()
    vi.mocked(apiPost).mockRejectedValueOnce(
      new ApiError(400, 'Enter an amount above zero.', { amount: 'Enter an amount above zero.' })
    )
    const root = await mount('#loans/1/extras')
    const amount = el(root, 'loans-extra-amount') as HTMLInputElement
    const submit = () =>
      el(root, 'loans-extra-form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )

    // Checked before sending: nothing goes out.
    submit()
    await settle()
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(amount)
    expect(vi.mocked(apiPost)).not.toHaveBeenCalled()

    // Refused by the runtime: marked the same way.
    amount.value = '10'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    submit()
    await settle()
    expect(vi.mocked(apiPost)).toHaveBeenCalledTimes(1)
    expect(amount.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(amount.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Enter an amount above zero.'
    )
    expect(text(root, 'loans-extra-notice')).toBe('')
    expect(vi.mocked(showToast).mock.calls).toEqual([])
  })

  it('changes a saved extra payment in place', async () => {
    vi.mocked(apiPut).mockClear()
    listed = [
      {
        ...structuredClone(LOAN),
        prepayments: [{ id: 7, month: 12, amount: 10000, note: 'Bonus' }],
      },
    ]
    const root = await mount('#loans/1/extras')
    await click(root, 'loans-extra-edit')
    const amount = el(root, 'loans-extra-edit-amount') as HTMLInputElement
    expect(document.activeElement).toBe(amount)
    expect(amount.value).toBe('10000')
    expect((el(root, 'loans-extra-edit-month') as HTMLSelectElement).value).toBe('12')
    expect((el(root, 'loans-extra-edit-note') as HTMLInputElement).value).toBe('Bonus')

    amount.value = '5000'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    const month = el(root, 'loans-extra-edit-month') as HTMLSelectElement
    month.value = '24'
    month.dispatchEvent(new Event('change', { bubbles: true }))
    el(root, 'loans-extra-edit-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
    await settle()

    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/loans/1/prepayments/7', {
      month: 24,
      amount: 5000,
      note: 'Bonus',
    })
    // The form closed, and the list came back from the store with the change.
    expect(el(root, 'loans-extra-edit-form')).toBeNull()
    expect(text(root, 'loans-extra-item')).toBe('Payment 24, Dec 1, 2027Bonus€5,000.00')
  })

  it('says a refused change in plain words in the form, and keeps it open', async () => {
    listed = [
      {
        ...structuredClone(LOAN),
        prepayments: [{ id: 7, month: 12, amount: 10000, note: 'Bonus' }],
      },
    ]
    vi.mocked(showToast).mockClear()
    // The Worker's own sentence for a refusal, then a failure that has no words for a person.
    vi.mocked(apiPut)
      .mockRejectedValueOnce(new ApiError(400, 'Enter an amount above zero.'))
      .mockRejectedValueOnce(new Error('D1_ERROR: no such column: note'))
    const root = await mount('#loans/1/extras')
    await click(root, 'loans-extra-edit')
    const notices: string[] = []
    for (let i = 0; i < 2; i++) {
      el(root, 'loans-extra-edit-form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      )
      await settle()
      notices.push(text(root, 'loans-extra-edit-notice'))
    }
    expect(notices).toEqual([
      'Enter an amount above zero.',
      "Couldn't update the extra payment. Try again.",
    ])
    expect(vi.mocked(showToast).mock.calls).toEqual([])
    expect(el(root, 'loans-extra-edit-form')).not.toBeNull()
  })

  it('leaves a saved extra payment as it was on Cancel, or on Escape', async () => {
    vi.mocked(apiPut).mockClear()
    listed = [
      {
        ...structuredClone(LOAN),
        prepayments: [{ id: 7, month: 12, amount: 10000, note: '' }],
      },
    ]
    const root = await mount('#loans/1/extras')
    await click(root, 'loans-extra-edit')
    const amount = el(root, 'loans-extra-edit-amount') as HTMLInputElement
    amount.value = '1'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    await click(root, 'loans-extra-cancel')
    expect(el(root, 'loans-extra-edit-form')).toBeNull()
    expect(text(root, 'loans-extra-item')).toBe('Payment 12, Dec 1, 2026€10,000.00')
    expect(document.activeElement).toBe(el(root, 'loans-extra-edit'))

    // Opened again, it starts from what is saved, not from what was typed before Cancel.
    await click(root, 'loans-extra-edit')
    expect((el(root, 'loans-extra-edit-amount') as HTMLInputElement).value).toBe('10000')
    el(root, 'loans-extra-edit-form')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    await settle()
    expect(el(root, 'loans-extra-edit-form')).toBeNull()
    expect(vi.mocked(apiPut)).not.toHaveBeenCalled()
  })
})

/**
 * A boat bought on credit two years ago: 24,000 at 6 % over 48 months, paid on the 10th from March
 * 2024. On 2025-12-15 the December payment is made, the 22nd. Figures from the closed form:
 * installment 563.64, owed after 22 payments 13,710.01, so 10,289.99 repaid, last payment in
 * February 2028.
 */
const BOAT = {
  id: 2,
  name: 'Test boat',
  principal: 24000,
  interest_rate: 6,
  term_months: 48,
  start_date: '2024-03-10',
  profile_id: 1,
  rate_periods: [],
  prepayments: [],
}

const cardOf = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll<HTMLElement>('[data-test-id="loans-item"]')].find((card) =>
    card.querySelector('[data-test-id="loans-item-name"]')?.textContent?.includes(name)
  )!
const toggleOf = (root: HTMLElement, name: string) =>
  cardOf(root, name).querySelector<HTMLButtonElement>('[data-test-id="loans-item-name"]')!
const charts = (root: HTMLElement) => root.querySelectorAll('[data-test-id="loans-item-chart"]')

async function openChart(root: HTMLElement, name: string) {
  toggleOf(root, name).click()
  await settle()
}

/** Every element has a box, as one a browser draws: jsdom gives none any. Undone after each test. */
let boxes: { mockRestore: () => void } | undefined
const drawn = () => {
  boxes = vi
    .spyOn(Element.prototype, 'getClientRects')
    .mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList)
}

const escape = (target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  )

describe('the chart under a card', () => {
  beforeEach(() => {
    listed = [structuredClone(LOAN), structuredClone(BOAT)]
  })

  it('opens straight under its card, today marked, with what is paid and what is left', async () => {
    const root = await mount('#loans')
    const toggle = toggleOf(root, 'Test boat')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(charts(root)).toHaveLength(0)

    await openChart(root, 'Test boat')

    const panel = el(root, 'loans-item-chart')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe(panel.id)
    // Next to its card in the grid, so it takes the whole row under the card's row.
    expect(cardOf(root, 'Test boat').nextElementSibling).toBe(panel)
    expect(text(root, 'loans-chart-sentence')).toBe(
      '22 of 48 payments made. The last is due in February 2028.'
    )
    // The principal repaid, the number the card's "% repaid" measures, not the money paid with
    // interest. Each figure's key is its mark on the line; months left has none.
    const terms = [...el(root, 'loans-chart-readout')!.querySelectorAll('dt')]
    expect(terms.map((dt) => dt.textContent?.trim())).toEqual([
      'Repaid so far',
      'Still owed',
      'Months left',
      'Last payment',
    ])
    expect(terms.map((dt) => dt.querySelector('svg') !== null)).toEqual([true, true, false, true])
    expect(text(root, 'loans-chart-repaid')).toBe('€10,289.99')
    expect(text(root, 'loans-chart-owed')).toBe('€13,710.01')
    expect(text(root, 'loans-chart-left')).toBe('26')
    expect(text(root, 'loans-chart-payoff')).toBe('Feb 2028')
    expect(el(panel, 'loans-payoff-today')).not.toBeNull()
    expect(el(panel, 'loans-payoff-end')?.hasAttribute('data-paid')).toBe(false)
    expect(window.location.hash).toBe('#loans')
  })

  it('closes on a second click, and shows one card’s chart at a time', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Mortgage')
    expect(text(root, 'loans-chart-sentence')).toBe(
      'The first payment is due in January 2026 and the last in December 2035.'
    )

    await openChart(root, 'Test boat')
    expect(charts(root)).toHaveLength(1)
    expect(toggleOf(root, 'Mortgage').getAttribute('aria-expanded')).toBe('false')
    expect(cardOf(root, 'Test boat').nextElementSibling).toBe(el(root, 'loans-item-chart'))

    await openChart(root, 'Test boat')
    expect(charts(root)).toHaveLength(0)
    expect(toggleOf(root, 'Test boat').getAttribute('aria-expanded')).toBe('false')
  })

  // A chart open higher up closes as the next one opens, and every card under it moves up by the
  // chart's height: the page scrolls by as much, so the card clicked stays under the pointer.
  it('keeps the card clicked where it was when a chart above it closes', async () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    // A card sits 300 px lower for each chart above it on the page.
    const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const above =
        this.tagName === 'ARTICLE'
          ? [...document.querySelectorAll('[data-test-id="loans-item-chart"]')].filter(
              (chart) => chart.compareDocumentPosition(this) & Node.DOCUMENT_POSITION_FOLLOWING
            ).length
          : 0
      const top = this.tagName === 'ARTICLE' ? 100 + 300 * above : 0
      return { top, bottom: top + 200, left: 0, right: 320, width: 320, height: 200 } as DOMRect
    })
    try {
      const root = await mount('#loans')
      await openChart(root, 'Mortgage')
      scrollBy.mockClear()
      await openChart(root, 'Test boat')
      expect(charts(root)).toHaveLength(1)
      expect(scrollBy).toHaveBeenCalledWith({ top: -300, behavior: 'auto' })

      // Nothing above it changes when its own chart closes: no scroll.
      scrollBy.mockClear()
      await openChart(root, 'Test boat')
      expect(scrollBy).not.toHaveBeenCalled()
    } finally {
      rects.mockRestore()
    }
  })

  it('closes on Escape and on its own Close, with focus back on the card', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    el(root, 'loans-chart-close')!.focus()
    escape(document.activeElement!)
    await settle()
    expect(charts(root)).toHaveLength(0)
    expect(document.activeElement).toBe(toggleOf(root, 'Test boat'))

    await openChart(root, 'Test boat')
    await click(root, 'loans-chart-close')
    expect(charts(root)).toHaveLength(0)
    expect(document.activeElement).toBe(toggleOf(root, 'Test boat'))
  })

  it('leaves Escape alone from elsewhere on the page', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    el(root, 'add-loan-btn')!.focus()
    escape(document.activeElement!)
    await settle()
    expect(charts(root)).toHaveLength(1)
  })

  // Pages stay in the document while another is shown: an Escape there is not this page's.
  it('leaves Escape alone while another page is shown', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    setPage('dashboard')
    await settle()
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(key)
    await settle()
    expect(key.defaultPrevented).toBe(false)
    setPage('loans')
    await settle()
    expect(charts(root)).toHaveLength(1)
  })

  it('brings the open card into view when Escape takes focus back to it', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Mortgage')
    // Focus on another card, the open one scrolled out of sight above it.
    toggleOf(root, 'Test boat').focus()
    scrolled = []
    escape(document.activeElement!)
    await settle()
    expect(charts(root)).toHaveLength(0)
    expect(document.activeElement).toBe(toggleOf(root, 'Mortgage'))
    expect(scrolled).toEqual([
      { chip: 'loans-item-name', options: { block: 'nearest', behavior: 'smooth' } },
    ])
  })

  // Switched away and back from another page: Loans reads its list once, on its return, and finds
  // the loan there again. Its chart comes back shut.
  it('closes on a profile switch, and stays closed on switching back', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    setPage('dashboard')
    try {
      setCurrentProfile({ id: 2, name: 'Them', created_at: '2025-01-01' })
      bumpProfileVersion()
      await settle()
      setCurrentProfile({ id: 1, name: 'Me', created_at: '2025-01-01' })
      bumpProfileVersion()
      await settle()
      setPage('loans')
      await settle()
      expect(cardOf(root, 'Test boat')).toBeDefined()
      expect(charts(root)).toHaveLength(0)
      expect(toggleOf(root, 'Test boat').getAttribute('aria-expanded')).toBe('false')
    } finally {
      setCurrentProfile(null)
    }
  })

  // Deleted here or in another tab, the loan takes its open chart with it: should the same loan
  // come back into the list (another profile's view of the household, say), it comes back shut.
  it('forgets the open chart once a list read no longer has its loan', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    const boat = listed.find((loan) => loan.name === 'Test boat')!
    listed = listed.filter((loan) => loan !== boat)
    invalidateForRequest('/api/loans/2', 'DELETE', true)
    await settle()
    expect(cardOf(root, 'Test boat')).toBeUndefined()

    listed = [...listed, boat]
    invalidateForRequest('/api/loans', 'POST', true)
    await settle()
    expect(cardOf(root, 'Test boat')).toBeDefined()
    expect(charts(root)).toHaveLength(0)
  })

  // With focus nowhere, as a click on a menu's or a dialog's padding leaves it in Safari.
  it('leaves Escape to the card menu when the menu is open', async () => {
    drawn()
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    el(cardOf(root, 'Test boat'), 'loans-item-menu')!.click()
    await settle()
    expect(document.querySelector('[data-test-id="loans-menu"]')).not.toBeNull()
    ;(document.activeElement as HTMLElement).blur()

    escape()
    await settle()
    expect(document.querySelector('[data-test-id="loans-menu"]')).toBeNull()
    expect(charts(root)).toHaveLength(1)
  })

  // Some dialogs stay in the page while shut (Transactions' entry form, the subscription scan),
  // still saying aria-modal, and so does any dialog on a page that is not shown. Neither has a box:
  // jsdom gives no element one, so this dialog is as a browser draws a shut one.
  it('takes Escape back from a dialog that is in the page but not shown', async () => {
    const shut = document.createElement('div')
    shut.setAttribute('role', 'dialog')
    shut.setAttribute('aria-modal', 'true')
    try {
      document.body.appendChild(shut)
      const root = await mount('#loans')
      await openChart(root, 'Test boat')
      escape(toggleOf(root, 'Test boat'))
      await settle()
      expect(charts(root)).toHaveLength(0)
    } finally {
      shut.remove()
    }
  })

  it('leaves Escape to a dialog open over the page', async () => {
    drawn()
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    el(cardOf(root, 'Test boat'), 'loans-item-menu')!.click()
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-edit"]')!.click()
    await settle()
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    ;(document.activeElement as HTMLElement).blur()

    escape()
    await settle()
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    expect(charts(root)).toHaveLength(1)
  })

  it('keeps the same chart on screen when the list is read again', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    const panel = el(root, 'loans-item-chart')
    // Another write reads the list again: every loan comes back as a new object.
    invalidateForRequest('/api/loans/1', 'PUT', true)
    await settle()
    expect(el(root, 'loans-item-chart')).toBe(panel)
    expect(toggleOf(root, 'Test boat').getAttribute('aria-expanded')).toBe('true')
  })

  it('goes when its loan is deleted', async () => {
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    el(cardOf(root, 'Test boat'), 'loans-item-menu')!.click()
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-delete"]')!.click()
    await vi.waitFor(() => {
      expect(confirmRequests()).toHaveLength(1)
    })
    resolveConfirm(confirmRequests()[0]!.id, true)
    await settle()
    expect(cardOf(root, 'Test boat')).toBeUndefined()
    expect(charts(root)).toHaveLength(0)
  })

  it('marks extra payments made and planned, and counts the ones made', async () => {
    listed = [
      {
        ...structuredClone(BOAT),
        prepayments: [
          { id: 1, month: 6, amount: 2000 },
          { id: 2, month: 30, amount: 1500 },
        ],
      },
    ]
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    expect(text(root, 'loans-chart-sentence')).toBe(
      '22 of 41 payments made, and €2,000 paid extra. The last is due in July 2027.'
    )
    const marks = [...root.querySelectorAll('[data-test-id="loans-payoff-extra"]')]
    expect(marks.map((mark) => mark.getAttribute('data-made'))).toEqual(['true', 'false'])
    expect(marks.map((mark) => mark.querySelector('title')?.textContent)).toEqual([
      'Extra payment of €2,000.00 with payment 6, Aug 2024',
      'Planned extra payment of €1,500.00 with payment 30, Aug 2026',
    ])
  })

  it('has no today on a loan paid off, and marks its end as reached', async () => {
    listed = [{ ...structuredClone(LOAN), start_date: '2010-01-01' }]
    const root = await mount('#loans')
    await openChart(root, 'Mortgage')
    expect(text(root, 'loans-chart-sentence')).toBe(
      'All 120 payments made. Paid off in December 2019.'
    )
    expect(text(root, 'loans-chart-left')).toBe('0')
    expect(el(root, 'loans-payoff-today')).toBeNull()
    expect(el(root, 'loans-payoff-end')?.hasAttribute('data-paid')).toBe(true)
  })

  it('counts payments instead of months when the start date cannot be read', async () => {
    listed = [{ ...structuredClone(BOAT), start_date: '' }]
    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    expect(text(root, 'loans-chart-sentence')).toBe(
      '48 payments as planned. The start date cannot be read, so the chart counts payments instead of months.'
    )
    expect(el(root, 'loans-payoff-today')).toBeNull()
  })

  it('reads a loan the list gives without its details, and offers Try again when that fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    // As the Worker lists them: no rate periods or extra payments on the row.
    const row: Record<string, unknown> = structuredClone(BOAT)
    delete row.rate_periods
    delete row.prepayments
    listed = [row]
    vi.mocked(apiGet).mockClear()
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(async () => structuredClone(BOAT))

    const root = await mount('#loans')
    await openChart(root, 'Test boat')
    expect(vi.mocked(apiGet)).toHaveBeenCalledWith('/api/loans/2')
    expect(el(root, 'loans-chart-error')).not.toBeNull()
    expect(el(root, 'loans-chart-readout')).toBeNull()

    el(root, 'loans-chart-error')!.querySelector('button')!.click()
    await settle()
    expect(el(root, 'loans-chart-error')).toBeNull()
    expect(text(root, 'loans-chart-owed')).toBe('€13,710.01')
    quiet.mockRestore()
  })
})

describe('the card menu', () => {
  beforeEach(() => {
    listed = [structuredClone(BOAT)]
  })

  const labels = () =>
    [...document.querySelectorAll('[data-test-id="loans-menu"] [role="menuitem"]')].map(
      (item) => item.textContent
    )

  async function openMenu(root: HTMLElement, name: string) {
    el(cardOf(root, name), 'loans-item-menu')!.click()
    await settle()
  }

  it('offers an extra payment, every payment, Edit and Delete, and keeps What if on the card', async () => {
    const root = await mount('#loans')
    await openMenu(root, 'Test boat')
    expect(labels()).toEqual(['Add an extra payment', 'See every payment', 'Edit', 'Delete'])
    expect(el(cardOf(root, 'Test boat'), 'loans-item-what-if')).not.toBeNull()
  })

  it('has no extra payment for a loan paid off, and only the payments for one it cannot change', async () => {
    listed = [
      { ...structuredClone(BOAT), start_date: '2010-01-01' },
      { ...structuredClone(LOAN), id: 3, name: 'Shared van', profile_id: 99 },
    ]
    const root = await mount('#loans')
    await openMenu(root, 'Test boat')
    expect(labels()).toEqual(['See every payment', 'Edit', 'Delete'])
    escape(document.activeElement!)
    await settle()

    await openMenu(root, 'Shared van')
    expect(labels()).toEqual(['See every payment'])
  })

  it('opens Extra payments with the amount ready to type', async () => {
    const root = await mount('#loans')
    await openMenu(root, 'Test boat')
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-add-extra"]')!.click()
    await settle()
    expect(window.location.hash).toBe('#loans/2/extras')
    expect(document.activeElement).toBe(el(root, 'loans-extra-amount'))
  })

  it('focuses nothing later when another tab was picked while the loan loaded', async () => {
    const row: Record<string, unknown> = structuredClone(BOAT)
    delete row.rate_periods
    delete row.prepayments
    listed = [row]
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(apiGet).mockImplementationOnce(async () => {
      await held
      return structuredClone(BOAT)
    })
    const root = await mount('#loans')
    await openMenu(root, 'Test boat')
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-add-extra"]')!.click()
    await settle()
    await click(root, 'loans-tab-schedule')
    release()
    await settle()

    await click(root, 'loans-tab-extras')
    expect(el(root, 'loans-extra-amount')).not.toBeNull()
    expect(document.activeElement).not.toBe(el(root, 'loans-extra-amount'))
  })

  it('opens every payment on the schedule', async () => {
    const root = await mount('#loans')
    await openMenu(root, 'Test boat')
    document.querySelector<HTMLButtonElement>('[data-test-id="loans-item-schedule"]')!.click()
    await settle()
    expect(window.location.hash).toBe('#loans/2/schedule')
  })
})
