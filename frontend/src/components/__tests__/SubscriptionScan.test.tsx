/**
 * The subscription scan's Add. A price the bill rules refuse is marked under its row, in their
 * words, before anything is sent. With the runtime refusing an entry, the scan keeps it selected so
 * that it can be fixed and added again: a refused price is marked under its row, and any other
 * reason is said in the notice, naming it. It said "Some subscriptions could not be added",
 * whatever the reason, and named none; then the reason in a toast, with nothing marked.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- the one stylesheet named below */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BILL_MESSAGES } from '../../../../shared/billSchema'
import { ApiError } from '../../core/apiError'
import { orientationFacts } from '../../core/orientation'
import { dayText } from '../../utils/dayText'
import { localToday } from '../../utils/period'
import { SubscriptionScanPanel } from '../SubscriptionScan'

const apiMocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../core/api', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return { ...apiMocks, listRows: real.listRows, getLocalCurrency: real.getLocalCurrency }
})

type Exposed = Parameters<NonNullable<Parameters<typeof SubscriptionScanPanel>[0]['expose']>>[0]

let host: HTMLDivElement
let dispose: (() => void) | undefined

/** A charge `days` ago, as the transactions list answers one. */
function charge(description: string, amount: number, days: number) {
  const date = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  return { description, amount, date, type: 'expense', currency: 'EUR' }
}

beforeEach(() => {
  apiMocks.apiGet.mockReset()
  apiMocks.apiPost.mockReset()
  apiMocks.showToast.mockReset()
  apiMocks.apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/transactions') {
      return [
        ...[95, 65, 35, 5].map((days) => charge('NETFLIX.COM AMSTERDAM', 13.99, days)),
        ...[95, 65, 35, 5].map((days) => charge('Spotify P0FF8B1C34', 10.99, days)),
      ]
    }
    return []
  })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

async function mountScan(
  props: Partial<Parameters<typeof SubscriptionScanPanel>[0]> = {}
): Promise<Exposed> {
  let exposed: Exposed | undefined
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <SubscriptionScanPanel
        active={() => true}
        expose={(api) => {
          exposed = api
        }}
        {...props}
      />
    ),
    host
  )
  await vi.waitFor(() => {
    expect(exposed?.chosenCount()).toBe(2)
  })
  return exposed!
}

/** The price field of the row for `name`. */
const price = (name: string) =>
  host.querySelector<HTMLInputElement>(`[data-name="${name}"] [data-test-id="sub-scan-price"]`)!

const describedBy = (element: HTMLElement): string =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const notice = () => host.querySelector('[data-test-id="sub-scan-notice"]')?.textContent ?? ''

