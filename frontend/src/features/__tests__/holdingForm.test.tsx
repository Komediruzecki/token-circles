/**
 * The Portfolio page's "Add Holding" and "Edit Holding" dialog, run against the real local-first
 * router on fake-indexeddb.
 *
 * A refused save said "Please fill all required fields" or "Failed to save holding" in a toast,
 * with nothing in the dialog marked. Now the dialog checks the values with the rules both runtimes
 * run (shared/holdingSchema.ts) and marks the field in their words. The one check the dialog cannot
 * make is a merge's: the merged shares are an edit of the holding already there, and the runtime
 * refuses one past one trillion at the shares field.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOLDING_MESSAGES as M } from '../../../../shared/holdingSchema'
import { formatCurrency } from '../../core/api'
import { setCurrentProfile, setPage, setProfiles } from '../../core/appStore'
import { confirmRequests, resolveConfirm } from '../../core/confirmStore'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { getDB } from '../../core/storage/idb'
import { removeToast, toasts } from '../../core/toastStore'

type Row = Record<string, unknown>

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeAll(async () => {
  await Promise.all([import('../Portfolio'), import('../../core/storage/localApiRouter')])
}, 120_000)

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('localCurrency', 'EUR')
  __resetDataVersionsForTest()
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01T00:00:00.000Z' })
  await db.put('settings', { key: 'currency', value: 'EUR' })
  for (const toast of toasts()) removeToast(toast.id)
  for (const request of confirmRequests()) resolveConfirm(request.id, false)

  setProfiles([{ id: 1, name: 'Me' }] as never)
  setCurrentProfile({ id: 1, name: 'Me' } as never)
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
  setPage('portfolio')
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.unstubAllGlobals()
})

/** A holding stored before the page opens, as an older version may have stored it. */
async function seed(values: Row): Promise<void> {
  await (
    await getDB()
  ).add('portfolioHoldings', {
    profile_id: 1,
    ticker: 'EXMPL',
    shares: 10,
    purchase_price: 100,
    purchase_date: '2026-02-10',
    notes: '',
    created_at: '2026-02-10T09:00:00.000Z',
    ...values,
  } as never)
}

async function showPage(): Promise<void> {
  const { default: Portfolio } = await import('../Portfolio')
  dispose = render(() => <Portfolio />, host)
  await vi.waitFor(() => {
    expect(host.textContent).not.toContain('Loading portfolio...')
  })
}

