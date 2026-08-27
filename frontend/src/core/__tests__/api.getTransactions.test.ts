import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api'
import { apiFetch } from '../apiFetch'

/**
 * The bug these guard: `getTransactions` forwarded the app's own parameter names to the worker.
 *
 * `GET /api/transactions` reads `startDate`, `endDate` and `category_ids`
 * (worker/src/routes/transactions.ts:183-186). The client sent `date_from`, `date_to` and
 * `category_id`. An unrecognised query parameter is not an error — the worker simply never
 * builds that WHERE clause — so a filtered request returned the ENTIRE profile and reported
 * success. `search` and `type` matched by luck, which is why the gap survived: the filters that
 * were exercised most worked, and the date filter appeared to work because the caller narrowed
 * client-side afterwards.
 *
 * Asserting on the query string rather than on results is the point: the failure mode is a name
 * that never reaches a handler, and only the wire format can show that.
 */

vi.mock('../apiFetch', () => ({ apiFetch: vi.fn() }))
const apiFetchMock = vi.mocked(apiFetch)

afterEach(() => {
  apiFetchMock.mockReset()
})

const rows = (body: unknown = []) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/** The query string the client actually put on the wire. */
function sentQuery(): URLSearchParams {
  const url = apiFetchMock.mock.calls[0]?.[0] ?? ''
  return new URL(url, 'http://localhost').searchParams
}

describe('api.getTransactions — wire parameter names', () => {
  it('sends the date range as startDate/endDate, the names the worker reads', async () => {
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions({ date_from: '2026-01-01', date_to: '2026-01-31' })

    const q = sentQuery()
    expect(q.get('startDate')).toBe('2026-01-01')
    expect(q.get('endDate')).toBe('2026-01-31')
    // The old names would be ignored by the worker, so they must not be what we send.
    expect(q.has('date_from')).toBe(false)
    expect(q.has('date_to')).toBe(false)
  })

  it('sends the category as category_ids, which the worker parses as an IN-list', async () => {
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions({ category_id: 7 })

    expect(sentQuery().get('category_ids')).toBe('7')
    expect(sentQuery().has('category_id')).toBe(false)
  })

  it('passes search and type through unchanged — these two always matched', async () => {
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions({ search: 'coffee', type: 'expense' })

    const q = sentQuery()
    expect(q.get('search')).toBe('coffee')
    expect(q.get('type')).toBe('expense')
  })

  it('forwards limit and offset, so a windowed read is reachable at all', async () => {
    // Previously unreachable through this helper: no limit was ever sent, so the worker's
    // `if (limit)` branch never ran and every call returned the whole table.
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions({ limit: 50, offset: 100 })

    const q = sentQuery()
    expect(q.get('limit')).toBe('50')
    expect(q.get('offset')).toBe('100')
  })

  it('sends reconciled as 1/0, the two values the worker documents', async () => {
    apiFetchMock.mockResolvedValue(rows())
    await api.getTransactions({ reconciled: true })
    expect(sentQuery().get('reconciled')).toBe('1')

    apiFetchMock.mockReset()
    apiFetchMock.mockResolvedValue(rows())
    await api.getTransactions({ reconciled: false })
    expect(sentQuery().get('reconciled')).toBe('0')
  })

  it('sends NO window when called with no arguments', async () => {
    // Load-bearing, not incidental. Transactions.tsx intersects its bulk selection against the
    // full list and documents that it holds every row; a default `limit` here would make a row
    // outside the window read as deleted and silently unselect it.
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions()

    const q = sentQuery()
    expect(q.has('limit')).toBe(false)
    expect(q.has('offset')).toBe(false)
    expect([...q.keys()]).toEqual([])
  })

  it('omits absent filters entirely rather than sending empty values', async () => {
    // `?startDate=` is truthy-empty on the wire; the worker tests `if (startDate)` so it would
    // be ignored, but sending it invites a future handler to treat it as a real bound.
    apiFetchMock.mockResolvedValue(rows())

    await api.getTransactions({ search: 'rent' })

    const q = sentQuery()
    expect([...q.keys()]).toEqual(['search'])
  })

  it('reads rows out of the { rows, total } envelope as well as a bare array', async () => {
    apiFetchMock.mockResolvedValue(rows({ rows: [], total: 0, limit: 0, offset: 0 }))
    await expect(api.getTransactions()).resolves.toEqual([])
  })
})