function type(element: HTMLInputElement, value: string) {
  element.focus()
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

const errorToasts = () => apiMocks.showToast.mock.calls.filter(([, kind]) => kind === 'error')

describe('adding what the scan found', () => {
  it("marks a price the runtime refuses under its row, in the runtime's words, and keeps it selected", async () => {
    apiMocks.apiPost.mockImplementation(async (_url: string, body: { name: string }) => {
      if (body.name === 'Netflix') {
        throw new ApiError(400, BILL_MESSAGES.amountCents, { amount: BILL_MESSAGES.amountCents })
      }
      return { id: 1 }
    })
    const scan = await mountScan()

    expect(await scan.addSelected()).toBe(1)

    expect(describedBy(price('Netflix'))).toBe(BILL_MESSAGES.amountCents)
    expect(price('Netflix').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(price('Netflix'))
    expect(errorToasts()).toEqual([])
    expect(apiMocks.showToast).toHaveBeenCalledWith('1 subscription added', 'success')
    expect(scan.chosenCount()).toBe(1)
  })

  it('names a subscription refused for what no price can fix, in the notice', async () => {
    apiMocks.apiPost.mockImplementation(async (_url: string, body: { name: string }) => {
      if (body.name === 'Spotify') {
        throw new ApiError(400, BILL_MESSAGES.category, { category_id: BILL_MESSAGES.category })
      }
      return { id: 1 }
    })
    const scan = await mountScan()

    expect(await scan.addSelected()).toBe(1)

    expect(notice()).toBe(`Couldn't add "Spotify". ${BILL_MESSAGES.category}`)
    expect(price('Spotify').getAttribute('aria-invalid')).toBeNull()
    expect(errorToasts()).toEqual([])
    expect(scan.chosenCount()).toBe(1)
  })

  it('marks a price of zero and one with letters before sending anything, and focuses the first', async () => {
    const scan = await mountScan()
    type(price('Netflix'), '0')
    type(price('Spotify'), 'ten')

    expect(await scan.addSelected()).toBe(0)

    expect(describedBy(price('Netflix'))).toBe(BILL_MESSAGES.amountPositive)
    expect(describedBy(price('Spotify'))).toBe(BILL_MESSAGES.amountNumber)
    expect(document.activeElement).toBe(price('Netflix'))
    expect(apiMocks.apiPost).not.toHaveBeenCalled()
    expect(apiMocks.showToast).not.toHaveBeenCalled()
    expect(scan.chosenCount()).toBe(2)
  })

  it('reads a comma for the cents, and adds every chosen row', async () => {
    const scan = await mountScan()
    type(price('Netflix'), '15,49')

    expect(await scan.addSelected()).toBe(2)

    expect(apiMocks.apiPost).toHaveBeenCalledWith(
      '/api/bills',
      expect.objectContaining({ name: 'Netflix', amount: 15.49, type: 'subscription' })
    )
    expect(apiMocks.showToast).toHaveBeenCalledWith('2 subscriptions added', 'success')
    expect(scan.chosenCount()).toBe(0)
  })

  it('keeps its controls enabled while it adds, with focus where Enter left it', async () => {
    let release = (): void => undefined
    apiMocks.apiPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ id: 1 })
          }
        })
    )
    apiMocks.apiPost.mockResolvedValue({ id: 2 })
    const scan = await mountScan()
    const form = host.querySelector('form')!
    const box = host.querySelector<HTMLInputElement>(
      '[data-name="Netflix"] [data-test-id="sub-scan-row-checkbox"]'
    )!
    const period = host.querySelector<HTMLSelectElement>(
      '[data-name="Netflix"] [data-test-id="sub-scan-frequency"]'
    )!
    const rescan = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Rescan')!

    // Enter in a price submits the form; jsdom has no implicit submission, so this stands for it.
    price('Netflix').focus()
    form.requestSubmit()
    await vi.waitFor(() => {
      expect(apiMocks.apiPost).toHaveBeenCalledTimes(1)
    })

    // A disabled control drops the focus to the page: nothing is disabled while it adds.
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(price('Netflix').disabled).toBe(false)
    expect(document.activeElement).toBe(price('Netflix'))
    expect(period.disabled).toBe(false)
    expect(box.disabled).toBe(false)
    expect(rescan.disabled).toBe(false)
    // The add took the rows it was pressed on: a tick, or a rescan that would reset the rows under
    // it, does nothing until it is done.
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(rescan.getAttribute('aria-disabled')).toBe('true')
    const scans = apiMocks.apiGet.mock.calls.length
    box.click()
    rescan.click()
    expect(box.checked).toBe(true)
    expect(scan.chosenCount()).toBe(2)
    expect(apiMocks.apiGet).toHaveBeenCalledTimes(scans)

    release()
    await vi.waitFor(() => {
      expect(scan.chosenCount()).toBe(0)
    })
    expect(apiMocks.apiPost).toHaveBeenCalledTimes(2)
    expect(apiMocks.showToast).toHaveBeenCalledWith('2 subscriptions added', 'success')
    expect(form.getAttribute('aria-busy')).toBeNull()
    expect(rescan.getAttribute('aria-disabled')).toBeNull()
  })

  it('takes the mark away when its row is left out', async () => {
    const scan = await mountScan()
    type(price('Netflix'), '0')
    await scan.addSelected()
    expect(price('Netflix').getAttribute('aria-invalid')).toBe('true')

    host
      .querySelector<HTMLInputElement>(
        '[data-name="Netflix"] [data-test-id="sub-scan-row-checkbox"]'
      )!
      .click()

    expect(price('Netflix').getAttribute('aria-invalid')).toBeNull()
    expect(notice()).toBe('')
    expect(await scan.addSelected()).toBe(1)
  })
})

describe('what the scan ticks', () => {
  it('is what Getting started counts: not a bill yet, more than a guess, inside 750 days', async () => {
    const rows = [
      ...[95, 65, 35, 5].map((days) => charge('NETFLIX.COM AMSTERDAM', 13.99, days)),
      // One charge at no known price: a guess.
      charge('SPOTIFY', 4.21, 10),
      // Three months running, but more than 750 days ago.
      ...[860, 830, 800].map((days) => charge('DISNEY PLUS', 8.99, days)),
    ]
    apiMocks.apiGet.mockImplementation(async (url: string) =>
      url === '/api/transactions' ? rows : []
    )
    let exposed: Exposed | undefined
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(
      () => (
        <SubscriptionScanPanel
          active={() => true}
          expose={(api) => {
            exposed = api
          }}
        />
      ),
      host
    )
    await vi.waitFor(() => {
      expect(host.querySelector('[data-name="Spotify"]')).not.toBeNull()
    })
    const ticked = (name: string) =>
      host.querySelector<HTMLInputElement>(
        `[data-name="${name}"] [data-test-id="sub-scan-row-checkbox"]`
      )?.checked
    expect(
      [...host.querySelectorAll('[data-name]')].map((row) => row.getAttribute('data-name'))
    ).toEqual(['Netflix', 'Spotify'])
    expect(ticked('Netflix')).toBe(true)
    expect(ticked('Spotify')).toBe(false)

    const facts = orientationFacts(
      {
        today: localToday(),
        evaluation: { trackedMonths: [] },
        transactions: rows.map((r) => ({
          ...r,
          type: 'expense' as const,
          category_id: null,
          reconciled: false,
        })),
        budgets: [],
        bills: [],
        categories: [],
        loans: [],
      },
      Date.now()
    )
    expect(facts.subscriptionsSpotted).toBe(1)
    expect(exposed?.chosenCount()).toBe(facts.subscriptionsSpotted)
  })
})

