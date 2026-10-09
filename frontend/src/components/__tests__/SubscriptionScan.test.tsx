/**
 * The subscription scan's Add. A price the bill rules refuse is marked under its row, in their
 * words, before anything is sent. With the runtime refusing an entry, the scan keeps it selected so
 * that it can be fixed and added again: a refused price is marked under its row, and any other
 * reason is said in the notice, naming it. It said "Some subscriptions could not be added",
 * whatever the reason, and named none; then the reason in a toast, with nothing marked.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BILL_MESSAGES } from '../../../../shared/billSchema'
import { ApiError } from '../../core/apiError'
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

async function mountScan(): Promise<Exposed> {
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
