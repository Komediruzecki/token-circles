/**
 * A local-first budget's spending window is [start_date, endOfNextMonth(start_date)): March's runs
 * from 2026-03-01 up to, not including, 2026-04-01.
 *
 * endOfNextMonth parsed the date as UTC midnight, moved it with the local-time setters and printed
 * it as UTC again. Wherever the local offset differs between the two ends (a daylight-saving change
 * in between, or a zone west of UTC, where UTC midnight is the evening before), the end came out a
 * day or more early: March ended on the 31st in Zagreb and on the 28th in New York, so a zero-based
 * budget for March left out the last days of the month.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { endOfNextMonth } from '../handlers/helpers.js'
import { getDB } from '../idb.js'
import { budgetsZeroBased } from '../localHandlers.js'

const ZONES = [
  'UTC',
  'Europe/Zagreb',
  'America/New_York',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
]
const hostZone = process.env.TZ

afterEach(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

describe('endOfNextMonth', () => {
  for (const zone of ZONES) {
    it(`is the same day a month later, on every month of the year, in ${zone}`, () => {
      process.env.TZ = zone
      const ends = Array.from({ length: 12 }, (_, i) => {
        const month = String(i + 1).padStart(2, '0')
        return endOfNextMonth(`2026-${month}-01`)
      })
      expect(ends).toEqual([
        '2026-02-01',
        '2026-03-01',
        '2026-04-01',
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
        '2026-09-01',
        '2026-10-01',
        '2026-11-01',
        '2026-12-01',
        '2027-01-01',
      ])
    })

    it(`stops at the last day of a shorter month, in ${zone}`, () => {
      process.env.TZ = zone
      expect(endOfNextMonth('2026-01-31')).toBe('2026-02-28')
      expect(endOfNextMonth('2028-01-31')).toBe('2028-02-29')
      expect(endOfNextMonth('2026-03-31')).toBe('2026-04-30')
      expect(endOfNextMonth('2026-12-15')).toBe('2027-01-15')
    })
  }
})

describe('a zero-based budget for March counts the whole of March', () => {
  beforeEach(async () => {
    localStorage.clear()
    localStorage.setItem('currentProfileId', '1')
    const db = await getDB()
    for (const store of ['profiles', 'transactions', 'categories', 'budgets']) await db.clear(store)
    await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
    await db.add('categories', {
      id: 1,
      profile_id: 1,
      name: 'Food',
      type: 'expense',
      color: '#F97316',
    })
    for (const [date, amount] of [
      ['2026-03-15', 10],
      ['2026-03-31', 100],
    ] as const) {
      await db.add('transactions', {
        profile_id: 1,
        description: 'groceries',
        amount,
        amount_local: amount,
        currency: 'EUR',
        exchange_rate: 1,
        type: 'expense',
        date,
        category_id: 1,
        beneficiary: '',
        payor: '',
        notes: '',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      })
    }
  })

  for (const zone of ['Europe/Zagreb', 'America/New_York']) {
    it(`in ${zone}`, async () => {
      process.env.TZ = zone
      const plan = await (await budgetsZeroBased(new URLSearchParams({ month: '2026-03' }))).json()
      const food = (plan.allocations as Array<{ category_name: string; spent: number }>).find(
        (c) => c.category_name === 'Food'
      )
      expect(food?.spent).toBe(110)
    })
  }
})
