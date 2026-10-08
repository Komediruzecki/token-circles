/**
 * Local-first answers "today" and "this month" on the person's calendar.
 *
 * The handlers run in the person's browser, so its local clock is theirs. Several of them still
 * read the date through `toISOString()`, which is the UTC calendar: east of UTC that is yesterday
 * for the first hours of every day, and west of UTC it is tomorrow every evening. A month built
 * as local midnight on the 1st and printed with `toISOString()` is the previous month east of
 * UTC at any hour, which is how the budget forecast named October as the month after October.
 *
 * The failures need the UTC and local calendars to disagree, so both the zone and the instant are
 * pinned. Only Date is faked: fake-indexeddb needs real timers to settle.
 *
 *   2026-10-07 23:30 UTC  is 2026-10-08 08:30 in Tokyo
 *   2026-10-08 03:30 UTC  is 2026-10-07 20:30 in Los Angeles
 *   2026-10-31 23:30 UTC  is 2026-11-01 08:30 in Tokyo: a new month
 *   2026-10-15 12:00 UTC  is 2026-10-15 14:00 in Zagreb: an ordinary afternoon
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb.js'
import {
  budgetsAllocate,
  budgetsForecast,
  budgetsZeroBased,
  budgetsZeroBasedSummary,
  dashboardCharts,
  emergencyFund,
  importBulk,
  importExecute,
  loansCreate,
  loansList,
  retirementSettingsGet,
} from '../localHandlers.js'

const LATE_ON_THE_7TH = '2026-10-07T23:30:00Z'
const EARLY_ON_THE_8TH = '2026-10-08T03:30:00Z'
const LAST_OF_OCTOBER = '2026-10-31T23:30:00Z'
const MID_OCTOBER = '2026-10-15T12:00:00Z'

const FOOD = 1

/** Pin the zone and the instant, and prove the pin took: a silent miss tests the host's zone. */
function at(zone: string, offsetMinutes: number, instant: string): void {
  process.env.TZ = zone
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
  expect(new Date().getTimezoneOffset(), `the ${zone} pin must take effect`).toBe(offsetMinutes)
}

async function expense(date: string, amount: number): Promise<void> {
  const db = await getDB()
  await db.add('transactions', {
    profile_id: 1,
    description: 'groceries',
    amount,
    amount_local: amount,
    currency: 'EUR',
    exchange_rate: 1,
    type: 'expense',
    date,
    category_id: FOOD,
    beneficiary: '',
    payor: '',
    notes: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })
}

