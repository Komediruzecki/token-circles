import { beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import {
  accountsReconciliationSummary,
  getCounterparties,
  reconcileSummary,
  reportHandler,
  reportsCustom,
  transactionsSummary,
} from '../localHandlers.js'

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['transactions', 'categories', 'accounts', 'profiles'] as const) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Main', created_at: '2026-01-01' })
  await db.add('categories', {
    id: 1,
    profile_id: 1,
    name: 'Travel',
    type: 'expense',
    color: '#f97316',
    tax_deductible: 1,
  })
  await db.add('categories', {
    id: 2,
    profile_id: 1,
    name: 'Salary',
    type: 'income',
    color: '#22c55e',
  })
  await db.add('accounts', {
    id: 1,
    profile_id: 1,
    name: 'Current',
    type: 'giro',
    balance: 0,
    starting_balance: 0,
    currency: 'EUR',
  })
  await db.add('transactions', {
    profile_id: 1,
    description: 'Toll',
    amount: 19,
    amount_local: 2.47,
    currency: 'HRK',
    type: 'expense',
    date: '2026-03-10',
    category_id: 1,
    account_id: 1,
    beneficiary: 'Road Co',
    payor: '',
    reconciled: 0,
  })
  await db.add('transactions', {
    profile_id: 1,
    description: 'Paycheck',
    amount: 9329,
    amount_local: 1212.77,
    currency: 'HRK',
    type: 'income',
    date: '2026-03-01',
    category_id: 2,
    account_id: 1,
    beneficiary: '',
    payor: 'Employer',
    reconciled: 1,
  })
})

describe('local base-currency aggregate contracts', () => {
  it('normalizes transaction and reconciliation summaries', async () => {
    const summary = await (await transactionsSummary()).json()
    expect(summary.totalIncome).toBeCloseTo(1212.77, 2)
    expect(summary.totalExpenses).toBeCloseTo(2.47, 2)

    const reconciliation = await (await reconcileSummary()).json()
    expect(reconciliation.reconciled_total).toBeCloseTo(1212.77, 2)
    expect(reconciliation.unreconciled_total).toBeCloseTo(2.47, 2)

    const account = await (await accountsReconciliationSummary({ p1: '1' })).json()
    expect(account.unreconciled_total).toBeCloseTo(2.47, 2)
  })

  it('normalizes incoming and outgoing counterparty totals', async () => {
    const counterparties = (await (await getCounterparties()).json()) as Array<{
      name: string
      incoming: number
      outgoing: number
    }>
    expect(counterparties.find((row) => row.name === 'Road Co')?.outgoing).toBeCloseTo(2.47, 2)
    expect(counterparties.find((row) => row.name === 'Employer')?.incoming).toBeCloseTo(1212.77, 2)
  })

  it('normalizes tax and profit/loss reports', async () => {
    const tax = await (
      await reportHandler({
        path: '/api/reports/tax-summary',
        query: new URLSearchParams({ year: '2026' }),
      })
    ).json()
    expect(tax.taxDeductibleTotal).toBeCloseTo(2.47, 2)
    expect(tax.totalExpenses).toBeCloseTo(2.47, 2)

    const profitLoss = await (
      await reportHandler({
        path: '/api/reports/pl-summary',
        query: new URLSearchParams({ year: '2026' }),
      })
    ).json()
    expect(profitLoss.income.total).toBeCloseTo(1212.77, 2)
    expect(profitLoss.expenses.total).toBeCloseTo(2.47, 2)
  })

  it('joins category names and normalized amounts in custom reports', async () => {
    const report = await (
      await reportsCustom({ date_from: '2026-01-01', date_to: '2026-12-31' })
    ).json()
    expect(report.summary.totalIncome).toBeCloseTo(1212.77, 2)
    expect(report.summary.totalExpenses).toBeCloseTo(2.47, 2)
    expect(report.byCategory.Travel.total).toBeCloseTo(2.47, 2)
    expect(report.byCategory.Salary.total).toBeCloseTo(1212.77, 2)
    expect(report.byCategory.Uncategorized).toBeUndefined()
  })
})
