/**
 * Local-first months on the 29th to the 31st: the twins of worker/test/calendar-months.test.ts.
 *
 * Date.setMonth() overflows when the month it lands in is shorter: 31 October minus eleven months
 * is 31 November, which is 1 December. The handlers run in the person's browser, so the zone is
 * pinned as well as the instant. Only Date is faked: fake-indexeddb needs real timers to settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb.js'
import {
  billsCalendar,
  budgetsForecast,
  dashboardCharts,
  recurringPopulate,
} from '../localHandlers.js'

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
    'recurring',
    'bills',
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

describe('the cash-flow chart on 31 October (Zagreb)', () => {
  it('keeps November', async () => {
    at('Europe/Zagreb', -60, '2026-10-31T12:00:00Z')
    await expense('2025-11-05', 40)
    await expense('2026-10-02', 10)

    const { monthly } = await (await dashboardCharts(new URLSearchParams())).json()
    const months = monthly as Array<{ month: string; expense: number }>
    expect(months[0]?.month).toBe('2025-11')
    expect(months.find((m) => m.month === '2025-11')?.expense).toBe(40)
  })
})

describe('the budget forecast', () => {
  it('counts the budgets that start in the month it is asked for', async () => {
    at('Europe/Zagreb', -120, '2026-10-15T12:00:00Z')
    const db = await getDB()
    await db.add('budgets', {
      profile_id: 1,
      category_id: FOOD,
      amount: 300,
      period: 'monthly',
      start_date: '2026-10-01',
    })

    const queries: Record<string, string>[] = [{ month: '2026-10' }, {}]
    for (const query of queries) {
      const forecast = await (await budgetsForecast(new URLSearchParams(query))).json()
      expect(forecast.total_budget, JSON.stringify(query)).toBe(300)
      expect(forecast.forecast, JSON.stringify(query)).toHaveLength(6)
    }
  })
})

describe('a monthly rule on the 31st', () => {
  async function rule(fields: Record<string, unknown>): Promise<number> {
    const db = await getDB()
    return (await db.add('recurring', {
      profile_id: 1,
      description: 'Rent',
      amount: 250,
      type: 'expense',
      category_id: FOOD,
      frequency: 'monthly',
      is_active: 1,
      ...fields,
    })) as number
  }

  async function nextDateOf(id: number): Promise<string> {
    const db = await getDB()
    return ((await db.get('recurring', id)) as { next_date: string }).next_date
  }

  async function paidOn(): Promise<string[]> {
    const db = await getDB()
    return ((await db.getAll('transactions')) as Array<{ date: string }>).map((t) => t.date).sort()
  }

  it('is paid at the end of February, and on the 31st again in March', async () => {
    const id = await rule({ next_date: '2027-01-31', day_of_month: 31 })
    at('Europe/Zagreb', -60, '2027-01-31T12:00:00Z')
    expect((await recurringPopulate({ p1: String(id) })).status).toBe(200)
    expect(await nextDateOf(id)).toBe('2027-02-28')

    at('Europe/Zagreb', -60, '2027-02-28T12:00:00Z')
    expect((await recurringPopulate({ p1: String(id) })).status).toBe(200)
    expect(await nextDateOf(id)).toBe('2027-03-31')
    expect(await paidOn()).toEqual(['2027-01-31', '2027-02-28'])
  })

  it('refuses a next date it cannot read, and writes nothing', async () => {
    const id = await rule({ next_date: '05.01.2027' })
    at('Europe/Zagreb', -60, '2027-01-10T12:00:00Z')
    const res = await recurringPopulate({ p1: String(id) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(
      "This rule's next date can't be read. Edit the rule and set its date again."
    )
    expect(await paidOn()).toEqual([])
    expect(await nextDateOf(id)).toBe('05.01.2027')
  })
})

describe('the bills calendar', () => {
  type Calendar = {
    days: Record<string, Array<{ id: number; date: string }>>
    summary: { totalAmount: number; billCount: number }
  }

  async function bill(fields: Record<string, unknown>): Promise<number> {
    const db = await getDB()
    return (await db.add('bills', {
      profile_id: 1,
      name: 'Rent',
      amount: 600,
      is_active: 1,
      ...fields,
    } as never)) as number
  }

  async function calendar(year: number, month: number): Promise<Calendar> {
    const query = new URLSearchParams({ year: String(year), month: String(month) })
    return (await billsCalendar(query)).json()
  }

  /** The dates `id` is drawn on in that month's calendar. */
  async function drawnOn(id: number, year: number, month: number): Promise<string[]> {
    return Object.values((await calendar(year, month)).days)
      .flat()
      .filter((b) => b.id === id)
      .map((b) => b.date)
  }

  it('draws a monthly bill due on the 31st on the last day of a shorter month', async () => {
    at('Europe/Zagreb', -60, '2027-01-10T12:00:00Z')
    const id = await bill({ frequency: 'monthly', day_of_month: 31, due_date: '2027-01-31' })
    expect(await drawnOn(id, 2027, 1)).toEqual(['2027-01-31'])
    expect(await drawnOn(id, 2027, 2)).toEqual(['2027-02-28'])
    expect(await drawnOn(id, 2027, 3)).toEqual(['2027-03-31'])
    expect(await drawnOn(id, 2027, 4)).toEqual(['2027-04-30'])
    expect(await drawnOn(id, 2028, 2)).toEqual(['2028-02-29'])
  })

  it('counts it in the month it is drawn in', async () => {
    at('Europe/Zagreb', -60, '2027-02-10T12:00:00Z')
    await bill({ frequency: 'monthly', day_of_month: 30, due_date: '2027-01-30' })
    const february = await calendar(2027, 2)
    expect(february.summary).toMatchObject({ totalAmount: 600, billCount: 1 })
    expect(february.days['28']?.map((b) => b.date)).toEqual(['2027-02-28'])
  })
})
