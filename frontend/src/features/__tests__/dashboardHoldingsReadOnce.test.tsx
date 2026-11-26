/**
 * Two things on the Dashboard need the holdings: the overview deck's portfolio list and the circles
 * (core/guidance.ts, Your next step and the savings gauge). Each read them itself, so every
 * portfolio write, resume and next show asked `GET /api/portfolio/holdings` twice for one answer.
 * The release suite's cases 2.5 and 2.15 caught it in cloud mode.
 *
 * They share one read now (`sharedRead` in core/dataVersions.ts): the same question between the
 * same two writes is asked once. dashboardFollowsWrites.test.tsx leaves the circles out to count
 * the cards alone, which is how this went unseen; here they are mounted for real.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import { ALL_WIDGET_IDS, WIDGET_STORAGE_KEY } from '../../core/dashboardWidgets'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateForRequest,
} from '../../core/dataVersions'
import { __resetGuidanceForTest } from '../../core/guidance'
import { setPeriod } from '../../core/periodStore'

const HOLDINGS = '/api/portfolio/holdings'

// Hoisted: the circles' store is imported above, and it loads the mocked api module with it.
const net = vi.hoisted(() => {
  /** Every raw read, by URL. */
  const reads: string[] = []
  const rawRead = (url: string): unknown => {
    reads.push(url)
    const path = url.split('?')[0]
    if (path === '/api/analytics/sankey') return { nodes: [], links: [] }
    if (path === '/api/analytics/daily-heatmap') return { dates: {} }
    if (path === '/api/budgets/alerts') return { alerts: [] }
    return []
  }
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
    getDashboardCharts: async () => ({
      byCategory: [],
      monthly: [],
      cashFlow: [],
      currency: 'EUR',
    }),
    getNetWorth: async () => ({ totalNetWorth: 0, timeline: [] }),
    getSettings: async () => ({}),
  }
  return { reads, rawRead, typed }
})

const holdingsReads = () => net.reads.filter((url) => url === HOLDINGS).length

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => net.rawRead(url)),
    apiHouseholdGet: vi.fn(async (url: string) => net.rawRead(url)),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy(net.typed, { get: (target, name: string) => target[name] ?? (async () => []) }),
  }
})

let host: HTMLDivElement
let dispose: (() => void) | undefined

const flush = () => new Promise((r) => setTimeout(r, 0))
/** The circles read after the page has painted (afterPaint), so wait a frame or two, not a tick. */
const settle = async () => {
  for (let i = 0; i < 3; i++) await flush()
  await new Promise((r) => setTimeout(r, 60))
  for (let i = 0; i < 3; i++) await flush()
}

beforeAll(async () => {
  await import('../Dashboard')
}, 60_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  __resetGuidanceForTest()
  net.reads.length = 0
  localStorage.setItem('currentProfileId', '1')
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
  localStorage.removeItem('currentProfileId')
  vi.unstubAllGlobals()
})

async function mountDashboard() {
  setPage('dashboard')
  const { default: Dashboard } = await import('../Dashboard')
  dispose = render(() => <Dashboard />, host)
  await settle()
}

describe('the Dashboard asks for the holdings once', () => {
  it('on mount', async () => {
    await mountDashboard()
    expect(holdingsReads()).toBe(1)
  })

  it('after a portfolio write', async () => {
    await mountDashboard()
    invalidateForRequest(HOLDINGS, 'POST', true)
    await settle()
    expect(holdingsReads()).toBe(2)
  })

  it('when the app resumes or comes back online', async () => {
    await mountDashboard()
    invalidateAllEntities()
    await settle()
    expect(holdingsReads()).toBe(2)
  })

  it('on the next show after a write made while it was hidden', async () => {
    await mountDashboard()
    setPage('portfolio')
    await flush()
    invalidateForRequest(HOLDINGS, 'POST', true)
    await settle()
    expect(holdingsReads()).toBe(1)

    setPage('dashboard')
    await settle()
    expect(holdingsReads()).toBe(2)
  })

  it('after a profile switch', async () => {
    await mountDashboard()
    localStorage.setItem('currentProfileId', '2')
    bumpProfileVersion()
    await settle()
    expect(holdingsReads()).toBe(2)
  })

  it('and again after a second write: one answer is not kept past the next write', async () => {
    await mountDashboard()
    invalidateForRequest(HOLDINGS, 'POST', true)
    await settle()
    invalidateForRequest(`${HOLDINGS}/1`, 'DELETE', true)
    await settle()
    expect(holdingsReads()).toBe(3)
  })
})
