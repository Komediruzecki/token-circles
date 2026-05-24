import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  analyticsCategoryTrends,
  analyticsDailyHeatmap,
  analyticsDistinctYears,
  analyticsSankey,
  analyticsWeeks,
  categoriesCreate,
  reportsCustom,
  transactionsCreate,
} from '../localHandlers.js'

describe('localHandlers - analytics and reports', () => {
  let catId: number

  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')

    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })

    const catRes = await categoriesCreate({ name: 'Food', type: 'expense', color: '#ff0000' })
    const cat = await catRes.json()
    catId = cat.id

    // Seed some transactions for analytics
    await transactionsCreate({
      amount: 100,
      type: 'expense',
      date: '2025-05-10',
      description: 'Groceries 1',
      category_id: catId,
    })
    await transactionsCreate({
      amount: 50,
      type: 'expense',
      date: '2026-05-20',
      description: 'Groceries 2',
      category_id: catId,
    })
    await transactionsCreate({
      amount: 2000,
      type: 'income',
      date: '2026-05-01',
      description: 'Salary',
      category_id: null,
    })
  })

  it('gets distinct years', async () => {
    const res = await analyticsDistinctYears()
    expect(res.status).toBe(200)
    const years = await res.json()
    expect(years.years).toContain(2025)
    expect(years.years).toContain(2026)
  })

  it('gets weekly analytics for a year', async () => {
    const params = new URLSearchParams({ year: '2026' })
    const res = await analyticsWeeks(params)
    expect(res.status).toBe(200)
    const weeks = await res.json()
    expect(weeks.weeks).toBeInstanceOf(Array)
    expect(weeks.weeks.length).toBeGreaterThanOrEqual(52)
  })

  it('gets daily heatmap', async () => {
    const params = new URLSearchParams({ year: '2026' })
    const res = await analyticsDailyHeatmap(params)
    expect(res.status).toBe(200)
    const heatmap = await res.json()
    expect(heatmap.dates).toBeDefined()
    const hasData = Object.keys(heatmap.dates).length > 0
    expect(hasData).toBe(true)
  })

  it('gets category trends', async () => {
    const params = new URLSearchParams({
      date_from: '2026-01-01',
      date_to: '2026-12-31',
    })
    const res = await analyticsCategoryTrends(params)
    expect(res.status).toBe(200)
    const trends = await res.json()
    expect(trends.labels).toBeInstanceOf(Array)
    expect(trends.datasets).toBeInstanceOf(Array)
    expect(trends.numDays).toBeDefined()
  })

  it('gets sankey data', async () => {
    const params = new URLSearchParams({
      date_from: '2026-01-01',
      date_to: '2026-12-31',
    })
    const res = await analyticsSankey(params)
    expect(res.status).toBe(200)
    const sankey = await res.json()
    expect(sankey.nodes).toBeInstanceOf(Array)
    expect(sankey.links).toBeInstanceOf(Array)
  })

  it('generates a custom report', async () => {
    const res = await reportsCustom({
      date_from: '2026-01-01',
      date_to: '2026-12-31',
      metrics: ['income', 'expenses', 'net'],
      groupBy: 'category',
    })
    expect(res.status).toBe(200)
    const report = await res.json()
    expect(report.summary.totalIncome).toBeDefined()
    expect(report.summary.totalExpenses).toBeDefined()
    expect(report.summary.netTotal).toBeDefined()
  })
})