async function openAdd(): Promise<void> {
  await showPage()
  host.querySelector<HTMLButtonElement>('[data-test-id="add-holding-btn"]')!.click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

async function openEdit(): Promise<void> {
  await showPage()
  await vi.waitFor(() => {
    expect(host.querySelector('[data-test-id="portfolio-holding-row"]')).not.toBeNull()
  })
  host
    .querySelector<HTMLButtonElement>(
      '[data-test-id="portfolio-holding-row"] button[title="Edit"]'
    )!
    .click()
  await vi.waitFor(() => {
    expect(dialog()).not.toBeNull()
  })
}

const dialog = () => host.querySelector<HTMLElement>('[data-test-id="portfolio-modal"]')

/** The control under the label that starts with `text`, as a person finds it. */
function field(text: string): HTMLInputElement {
  const label = Array.from(dialog()!.querySelectorAll('label')).find((l) =>
    l.textContent?.trim().startsWith(text)
  )
  if (!label) throw new Error(`no ${text} field`)
  return label.parentElement!.querySelector<HTMLInputElement>('input')!
}

function type(el: HTMLInputElement, value: string): void {
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function submit(): void {
  dialog()!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
}

const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ')

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function holdings(): Promise<Row[]> {
  return (await (await getDB()).getAll('portfolioHoldings')) as Row[]
}

/** Answer the merge question the dialog asks. */
async function answerMerge(merge: boolean): Promise<string> {
  await vi.waitFor(() => {
    expect(confirmRequests()).toHaveLength(1)
  })
  const [request] = confirmRequests()
  resolveConfirm(request.id, merge)
  return request.message
}

const failureToasts = () =>
  toasts()
    .filter((t) => t.type === 'error' || t.type === 'warning')
    .map((t) => t.message)
const successToasts = () =>
  toasts()
    .filter((t) => t.type === 'success')
    .map((t) => t.message)

/** Fill in a buy of `ticker`. */
function fillBuy(ticker: string, shares: string, price: string, date: string): void {
  type(field('Ticker Symbol'), ticker)
  type(field('Shares'), shares)
  type(field('Purchase Price'), price)
  type(field('Purchase Date'), date)
}

describe('adding a holding', () => {
  it('marks a blank ticker, shares, price and date in their words, focuses the ticker, and sends nothing', async () => {
    await openAdd()

    submit()
    await settle()

    const ticker = field('Ticker Symbol')
    expect(ticker.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(ticker)).toBe(M.ticker)
    expect(describedBy(field('Shares'))).toBe(M.shares)
    expect(describedBy(field('Purchase Price'))).toBe(M.price)
    expect(describedBy(field('Purchase Date'))).toBe(M.date)
    expect(document.activeElement).toBe(ticker)
    expect(await holdings()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('marks shares of zero and a price that is not a number, under each', async () => {
    await openAdd()
    fillBuy('sampl', '0', 'cheap', '2026-03-02')

    submit()
    await settle()

    expect(describedBy(field('Shares'))).toBe(M.sharesPositive)
    expect(describedBy(field('Purchase Price'))).toBe(M.priceNumber)
    expect(document.activeElement).toBe(field('Shares'))
    expect(await holdings()).toEqual([])
    expect(failureToasts()).toEqual([])
  })

  it('takes the mark away once the field is fixed', async () => {
    await openAdd()
    submit()
    await settle()

    type(field('Ticker Symbol'), 'sampl')

    expect(field('Ticker Symbol').getAttribute('aria-invalid')).toBeNull()
    expect(describedBy(field('Shares'))).toBe(M.shares)
  })

  it('adds a holding with a comma for the decimals, says so, and closes', async () => {
    await openAdd()
    fillBuy('sampl', '2,5', '101,25', '2026-03-02')
    expect(field('Ticker Symbol').value).toBe('SAMPL')

    submit()

    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({
          ticker: 'SAMPL',
          shares: 2.5,
          purchase_price: 101.25,
          purchase_date: '2026-03-02',
        }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Added "SAMPL" to your portfolio.'])
    expect(failureToasts()).toEqual([])
  })
})

describe('a buy of a ticker already held', () => {
  it('merges into that holding at the average price, rounded, from the earliest date', async () => {
    await seed({})
    await openAdd()
    fillBuy('exmpl', '2', '110', '2026-01-05')

    submit()
    const question = await answerMerge(true)

    expect(question).toContain('You already hold 10 shares of EXMPL')
    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({
          ticker: 'EXMPL',
          shares: 12,
          purchase_price: 101.66666667,
          purchase_date: '2026-01-05',
        }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual([
      `Merged the buy into "EXMPL": 12 shares at an average of ${formatCurrency(101.66666667)}.`,
    ])
  })

  it('is added as a holding of its own when the merge is declined', async () => {
    await seed({})
    await openAdd()
    fillBuy('exmpl', '2', '110', '2026-03-02')

    submit()
    await answerMerge(false)

    await vi.waitFor(async () => {
      expect((await holdings()).map((h) => h.shares)).toEqual([10, 2])
    })
    expect(successToasts()).toEqual(['Added "EXMPL" to your portfolio.'])
  })

  it("marks the shares when the runtime refuses the merged total, in the runtime's words", async () => {
    await seed({ shares: 600_000_000_000 })
    await openAdd()
    fillBuy('exmpl', '500000000000', '110', '2026-03-02')

    submit()
    await answerMerge(true)

    await vi.waitFor(() => {
      expect(describedBy(field('Shares'))).toBe(M.sharesMax)
    })
    expect(field('Shares').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Shares'))
    expect(dialog()).not.toBeNull()
    expect((await holdings()).map((h) => h.shares)).toEqual([600_000_000_000])
    expect(failureToasts()).toEqual([])
  })
})

describe('editing a holding', () => {
  it('opens a sum with float error rounded, saves a change, and says so', async () => {
    await seed({ shares: 0.1 + 0.2, purchase_price: (30.3 + 71.4) / 10, notes: 'Plan' })
    await openEdit()
    expect(field('Shares').value).toBe('0.3')
    expect(field('Purchase Price').value).toBe('10.17')

    type(field('Notes'), 'Paused')
    submit()

    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({ ticker: 'EXMPL', notes: 'Paused', purchase_date: '2026-02-10' }),
      ])
    })
    await vi.waitFor(() => {
      expect(dialog()).toBeNull()
    })
    expect(successToasts()).toEqual(['Saved your changes to "EXMPL".'])
    expect(failureToasts()).toEqual([])
  })

  it('sends back shares and a price stored past eight decimals as they were, when only the notes change', async () => {
    await seed({ shares: 1.123456789123, purchase_price: 0.000012345678 })
    await openEdit()
    expect(field('Shares').value).toBe('1.123456789123')
    expect(field('Purchase Price').value).toBe('0.000012345678')

    type(field('Notes'), 'Paused')
    submit()

    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({
          shares: 1.123456789123,
          purchase_price: 0.000012345678,
          notes: 'Paused',
        }),
      ])
    })
    expect(failureToasts()).toEqual([])
  })

  it('opens shares below a millionth written out, not as an exponent, and keeps them', async () => {
    await seed({ shares: 0.0000001, purchase_price: 0.00000025 })
    await openEdit()
    expect(field('Shares').value).toBe('0.0000001')
    expect(field('Purchase Price').value).toBe('0.00000025')

    type(field('Notes'), 'Dust')
    submit()

    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({ shares: 0.0000001, purchase_price: 0.00000025, notes: 'Dust' }),
      ])
    })
    expect(failureToasts()).toEqual([])
  })

  it('saves a holding an older version stored, sending its values back as they were', async () => {
    await seed({ ticker: 'EXAMPLE-FUND-CLASS-A.XX', purchase_price: -5 })
    await openEdit()

    type(field('Notes'), 'Still here')
    submit()

    await vi.waitFor(async () => {
      expect(await holdings()).toEqual([
        expect.objectContaining({
          ticker: 'EXAMPLE-FUND-CLASS-A.XX',
          purchase_price: -5,
          notes: 'Still here',
        }),
      ])
    })
    expect(failureToasts()).toEqual([])
  })

  it('marks a blank ticker and sends nothing', async () => {
    await seed({})
    await openEdit()

    type(field('Ticker Symbol'), '')
    submit()
    await settle()

    expect(describedBy(field('Ticker Symbol'))).toBe(M.ticker)
    expect((await holdings())[0]).toMatchObject({ ticker: 'EXMPL' })
    expect(failureToasts()).toEqual([])
  })
})
