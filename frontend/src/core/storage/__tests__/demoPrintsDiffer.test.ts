/**
 * The example years differ, so their prints do (3 Nov test run: Every print showed 26 seals that
 * looked alike). The real seed on fake-indexeddb, each year's months as the shelf turns them into
 * petals (shared/prints/shares.ts), from what each month spent and kept.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { flowsOf } from '../../../../../shared/guidance/flows'
import { sealShares } from '../../../../../shared/prints/shares'
import { baseAmount } from '../../achievements/evaluate'
import { getDB, seedDemoProfiles } from '../idb'
import type { Tx } from '../../achievements/evaluate'

type Row = Tx & { profile_id: number }

let byProfile: Map<string, Row[]>

beforeAll(async () => {
  localStorage.clear()
  localStorage.setItem('finance_storage_mode', 'serverless')
  const db = await getDB()
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  await seedDemoProfiles()
  const profiles = (await db.getAll('profiles')) as Array<{ id: number; name: string }>
  const rows = (await db.getAll('transactions')) as Row[]
  byProfile = new Map(profiles.map((p) => [p.name, rows.filter((r) => r.profile_id === p.id)]))
}, 120_000)

/** Each whole calendar year's twelve months: what each spent and kept, from 2000 to last year. */
function years(rows: Row[]): Array<Array<{ spent: number; kept: number }>> {
  const lastYear = new Date().getFullYear() - 1
  const out: Array<Array<{ spent: number; kept: number }>> = []
  for (let year = 2000; year <= lastYear; year++) {
    const months = Array.from({ length: 12 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`
      const { income, spending } = flowsOf(
        rows.filter((r) => r.date.startsWith(key)),
        baseAmount
      )
      return { spent: spending, kept: income - spending }
    })
    out.push(months)
  }
  return out
}

/** How far apart two years' petals are, on average over their months, in share points. */
function apart(a: Array<{ spent: number }>, b: Array<{ spent: number }>): number {
  return a.reduce((sum, m, i) => sum + Math.abs(m.spent - b[i].spent), 0) / a.length
}

describe.each(['Example Mid Income', 'Example High Income'])('the example years of %s', (name) => {
  it('draw petals that differ from one year to the next', () => {
    const petals = years(byProfile.get(name)!).map((months) =>
      sealShares(months).map((m) => ({ spent: m!.spent }))
    )
    const gaps = petals.slice(1).map((year, i) => apart(year, petals[i]))
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    // The seed as it was: 4.4 points apart on average, the closest two years 2.5.
    expect(mean).toBeGreaterThan(10)
    expect(Math.min(...gaps)).toBeGreaterThan(5)
    // Each year has a short petal: a quiet month at about half the heaviest.
    for (const year of petals) expect(Math.min(...year.map((m) => m.spent))).toBeLessThan(75)
  })

  it('never spend more in a month than came in', () => {
    for (const months of years(byProfile.get(name)!)) {
      for (const m of months) expect(m.kept).toBeGreaterThanOrEqual(0)
    }
  })
})
