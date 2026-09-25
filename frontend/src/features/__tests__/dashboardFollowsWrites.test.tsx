/**
 * The Dashboard is built from eight separate reads, and every one of them has to follow the writes
 * that change it — from any page, and on resume.
 *
 * All of them tracked the profile alone. A transaction saved on Transactions left the totals, the
 * charts and the budget cards showing the old figures until a reload, and resume revalidation
 * (#573) refreshed none of them. The deck's three resources and the recurring card were not even
 * gated on visibility: the deck refetched on a profile switch while the Dashboard was hidden, and
 * the recurring card loaded once per session and never again.
 *
 * Each reader tracks the entities its endpoint reads, so a write moves exactly the cards it
 * changes, once each — never twice for a write that bumps two counters a reader follows.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setPage } from '../../core/appStore'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

/** Every read, by the URL the raw helpers were asked for or the typed method that was called. */
let reads: string[] = []
const readsOf = (key: string) => reads.filter((url) => url === key || url.startsWith(`${key}?`))

function rawRead(url: string): unknown {
  reads.push(url)
  const path = url.split('?')[0]
  if (path === '/api/analytics/sankey') return { nodes: [], links: [] }
  if (path === '/api/analytics/daily-heatmap') return { dates: {} }
  if (path === '/api/budgets/alerts') return { alerts: [] }
  return []
}

/** The typed client methods the Dashboard calls, counted under their own names. */
const typed: Record<string, (...args: unknown[]) => Promise<unknown>> = {
  getDashboard: async () => {
    reads.push('api.getDashboard')
    return {
      totalIncome: 0,
      totalExpenses: 0,
      balance: 0,
      incomeByCategory: [],
      expenseByCategory: [],
      recentTransactions: [],
      upcomingBills: [],
    }
  },
  getDashboardCharts: async () => ({ byCategory: [], monthly: [], cashFlow: [], currency: 'EUR' }),
  getNetWorth: async () => ({ totalNetWorth: 0, timeline: [] }),
  getRecurring: async () => {
    reads.push('api.getRecurring')
    return []
  },
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => rawRead(url)),
    apiHouseholdGet: vi.fn(async (url: string) => rawRead(url)),
    showToast: vi.fn(),
    toast: vi.fn(),
    // Anything else the page's widgets ask the typed client for gets an empty list.
    api: new Proxy(typed, { get: (target, name: string) => target[name] ?? (async () => []) }),
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  await flush()
  await flush()
  await flush()
}

// Loading the page module (charts, d3) is the slow part of a mount. Done once up front, so a
// loaded machine cannot push the first test past its timeout — a mount that outlives its test
// keeps counting reads into the next one.
beforeAll(async () => {
  await import('../Dashboard')
}, 60_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  reads = []
  // Every widget on, and the classic widgets below the deck expanded, so every reader mounts.
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify({ visibleWidgets: ALL_WIDGET_IDS }))
  localStorage.setItem('dashboard_showMore', '1')
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
  setPeriod({ mode: 'month', year: 2026, month: 9, preset: 'all' })
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
  localStorage.removeItem(WIDGET_STORAGE_KEY)
  localStorage.removeItem('dashboard_showMore')
  vi.unstubAllGlobals()
})

async function mountDashboard() {
  setPage('dashboard')
  const { default: Dashboard } = await import('../Dashboard')
  dispose = render(() => <Dashboard />, host)
  await settle()
}

const READERS = [
  { reader: 'the totals and charts', key: 'api.getDashboard', follows: ['dashboard', 'accounts'] },
  {
    reader: 'the cash-flow sankey',
    key: '/api/analytics/sankey',
    follows: ['analytics', 'budgets'],
  },
  { reader: 'the spending heatmap', key: '/api/analytics/daily-heatmap', follows: ['analytics'] },
  { reader: 'the budget radar', key: '/api/budgets/alerts?threshold=0', follows: ['budgets'] },
  { reader: 'the budget alerts', key: '/api/budgets/alerts?threshold=80', follows: ['budgets'] },
  { reader: 'the portfolio list', key: '/api/portfolio/holdings', follows: ['portfolio'] },
  { reader: 'the recurring card', key: 'api.getRecurring', follows: ['recurring'] },
]

describe.each(READERS)('$reader', ({ key, follows }) => {
  it('reads once on mount', async () => {
    await mountDashboard()
    expect(readsOf(key)).toHaveLength(1)
  })

  it.each(follows)('refetches once when %s is written elsewhere', async (tag) => {
    await mountDashboard()
    invalidateEntity(tag)
    await settle()
    expect(readsOf(key)).toHaveLength(2)
  })

  it('refetches once when the app resumes', async () => {
    await mountDashboard()
    invalidateAllEntities()
    await settle()
    expect(readsOf(key)).toHaveLength(2)
  })

  it('defers while the Dashboard is hidden and refetches once on the next show', async () => {
    await mountDashboard()
    setPage('transactions')
    await flush()
    for (const tag of follows) invalidateEntity(tag)
    invalidateAllEntities()
    await settle()
    expect(readsOf(key)).toHaveLength(1)

    setPage('dashboard')
    await settle()
    expect(readsOf(key)).toHaveLength(2)
  })
})

describe('a transaction saved on another page', () => {
  it('refreshes every card it changes, once each, and leaves the rest alone', async () => {
    await mountDashboard()

    // One POST bumps transactions, accounts, dashboard, analytics, budgets and reports together.
    invalidateForRequest('/api/transactions', 'POST', true)
    await settle()

    expect(readsOf('api.getDashboard')).toHaveLength(2)
    expect(readsOf('/api/analytics/sankey')).toHaveLength(2)
    expect(readsOf('/api/analytics/daily-heatmap')).toHaveLength(2)
    expect(readsOf('/api/budgets/alerts?threshold=0')).toHaveLength(2)
    expect(readsOf('/api/budgets/alerts?threshold=80')).toHaveLength(2)
    expect(readsOf('/api/portfolio/holdings')).toHaveLength(1)
    expect(readsOf('api.getRecurring')).toHaveLength(1)
  })
})
