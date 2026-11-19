/**
 * The annual PDF for the current year covers January to the end of the current month, not the
 * whole year: the months after this one have not happened (utils/reportSpan). It drew all twelve,
 * so a report taken in November ended in an empty December and a cash-flow line running flat.
 *
 * jsdom has no Worker, so drawing the charts throws once the figures are built. The figures are
 * what these tests read: the range the report asks for, and the months its bar chart is given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateAnnualPdf } from '../clientPdfReports'
import type * as ReportCharts from '../reportCharts'

const requests: string[] = []
/** What the server answers for the transactions of the range. */
let serverRows: unknown[] = []
/** The months handed to the bar chart, one list per report. */
const barData = vi.hoisted(
  () => [] as Array<Array<{ month: string; income: number; expense: number }>>
)

vi.mock('../../apiFetch', () => ({
  apiFetch: vi.fn(async (url: string) => {
    requests.push(url)
    if (url.startsWith('/api/categories')) return Response.json([])
    return Response.json({ rows: serverRows, total: serverRows.length })
  }),
}))

vi.mock('../reportCharts', async (importOriginal) => {
  const actual = await importOriginal<typeof ReportCharts>()
  return {
    ...actual,
    buildIncomeExpenseBar: vi.fn((...args: Parameters<typeof actual.buildIncomeExpenseBar>) => {
      barData.push(args[0].map((m) => ({ ...m })))
      return actual.buildIncomeExpenseBar(...args)
    }),
  }
})

const transactionsAsked = () => requests.find((u) => u.startsWith('/api/transactions'))

beforeEach(() => {
  requests.length = 0
  serverRows = []
  barData.length = 0
  localStorage.setItem('finance_storage_mode', 'self-hosted')
  localStorage.setItem('currentProfileId', '1')
})

afterEach(() => {
  localStorage.clear()
})

describe('the annual PDF for this year', () => {
  const now = new Date()
  const year = now.getFullYear()
  const months = now.getMonth() + 1
  const lastDay = new Date(year, months, 0).getDate()
  const end = `${year}-${String(months).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  it('reads January to the end of this month', async () => {
    await generateAnnualPdf(year, false).catch(() => {})
    expect(transactionsAsked()).toBe(`/api/transactions?startDate=${year}-01-01&endDate=${end}`)
  })

  it('draws the months so far and no more', async () => {
    await generateAnnualPdf(year, false).catch(() => {})
    expect(barData).toHaveLength(1)
    expect(barData[0].map((m) => m.month)).toHaveLength(months)
    expect(barData[0][0].month).toBe('Jan')
  })

  it('leaves out a row from outside its span, should the server send one', async () => {
    serverRows = [
      {
        id: 1,
        type: 'expense',
        amount: 50,
        amount_local: 50,
        date: `${year + 1}-01-15`,
        category_id: null,
      },
    ]
    await generateAnnualPdf(year, false).catch(() => {})
    expect(barData).toHaveLength(1)
    expect(barData[0].every((m) => m.expense === 0)).toBe(true)
  })
})

describe('the annual PDF for a past year', () => {
  const year = new Date().getFullYear() - 1

  it('reads the whole year', async () => {
    await generateAnnualPdf(year, false).catch(() => {})
    expect(transactionsAsked()).toBe(
      `/api/transactions?startDate=${year}-01-01&endDate=${year}-12-31`
    )
  })

  it('draws all twelve months', async () => {
    await generateAnnualPdf(year, false).catch(() => {})
    expect(barData[0]).toHaveLength(12)
    expect(barData[0][11].month).toBe('Dec')
  })
})
