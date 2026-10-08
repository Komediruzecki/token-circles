/**
 * The budget forecast's history names each month as itself, in every timezone.
 *
 * Each history entry was labelled by parsing `YYYY-MM-01` as UTC midnight and formatting it in
 * the browser's zone. West of UTC that midnight is the evening before, so March was labelled
 * "Feb 2026" in New York. The Worker labels in UTC, so the two runtimes named the same month
 * differently. CI runs in UTC, where the bug does not show, so the zone is pinned here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDB } from '../idb.js'
import { budgetsForecast } from '../localHandlers.js'

const hostZone = process.env.TZ

afterEach(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('currentProfileId', '1')
  localStorage.setItem('selectedProfileIds', '[1]')
  const db = await getDB()
  for (const store of ['profiles', 'transactions', 'categories', 'budgets']) await db.clear(store)
  await db.add('profiles', { id: 1, name: 'Test', created_at: '2026-01-01' })
  await db.add('categories', { id: 1, profile_id: 1, name: 'Food', type: 'expense' })
  for (const month of ['2026-02', '2026-03']) {
    await db.add('budgets', {
      profile_id: 1,
      category_id: 1,
      amount: 200,
      period: 'monthly',
      start_date: `${month}-01`,
    })
  }
  await db.add('transactions', {
    profile_id: 1,
    description: 'groceries',
    amount: 50,
    amount_local: 50,
    currency: 'EUR',
    type: 'expense',
    date: '2026-03-10',
    category_id: 1,
  })
})

describe('the forecast history labels', () => {
  for (const zone of ['UTC', 'America/New_York', 'Pacific/Pago_Pago', 'Asia/Tokyo']) {
    it(`name each month as itself in ${zone}`, async () => {
      process.env.TZ = zone
      const forecast = await (
        await budgetsForecast(new URLSearchParams({ month: '2026-04' }))
      ).json()
      expect(
        forecast.history.map((h: { month: string; label: string }) => [h.month, h.label])
      ).toEqual([
        ['2026-03', 'Mar 2026'],
        ['2026-02', 'Feb 2026'],
      ])
    })
  }
})
