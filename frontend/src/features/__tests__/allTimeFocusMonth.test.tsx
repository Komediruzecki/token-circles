/**
 * All time runs from 1970-01-01 to today. That start stands in for "everything": nobody means it as
 * a month. The pages that show one month at a time took their month from a range's start, so on All
 * time Dashboard asked for January 1970's cash flow ("No flows for All time yet.") and 1970's
 * spending heatmap, Budgets showed January 1970 with every figure at zero and offered "Copy
 * December 1969 Budgets", and the bill calendar drew January 1970. On All time each one shows this
 * month, the month the range reaches.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import { __resetDataVersionsForTest } from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'
import { fromPill } from '../../utils/period'
import type { PageName } from '../../types/models'

const NOW = new Date()
const YEAR = NOW.getFullYear()
const MONTH = NOW.getMonth() + 1
const YEAR_MONTH = `${YEAR}-${String(MONTH).padStart(2, '0')}`
const LAST_MONTH = new Date(YEAR, MONTH - 2, 1).toLocaleDateString('en-US', {
  month: 'long',
  year: 'numeric',
})

/** Every read, as the URL the page asked for. */
let reads: string[] = []
const readsOf = (path: string) => reads.filter((url) => url.split('?')[0] === path)

function rawRead(url: string): unknown {
  reads.push(url)
  switch (url.split('?')[0]) {
    case '/api/analytics/sankey':
      return { nodes: [], links: [] }
    case '/api/analytics/daily-heatmap':
      return { dates: {} }
    case '/api/budgets/alerts':
      return { alerts: [] }
    case '/api/bills/calendar':
      return {
        year: YEAR,
        month: MONTH,
        monthLabel: '',
        firstDow: 0,
        days: {},
        summary: { totalAmount: 0, paidAmount: 0, billCount: 0 },
      }
    default:
      return []
  }
}

/** The typed client methods the Dashboard calls. */
const typed: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getDashboard: async () => ({
    totalIncome: 0,
    totalExpenses: 0,
    balance: 0,
    incomeByCategory: [],
    expenseByCategory: [],
    recentTransactions: [],
    upcomingBills: [],
  }),
  getDashboardCharts: async () => ({ byCategory: [], monthly: [], cashFlow: [], currency: 'EUR' }),
  getNetWorth: async () => ({ totalNetWorth: 0, timeline: [] }),
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => rawRead(url)),
    apiHouseholdGet: vi.fn(async (url: string) => rawRead(url)),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy(typed, { get: (target, name: string) => target[name] ?? (async () => []) }),
  }
})

// The circles' store reads settings and holdings of its own; Dashboard's month is not its business.
vi.mock('../../core/guidance', () => ({ useGuidance: () => () => null, takeAnswers: vi.fn() }))

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

const PAGES = ['../Dashboard', '../Budgets', '../BillCalendar']

beforeAll(async () => {
  for (const module of PAGES) await import(module)
}, 120_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  reads = []
  // Every Dashboard widget on, so the deck's cash flow and heatmap mount.
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify({ visibleWidgets: ALL_WIDGET_IDS }))
  Element.prototype.scrollIntoView = () => {}
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
  // The real All time, from 1970-01-01, as the pill sets it.
  setPeriod(fromPill('all'))
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
  vi.unstubAllGlobals()
})

async function mountPage(page: PageName, module: string) {
  setPage(page)
  const { default: Page } = await import(module)
  dispose = render(() => <Page />, host)
  await settle()
}

/** Each read of one endpoint, whatever its count, was this URL and no other. */
function onlyAsked(path: string, url: string) {
  expect(readsOf(path), `${path} was never read`).not.toHaveLength(0)
  expect(new Set(readsOf(path))).toEqual(new Set([url]))
}

describe('on All time, a page that shows one month shows this month', () => {
  it("Dashboard draws this month's cash flow and this year's spending heatmap", async () => {
    await mountPage('dashboard', '../Dashboard')
    onlyAsked('/api/analytics/sankey', `/api/analytics/sankey?year=${YEAR}&month=${MONTH}`)
    onlyAsked(
      '/api/analytics/daily-heatmap',
      `/api/analytics/daily-heatmap?year=${YEAR}&type=expense`
    )
    const heatmap = [...host.querySelectorAll('section')].find((s) =>
      s.querySelector('h3')?.textContent?.includes('Spending heatmap')
    )
    expect(heatmap?.querySelector('header a')?.textContent?.trim()).toBe(`${YEAR} →`)
  })

  it("Budgets shows this month's budgets and copies from last month", async () => {
    await mountPage('budgets', '../Budgets')
    onlyAsked('/api/budgets/zero-based', `/api/budgets/zero-based?month=${YEAR_MONTH}`)
    expect(host.textContent).toContain(`Copy ${LAST_MONTH} Budgets`)
    expect(host.textContent).toContain(`From ${LAST_MONTH} Expenses`)
    expect(host.textContent).not.toMatch(/19(69|70)/)
  })

  it('the bill calendar draws this month', async () => {
    await mountPage('bills', '../BillCalendar')
    onlyAsked('/api/bills/calendar', `/api/bills/calendar?year=${YEAR}&month=${MONTH}`)
  })
})
