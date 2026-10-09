/**
 * A cloud PDF report reads every transaction of its range.
 *
 * The PDFs are drawn in the browser in both modes; in cloud the rows come from GET
 * /api/transactions. The report asked it for `limit=100000`, and the Worker caps a page at 1000
 * rows (worker/src/routes/transactions.ts), so a year with more than 1000 transactions lost its
 * oldest ones: the annual, tax and P&L reports came out short, without a word. Without a limit the
 * Worker answers the whole range, as it does for the Transactions page.
 *
 * The Worker below is a stand-in for that one rule: newest first, a page of at most 1000 rows when
 * a limit is sent, every row when none is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadReportSource } from '../clientPdfReports'

const requests: string[] = []

/** 1500 expenses of 2 each, one a day back from 31 December 2025. */
const YEAR_ROWS = Array.from({ length: 1500 }, (_, i) => {
  const day = new Date(Date.UTC(2025, 11, 31 - (i % 365)))
  return {
    id: i + 1,
    type: 'expense',
    amount: 2,
    amount_local: 2,
    date: day.toISOString().slice(0, 10),
    description: `Row ${i + 1}`,
    category_id: null,
  }
})

vi.mock('../../apiFetch', () => ({
  apiFetch: vi.fn(async (url: string) => {
    requests.push(url)
    const parsed = new URL(url, 'http://worker.test')
    if (parsed.pathname === '/api/categories') return Response.json([])
    const from = parsed.searchParams.get('startDate') ?? ''
    const to = parsed.searchParams.get('endDate') ?? '9999-12-31'
    const all = YEAR_ROWS.filter((t) => t.date >= from && t.date <= to).sort((a, b) =>
      b.date.localeCompare(a.date)
    )
    const limit = parsed.searchParams.get('limit')
    const rows = limit ? all.slice(0, Math.min(parseInt(limit, 10), 1000)) : all
    return Response.json({ rows, total: all.length, limit: limit ?? all.length, offset: 0 })
  }),
}))

beforeEach(() => {
  requests.length = 0
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  localStorage.setItem('currentProfileId', '1')
})

afterEach(() => {
  localStorage.clear()
})

describe('a cloud PDF report', () => {
  it('reads every transaction of a year with more than 1000 of them', async () => {
    const { txns } = await loadReportSource('2025-01-01', '2025-12-31')

    expect(requests.filter((u) => u.startsWith('/api/transactions'))).toHaveLength(1)
    expect(txns).toHaveLength(1500)
    expect(txns.reduce((sum, t) => sum + t.amount, 0)).toBe(3000)
    // The oldest days are in it, not only the newest 1000 rows.
    expect(txns.some((t) => t.date === '2025-01-01')).toBe(true)
  })
})
