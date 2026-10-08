/**
 * Extra payments on the Loans page against the real local-first router (fake IndexedDB), not a
 * mock of it: every apiGet, apiPost, apiPut and apiDelete the page makes is answered by
 * routeApiRequest, and a write bumps the data version as apiFetch does.
 *
 * Local-first keeps a loan's extra payments inside the loan record. While their ids were their
 * places in that list, removing one payment while another's change was open moved the change onto
 * the next payment, and saving it overwrote that payment.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const call = async (method: string, path: string, body?: unknown) => {
    // Imported at call time: importing them in this factory would wait on this very module.
    const { routeApiRequest } = await import('../../../core/storage/localApiRouter')
    const { invalidateForRequest } = await import('../../../core/dataVersions')
    const res = await routeApiRequest(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(String(data.error))
    if (method !== 'GET') invalidateForRequest(path, method, true)
    return data
  }
  return {
    ...original,
    apiHouseholdGet: vi.fn((p: string) => call('GET', p)),
    apiGet: vi.fn((p: string) => call('GET', p)),
    apiPost: vi.fn((p: string, b: unknown) => call('POST', p, b)),
    apiPut: vi.fn((p: string, b: unknown) => call('PUT', p, b)),
    apiDelete: vi.fn((p: string) => call('DELETE', p)),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy({}, { get: () => async () => [] }),
  }
})
vi.mock('../../../core/confirmStore', () => ({ showConfirm: async () => true }))

let host: HTMLDivElement
let dispose: (() => void) | undefined
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((res) => setTimeout(res, 0))
}
const el = (id: string) => host.querySelector<HTMLElement>(`[data-test-id="${id}"]`)
const byLabel = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const form = () => el('loans-extra-edit-form')

async function send(method: string, path: string, body?: unknown) {
  const { routeApiRequest } = await import('../../../core/storage/localApiRouter')
  return routeApiRequest(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** A write the page did not make, as from another tab: the store, then the data version bump. */
async function elsewhere(method: string, path: string, body?: unknown) {
  const res = await send(method, path, body)
  const { invalidateForRequest } = await import('../../../core/dataVersions')
  invalidateForRequest(`/api${path}`, method, true)
  await settle()
  return res
}

async function stored(loanId: number) {
  const { getDB } = await import('../../../core/storage/idb')
  const loan = await (await getDB()).get('loans', loanId)
  return (loan.prepayments as { month: number; amount: number; note: string }[]).map(
    ({ month, amount, note }) => ({ month, amount, note })
  )
}

/** A car loan with extra payments A, B and C, with payments 3, 6 and 9, open on Extra payments. */
async function openLoan(): Promise<number> {
  const created = await (
    await send('POST', '/loans', {
      name: 'Car',
      principal: 20000,
      interest_rate: 5,
      term_months: 60,
      start_date: '2026-01-01',
    })
  ).json()
  for (const [month, amount, note] of [
    [3, 300, 'A'],
    [6, 600, 'B'],
    [9, 900, 'C'],
  ] as const) {
    const res = await send('POST', `/loans/${created.id}/prepayments`, { month, amount, note })
    expect(res.status).toBe(201)
  }
  const { setPage } = await import('../../../core/appStore')
  const { default: Loans } = await import('../../Loans')
  history.replaceState(null, '', `#loans/${created.id}/extras`)
  setPage('loans')
  dispose = render(() => <Loans />, host)
  await settle()
  return created.id
}

async function openChange(month: number) {
  byLabel(`Change the extra payment with payment ${month}`)!.click()
  await settle()
  expect(form()?.getAttribute('aria-label')).toBe(`Change the extra payment with payment ${month}`)
}

beforeAll(async () => {
  await import('../../Loans')
  await import('../../../core/storage/localApiRouter')
}, 120_000)

beforeEach(async () => {
  const { __resetDataVersionsForTest } = await import('../../../core/dataVersions')
  __resetDataVersionsForTest()
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const { getDB } = await import('../../../core/storage/idb')
  const db = await getDB()
  await db.clear('profiles')
  await db.clear('loans')
  await db.add('profiles', { id: 1, name: 'Me', created_at: '2026-01-01' })
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
  Element.prototype.scrollIntoView = () => {}
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

describe('extra payments in local-first', () => {
  it('saves a change onto the payment it was opened on, after an earlier one is removed', async () => {
    const loanId = await openLoan()
    await openChange(6)

    byLabel('Remove the extra payment with payment 3')!.click()
    await settle()
    expect(form()?.getAttribute('aria-label')).toBe('Change the extra payment with payment 6')

    const amount = el('loans-extra-edit-amount') as HTMLInputElement
    amount.focus()
    amount.value = '650'
    amount.dispatchEvent(new Event('input', { bubbles: true }))
    form()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(await stored(loanId)).toEqual([
      { month: 6, amount: 650, note: 'B' },
      { month: 9, amount: 900, note: 'C' },
    ])
  })

  it('closes a change whose payment is removed, so the next one added does not open in it', async () => {
    const loanId = await openLoan()
    await openChange(9)

    // C is the last payment, so local-first gives its id to the next payment added.
    await elsewhere('DELETE', `/loans/${loanId}/prepayments/3`)
    expect(form()).toBeNull()
    const added = await elsewhere('POST', `/loans/${loanId}/prepayments`, {
      month: 12,
      amount: 1200,
      note: 'D',
    })
    expect(await added.json()).toEqual({ id: 3 })
    expect(form()).toBeNull()
  })
})
