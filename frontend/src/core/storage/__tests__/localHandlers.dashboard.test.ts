import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  accountsCreate,
  categoriesCreate,
  dashboardCharts,
  dashboardMain,
  dashboardNetWorth,
  dashboardSummary,
  transactionsCreate,
} from '../localHandlers.js'

describe('localHandlers - dashboard', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    await db.clear('profiles')
    await db.clear('transactions')
    await db.clear('categories')
    await db.clear('accounts')
    await db.clear('budgets')
    await db.clear('goals')
    await db.clear('loans')
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })

    // Seed an account
    await accountsCreate({
      name: 'Checking',
      type: 'checking',
      currency: 'EUR',
      balance: 5000,
      starting_balance: 5000,
    })

    // Seed a category
    await categoriesCreate({ name: 'Food', type: 'expense', color: '#ff0000' })

    // Seed transactions in current month
    await transactionsCreate({
      amount: 3000,
      type: 'income',
      date: '2026-05-01',
      description: 'Salary',
    })
    await transactionsCreate({
      amount: 150,
      type: 'expense',
      date: '2026-05-15',
      description: 'Groceries',
    })
  })

  it('gets main dashboard data', async () => {
    const params = new URLSearchParams({ year: '2026', month: '5' })
    const res = await dashboardMain(params)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalIncome).toBe(3000)
    expect(data.totalExpenses).toBe(150)
    expect(data.recentTransactions).toBeInstanceOf(Array)
    expect(data.expenseByCategory).toBeInstanceOf(Array)
    expect(data.balance).toBeDefined()
  })

  it('gets main dashboard with all-time flag', async () => {
    const params = new URLSearchParams({ all: 'true' })
    const res = await dashboardMain(params)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalIncome).toBeGreaterThanOrEqual(3000)
  })

  it('gets dashboard summary', async () => {
    const params = new URLSearchParams({ year: '2026', month: '5' })
    const res = await dashboardSummary(params)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.summary).toBeDefined()
    expect(data.summary.income).toBe(3000)
    expect(data.summary.expense).toBe(150)
    expect(data.summary.balance).toBe(2850)
    expect(data.recent).toBeInstanceOf(Array)
    expect(data.ytd).toBeDefined()
    expect(data.currency).toBe('EUR')
  })

  it('gets dashboard summary for a full year', async () => {
    const params = new URLSearchParams({ year: '2026' })
    const res = await dashboardSummary(params)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.summary.income).toBe(3000)
  })

  it('gets dashboard charts', async () => {
    const params = new URLSearchParams({ months: '6' })
    const res = await dashboardCharts(params)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.byCategory).toBeInstanceOf(Array)
    expect(data.monthly).toBeInstanceOf(Array)
    expect(data.cashFlow).toBeInstanceOf(Array)
  })

  it('gets net worth', async () => {
    const res = await dashboardNetWorth()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalNetWorth).toBeDefined()
    expect(data.accounts).toBeInstanceOf(Array)
    expect(data.timeline).toBeInstanceOf(Array)
  })
})