describe('regular payments it has no name for', () => {
  const GYM = 'Kraftraum Beispielstadt'
  const LANDLORD = 'Hausverwaltung Muster GmbH'
  const categories = [
    { id: 1, name: 'Housing', type: 'expense', kind: 'housing', parent_id: null },
    { id: 4, name: 'Sport', type: 'expense', kind: null, parent_id: null },
    { id: 8, name: 'Transfers', type: 'expense', kind: null, parent_id: null },
  ]
  const rows = [
    ...[95, 65, 35, 5].map((days) => ({
      ...charge('MITGLIEDSBEITRAG', 29.9, days),
      beneficiary: GYM,
      category_id: 4,
    })),
    ...[95, 65, 35, 5].map((days) => ({
      ...charge('MIETE', 850, days),
      beneficiary: LANDLORD,
      category_id: 1,
    })),
    // Filed under Transfers, where the import puts a transfer it could not match: not a payment.
    ...[95, 65, 35, 5].map((days) => ({
      ...charge('DAUERAUFTRAG', 200, days),
      beneficiary: 'Tagesgeld Beispielbank',
      category_id: 8,
    })),
  ]

  it('proposes them by payee, and adds each in its category, a home as a bill', async () => {
    apiMocks.apiGet.mockImplementation(async (url: string) =>
      url === '/api/transactions' ? rows : url === '/api/categories' ? categories : []
    )
    apiMocks.apiPost.mockResolvedValue({ id: 1 })
    const scan = await mountScan()

    const label = (name: string) =>
      host.querySelector(`[data-name="${name}"] [data-test-id="sub-scan-row-checkbox"]`)
        ?.parentElement?.textContent ?? ''
    expect(label(GYM)).toContain(`Regular payment to ${GYM}`)
    expect(label(LANDLORD)).toContain(`Regular payment to ${LANDLORD}`)
    expect(
      [...host.querySelectorAll('[data-name]')].map((row) => row.getAttribute('data-name'))
    ).toEqual([LANDLORD, GYM])

    expect(await scan.addSelected()).toBe(2)

    expect(apiMocks.apiPost).toHaveBeenCalledWith(
      '/api/bills',
      expect.objectContaining({ name: GYM, amount: 29.9, type: 'subscription', category_id: 4 })
    )
    expect(apiMocks.apiPost).toHaveBeenCalledWith(
      '/api/bills',
      expect.objectContaining({ name: LANDLORD, amount: 850, type: 'bill', category_id: 1 })
    )
  })

  it('is what Getting started counts', async () => {
    apiMocks.apiGet.mockImplementation(async (url: string) =>
      url === '/api/transactions' ? rows : url === '/api/categories' ? categories : []
    )
    const scan = await mountScan()
    const facts = orientationFacts(
      {
        today: localToday(),
        evaluation: { trackedMonths: [] },
        transactions: rows.map((r) => ({ ...r, type: 'expense' as const, reconciled: false })),
        budgets: [],
        bills: [],
        categories,
        loans: [],
      },
      Date.now()
    )
    expect(facts.subscriptionsSpotted).toBe(2)
    expect(scan.chosenCount()).toBe(facts.subscriptionsSpotted)
  })
})

describe('in the setup wizard', () => {
  const rescan = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Rescan')

  it('adds without a toast, and still tells the wizard how many went in', async () => {
    apiMocks.apiPost.mockResolvedValue({ id: 1 })
    const onAdded = vi.fn()
    const scan = await mountScan({ quiet: true, hideRescan: true, onAdded })

    expect(await scan.addSelected()).toBe(2)

    expect(apiMocks.showToast).not.toHaveBeenCalled()
    expect(onAdded).toHaveBeenCalledWith(2)
    expect(rescan()).toBeUndefined()
  })

  it('keeps the toast and Rescan everywhere else', async () => {
    apiMocks.apiPost.mockResolvedValue({ id: 1 })
    const scan = await mountScan()

    await scan.addSelected()

    expect(apiMocks.showToast).toHaveBeenCalledWith('2 subscriptions added', 'success')
    expect(rescan()).toBeDefined()
  })
})

