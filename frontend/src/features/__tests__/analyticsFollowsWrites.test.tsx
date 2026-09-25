/**
 * Analytics follows every write that changes a chart on it — from any page, on resume, and on a
 * profile switch.
 *
 * Its three resources tracked the profile at most (the month summary not even that), and its
 * imperative charts — the stacked trends, the heatmap and the budget flow — loaded once in
 * onMount and then only when their own controls were touched. A transaction saved elsewhere, a
 * profile switch, or a return to the tab after an hour left every one of them as it was. The
 * budget flow did not load at all until a year or month was picked: it lost its mount load when
 * the page's tabs were folded into one scroll.
 */
import { render } from 'solid-js/web'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpProfileVersion, setPage } from '../../core/appStore'
import {
  __resetDataVersionsForTest,
  invalidateAllEntities,
  invalidateEntity,
  invalidateForRequest,
} from '../../core/dataVersions'
import { setPeriod } from '../../core/periodStore'

let reads: string[] = []
const count = (match: (url: string) => boolean) => reads.filter(match).length
const pathOf = (url: string) => url.split('?')[0]

function rawRead(url: string): unknown {
  reads.push(url)
  switch (pathOf(url)) {
    case '/api/analytics/category-trends':
      return { labels: [], datasets: [], numDays: 0 }
    case '/api/analytics/daily-heatmap':
      return { dates: {} }
    case '/api/analytics/sankey':
      return { nodes: [], links: [], hasBudgets: true }
    case '/api/analytics/weeks':
      return { weeks: [] }
    case '/api/transactions/summary':
      return {}
    default:
      return []
  }
}

vi.mock('../../core/api', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const typed: Record<string, () => Promise<unknown>> = {
    getTransactionYears: async () => {
      reads.push('api.getTransactionYears')
      return { years: [2026] }
    },
  }
  return {
    ...original,
    apiGet: vi.fn(async (url: string) => rawRead(url)),
    apiHouseholdGet: vi.fn(async (url: string) => rawRead(url)),
    showToast: vi.fn(),
    toast: vi.fn(),
    api: new Proxy(typed, { get: (target, name: string) => target[name] ?? (async () => []) }),
  }
})

/**
 * One counter per reader on the page. The summary resource and the stacked chart both read
 * category trends; they differ in their query (the resource sends `type` first). The summary and
 * the month card both read monthly stats; only the summary also reads the transaction summary.
 */
const READERS = [
  {
    reader: 'the year summary',
    reads: () => count((u) => pathOf(u) === '/api/transactions/summary'),
    follows: ['analytics'],
  },
  {
    reader: 'the month card',
    reads: () =>
      count((u) => pathOf(u) === '/api/stats/monthly') -
      count((u) => pathOf(u) === '/api/transactions/summary'),
    follows: ['analytics'],
  },
  {
    reader: 'the year list',
    reads: () => count((u) => u === 'api.getTransactionYears'),
    follows: ['analytics'],
  },
  {
    reader: 'the stacked trends',
    reads: () => count((u) => u.startsWith('/api/analytics/category-trends?year=')),
    follows: ['analytics'],
  },
  {
    reader: 'the spending heatmap',
    reads: () => count((u) => pathOf(u) === '/api/analytics/daily-heatmap'),
    follows: ['analytics'],
  },
  {
    reader: 'the budget flow',
    reads: () => count((u) => pathOf(u) === '/api/analytics/sankey'),
    follows: ['analytics', 'budgets'],
  },
]

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
  await import('../Analytics')
}, 60_000)

beforeEach(() => {
  __resetDataVersionsForTest()
  reads = []
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
  vi.unstubAllGlobals()
})

async function mountAnalytics() {
  setPage('analytics')
  const { default: Analytics } = await import('../Analytics')
  dispose = render(() => <Analytics />, host)
  await settle()
}

describe.each(READERS)('$reader', ({ reads: readsOf, follows }) => {
  it('reads once on mount', async () => {
    await mountAnalytics()
    expect(readsOf()).toBe(1)
  })

  it.each(follows)('refetches once when %s is written elsewhere', async (tag) => {
    await mountAnalytics()
    invalidateEntity(tag)
    await settle()
    expect(readsOf()).toBe(2)
  })

  it('refetches once when the app resumes', async () => {
    await mountAnalytics()
    invalidateAllEntities()
    await settle()
    expect(readsOf()).toBe(2)
  })

  it('refetches once on a profile switch', async () => {
    await mountAnalytics()
    bumpProfileVersion()
    await settle()
    expect(readsOf()).toBe(2)
  })

  it('defers while Analytics is hidden and refetches once on the next show', async () => {
    await mountAnalytics()
    setPage('dashboard')
    await flush()
    for (const tag of follows) invalidateEntity(tag)
    invalidateAllEntities()
    await settle()
    expect(readsOf()).toBe(1)

    setPage('analytics')
    await settle()
    expect(readsOf()).toBe(2)
  })

  it('refetches once for a transaction saved elsewhere', async () => {
    await mountAnalytics()
    // Bumps `analytics` and `budgets` together; the budget flow follows both and must still load
    // once.
    invalidateForRequest('/api/transactions', 'POST', true)
    await settle()
    expect(readsOf()).toBe(2)
  })
})
