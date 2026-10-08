/**
 * Local-first months on the 29th to the 31st: the twins of worker/test/calendar-months.test.ts.
 *
 * Date.setMonth() overflows when the month it lands in is shorter: 31 October minus eleven months
 * is 31 November, which is 1 December. The handlers run in the person's browser, so the zone is
 * pinned as well as the instant. Only Date is faked: fake-indexeddb needs real timers to settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDB } from '../idb.js'
import { dashboardCharts } from '../localHandlers.js'

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
  for (const store of ['profiles', 'transactions', 'categories', 'accounts', 'recurring']) {
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
