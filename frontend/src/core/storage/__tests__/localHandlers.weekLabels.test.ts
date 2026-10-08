/**
 * Local-first's week list labels each week with its Sunday and Saturday on the person's calendar.
 *
 * The week's days were local midnights printed with toISOString(), the UTC date: east of UTC that
 * is the day before, so in Zagreb every week read Saturday to Friday.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { analyticsWeeks } from '../localHandlers.js'

const hostZone = process.env.TZ

afterEach(() => {
  if (hostZone === undefined) delete process.env.TZ
  else process.env.TZ = hostZone
})

for (const zone of ['Europe/Zagreb', 'Pacific/Kiritimati', 'America/New_York']) {
  describe(`week labels in ${zone}`, () => {
    it('run Sunday to Saturday', async () => {
      process.env.TZ = zone
      const { weeks } = await (
        await analyticsWeeks(new URLSearchParams({ year: '2026', month: '10' }))
      ).json()
      const labels = (weeks as Array<{ label: string }>).map((w) => w.label)
      expect(labels.slice(0, 2)).toEqual([
        'Week 1 (2026-09-27 - 2026-10-03)',
        'Week 2 (2026-10-04 - 2026-10-10)',
      ])
    })
  })
}
