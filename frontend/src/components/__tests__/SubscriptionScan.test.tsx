/**
 * The subscription scan's Add, with the runtime refusing an entry: the scan names it, with the
 * reason it was refused for, and keeps it selected so that it can be fixed and added again. It
 * said "Some subscriptions could not be added", whatever the reason, and named none.
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

describe('adding what the scan found', () => {
  it('says which subscription was not added, and why, and keeps it selected', async () => {
    apiMocks.apiPost.mockImplementation(async (_url: string, body: { name: string }) => {
      if (body.name === 'Netflix') {
        throw new ApiError(400, BILL_MESSAGES.amountCents, { amount: BILL_MESSAGES.amountCents })
      }
      return { id: 1 }
    })
    const scan = await mountScan()

    expect(await scan.addSelected()).toBe(1)

    const toasts = apiMocks.showToast.mock.calls
    expect(toasts.filter(([, kind]) => kind === 'error')).toEqual([
      [`Couldn't add "Netflix". ${BILL_MESSAGES.amountCents}`, 'error'],
    ])
    expect(scan.chosenCount()).toBe(1)
  })
})