/** `css` without its media queries: what is left applies to every pointer and screen. */
function withoutMediaQueries(css: string): string {
  let out = ''
  let at = 0
  for (let start = css.indexOf('@media'); start >= 0; start = css.indexOf('@media', at)) {
    out += css.slice(at, start)
    let depth = 0
    let i = css.indexOf('{', start)
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    at = i + 1
  }
  return out + css.slice(at)
}

describe('what a row says', () => {
  // 3 Nov test run: "4.5" and "48.1" in the price fields, "last 2026-10-18", and at 1280 the
  // confidence cut to "High con...".
  beforeEach(() => {
    apiMocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/transactions') {
        return [
          ...[95, 65, 35, 5].map((days) => charge('NETFLIX.COM AMSTERDAM', 4.5, days)),
          ...[95, 65, 35, 5].map((days) => charge('Spotify P0FF8B1C34', 48.1, days)),
        ]
      }
      return []
    })
  })

  it('writes each price as money is written, with its cents', async () => {
    await mountScan()
    expect(price('Netflix').value).toBe('4.50')
    expect(price('Spotify').value).toBe('48.10')
  })

  // Review M13 and D4: "3 charges · last 2026-10-15" here, and "1 Aug to 28 Oct" on the step
  // before. One way to write a day: "3 charges, last 15 Oct".
  it("says the charges and the last one's day as setup's import step writes a day", async () => {
    await mountScan()
    const last = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
    const meta = host.querySelector('[data-name="Netflix"] [data-test-id="sub-scan-meta"]')!
    expect(meta.textContent).toBe(`4 charges, last ${dayText(last)} · High confidence`)
    expect(meta.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2},/)
  })

  // Review D4: at 1280 the ticks were 16 x 16 and the price fields 64 x 20; a phone's rows were
  // already 44 px. With a mouse too, a row's tick and name, its price and its period are 44 px tall.
  it('makes a row 44 px tall to tick, price and time with a mouse too', () => {
    const css = withoutMediaQueries(
      readFileSync(resolve(__dirname, '../SubscriptionScan.module.css'), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        ''
      )
    )
    /** The declarations of the first rule for `selector` alone. */
    const rule = (selector: string) => {
      const at = css.indexOf(`\n${selector} {`)
      return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
    }
    expect(rule('.row-main')).toMatch(/min-height:\s*44px/)
    expect(rule('.price-wrap')).toMatch(/min-height:\s*44px/)
    expect(rule('.price')).toMatch(/min-height:\s*42px/)
    expect(rule('.freq')).toMatch(/min-height:\s*44px/)
  })

  it('wraps the line instead of cutting it short, keeping each part whole', () => {
    const css = readFileSync(resolve(__dirname, '../SubscriptionScan.module.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )
    const meta = /\.meta\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(meta).not.toMatch(/white-space:\s*nowrap|text-overflow|overflow:\s*hidden/)
    expect(/\.meta-part\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/white-space:\s*nowrap/)
  })
})

// Review M13: a catalogue name stood alone ("Gym membership" for a statement's "Example Gym"), and
// a Revolut transfer read "Regular payment to To Example Landlord".
describe("a row's name", () => {
  beforeEach(() => {
    apiMocks.apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/transactions') {
        return [
          ...[95, 65, 35, 5].map((days) => charge('Example Gym', 29, days)),
          ...[95, 65, 35, 5].map((days) => charge('NETFLIX.COM AMSTERDAM', 13.99, days)),
          ...[94, 64, 34, 4].map((days) => charge('To Example Landlord', 650, days)),
        ]
      }
      return []
    })
  })

  async function mountRows(): Promise<void> {
    host = document.createElement('div')
    document.body.appendChild(host)
    dispose = render(() => <SubscriptionScanPanel active={() => true} />, host)
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-test-id="sub-scan-row"]').length).toBe(3)
    })
  }

  const nameOf = (name: string) =>
    host
      .querySelector(`[data-name="${name}"] [data-test-id="sub-scan-name"]`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim()

  it("keeps the statement's name beside a catalogue name, only where it says more", async () => {
    await mountRows()
    expect(nameOf('Gym membership')).toBe('Gym membership (Example Gym)')
    // "NETFLIX.COM AMSTERDAM" says nothing "Netflix" does not.
    expect(nameOf('Netflix')).toMatch(/^Netflix(?! \()/)
    expect(
      host.querySelector('[data-name="Netflix"] [data-test-id="sub-scan-statement-name"]')
    ).toBeNull()
  })

  it('names a Revolut transfer by its payee, without the "To "', async () => {
    await mountRows()
    expect(nameOf('Example Landlord')).toBe('Regular payment to Example Landlord')
  })
})