async function storedTransactionDates(): Promise<string[]> {
  const db = await getDB()
  const rows = (await db.getAll('transactions')) as Array<{ date: string }>
  return rows.map((t) => t.date)
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  const db = await getDB()
  for (const store of [
    'profiles',
    'transactions',
    'categories',
    'accounts',
    'budgets',
    'loans',
    'goals',
    'settings',
  ]) {
    await db.clear(store)
  }
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  await db.add('categories', {
    id: FOOD,
    profile_id: 1,
    name: 'Food',
    type: 'expense',
    color: '#F97316',
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('east of UTC after local midnight (Tokyo, 08:30 on the 8th, UTC still on the 7th)', () => {
  beforeEach(() => {
    at('Asia/Tokyo', -540, LATE_ON_THE_7TH)
  })

  it('the cash-flow chart counts what was entered today, and starts on the 1st', async () => {
    await expense('2026-10-08', 75)
    await expense('2025-10-31', 500)
    const { monthly } = await (await dashboardCharts(new URLSearchParams())).json()
    const months = monthly as Array<{ month: string; expense: number }>
    expect(months.find((m) => m.month === '2026-10')?.expense).toBe(75)
    // Twelve months are November 2025 to October 2026. Local midnight on 1 November, printed with
    // toISOString(), was 31 October, so the chart took in a day of the month before.
    expect(months.find((m) => m.month === '2025-10')).toBeUndefined()
  })

  it('an imported row without a date is dated today', async () => {
    const res = await importBulk({
      items: [{ description: 'undated', amount: '12.50', type: 'expense' }],
    })
    expect(res.status).toBeLessThan(300)
    expect(await storedTransactionDates()).toEqual(['2026-10-08'])
  })

  it('an account an import creates without a balance date opens today', async () => {
    const res = await importExecute({
      rows: [],
      mapping: { category: 0 },
      categoryTypes: { Revolut: 'account' },
      accountBalances: { Revolut: '20' },
    })
    expect(res.status).toBe(200)
    const db = await getDB()
    const accounts = (await db.getAll('accounts')) as Array<{ name: string; starting_date: string }>
    const created = accounts.find((a) => a.name.toLowerCase() === 'revolut')
    expect(created?.starting_date).toBe('2026-10-08')
  })

  it('a loan payment that falls due today counts as made', async () => {
    await loansCreate({
      name: 'Car',
      principal: 12000,
      interest_rate: 0,
      term_months: 12,
      start_date: '2026-10-08',
    })
    const [loan] = await (await loansList()).json()
    expect([loan.remaining_balance, loan.next_payment_date]).toEqual([11000, '2026-11-08'])
  })

  it('the emergency fund averages the twelve months up to today', async () => {
    await expense('2025-10-07', 100)
    await expense('2026-10-01', 300)
    const fund = await (await emergencyFund()).json()
    expect(fund.avgMonthlyExpenses).toBe(300)
  })

  it('the retirement facts cover the twelve months up to today', async () => {
    await expense('2025-10-07', 100)
    await expense('2026-10-01', 300)
    const { facts } = await (await retirementSettingsGet()).json()
    expect(facts.monthsObserved).toBe(1)
  })
})

describe('a new month starts at local midnight (Tokyo, 1 November, UTC still on 31 October)', () => {
  beforeEach(() => {
    at('Asia/Tokyo', -540, LAST_OF_OCTOBER)
  })

  it('zero-based budgeting opens on the local month', async () => {
    const plan = await (await budgetsZeroBased(new URLSearchParams())).json()
    expect(plan.period).toBe('2026-11')
    const summary = await (await budgetsZeroBasedSummary(new URLSearchParams())).json()
    expect(summary.period).toBe('2026-11')
  })

  it('a budget allocated without a month lands in the local one', async () => {
    const made = await (
      await budgetsAllocate(new URLSearchParams(), { category_id: FOOD, amount: 300 })
    ).json()
    expect(made.start_date).toBe('2026-11-01')
  })

  it('the forecast opens on the local month, and its history reaches it', async () => {
    const db = await getDB()
    for (const start of ['2026-10-01', '2026-11-01']) {
      await db.add('budgets', {
        profile_id: 1,
        category_id: FOOD,
        amount: 300,
        period: 'monthly',
        start_date: start,
      })
    }
    const opened = await (await budgetsForecast(new URLSearchParams())).json()
    expect(opened.period).toBe('2026-11')
    const ahead = await (await budgetsForecast(new URLSearchParams({ month: '2026-12' }))).json()
    expect((ahead.history as Array<{ month: string }>).map((h) => h.month)).toEqual([
      '2026-11',
      '2026-10',
    ])
  })

  it('the retirement projection starts in the local month', async () => {
    const settings = await (await retirementSettingsGet()).json()
    expect(settings.startMonth).toBe('2026-11')
  })
})

describe('east of UTC on an ordinary afternoon (Zagreb, 15 October)', () => {
  beforeEach(() => {
    at('Europe/Zagreb', -120, MID_OCTOBER)
  })

  it('the forecast names the six months after this one', async () => {
    const db = await getDB()
    await db.add('budgets', {
      profile_id: 1,
      category_id: FOOD,
      amount: 300,
      period: 'monthly',
      start_date: '2026-09-01',
    })
    const { forecast } = await (await budgetsForecast(new URLSearchParams())).json()
    expect((forecast as Array<{ month: string }>).map((f) => f.month)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ])
  })
})

describe('west of UTC in the evening (Los Angeles, 20:30 on the 7th, UTC already on the 8th)', () => {
  beforeEach(() => {
    at('America/Los_Angeles', 420, EARLY_ON_THE_8TH)
  })

  it('the cash-flow chart stops at today: what is dated tomorrow waits', async () => {
    await expense('2026-10-07', 100)
    await expense('2026-10-08', 75)
    const { monthly } = await (await dashboardCharts(new URLSearchParams())).json()
    const months = monthly as Array<{ month: string; expense: number }>
    expect(months.find((m) => m.month === '2026-10')?.expense).toBe(100)
  })

  it('an imported row without a date is dated today, not tomorrow', async () => {
    await importBulk({ items: [{ description: 'undated', amount: '12.50', type: 'expense' }] })
    expect(await storedTransactionDates()).toEqual(['2026-10-07'])
  })
})
