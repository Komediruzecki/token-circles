/**
 * Dashboard counts months in three places, by two rules (shared/trackedMonths.ts): the badge
 * rail's streak and the "A year" badge count tracked months in a row; Getting started's import
 * step counts tracked months in the last thirteen, gaps allowed. With the same entries the numbers
 * differ, so each surface names what it counts and none reads as another's number.
 */
import { describe, expect, it } from 'vitest'
import { nextSteps } from '../../../../shared/orientation'
import { streakLabel } from '../../components/BadgeRail'
import { achievementById } from '../achievements/definitions'
import { evaluateAchievements } from '../achievements/evaluate'
import { orientationFacts } from '../orientation'
import type { OrientationSource } from '../orientation'

const TODAY = '2026-10-11'

/** Three entries in each month: each one a tracked month, and nothing else to do. */
function threeEach(months: string[]) {
  return months.flatMap((m, i) =>
    [1, 5, 9].map((d, j) => ({
      id: i * 3 + j + 1,
      description: 'SAMPLE SHOP',
      beneficiary: '',
      payor: '',
      notes: '',
      amount: d === 1 ? 500 : -20,
      date: `${m}-${String(d).padStart(2, '0')}`,
      type: d === 1 ? ('income' as const) : ('expense' as const),
      category_id: 1,
      reconciled: false,
    }))
  )
}

/** What Dashboard says about these months. */
function dashboard(months: string[]) {
  const transactions = threeEach(months)
  const evaluation = evaluateAchievements({
    transactions,
    budgets: [],
    goals: [],
    importLogs: [],
    loans: [],
    selfHosted: false,
    today: TODAY,
  })
  const source: OrientationSource = {
    today: TODAY,
    evaluation,
    transactions: transactions as unknown as OrientationSource['transactions'],
    budgets: [
      {
        category_id: 1,
        period: 'monthly',
        start_date: '2026-10-01',
        created_at: '2026-10-01T08:00:00Z',
      },
    ],
    bills: [],
    categories: [{ id: 1, name: 'Groceries' }],
    loans: [],
  }
  const importYear = nextSteps(orientationFacts(source, Date.parse(`${TODAY}T12:00:00Z`))).find(
    (step) => step.id === 'import-year'
  )
  return {
    rail: streakLabel(evaluation.streak),
    aYear: evaluation.earned.some((e) => e.id === 'a-year'),
    importYear: importYear?.reason ?? null,
  }
}

const months = (from: string, to: string): string[] => {
  const out: string[] = []
  for (let [y, m] = from.split('-').map(Number); `${y}-${String(m).padStart(2, '0')}` <= to;) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) [y, m] = [y + 1, 1]
  }
  return out
}

describe('the counts of months on Dashboard', () => {
  it('the "A year" badge says it needs twelve in a row', () => {
    expect(achievementById('a-year').rule).toBe('Twelve tracked months in a row.')
  })

  it('eight tracked months this year with May missing: the run and the window each say which', () => {
    const said = dashboard(months('2026-01', '2026-09').filter((m) => m !== '2026-05'))
    expect(said.rail).toBe('4 months in a row')
    expect(said.importYear).toBe(
      '8 of the last 13 months are tracked. A month counts once it holds 3 entries.'
    )
    expect(said.aYear).toBe(false)
  })

  it('a whole year in 2024 and nothing since: the badge is earned, the window is empty', () => {
    const said = dashboard(months('2024-01', '2024-12'))
    expect(said.aYear).toBe(true)
    expect(said.rail).toBe('Start a streak')
    expect(said.importYear).toBe(
      'None of the last 13 months is tracked yet. A month counts once it holds 3 entries.'
    )
  })

  it('twelve of the last thirteen with May missing: a year on file, but not twelve in a row', () => {
    const said = dashboard(months('2025-10', '2026-10').filter((m) => m !== '2026-05'))
    expect(said.importYear).toBeNull()
    expect(said.aYear).toBe(false)
    expect(said.rail).toBe('5 months in a row')
  })
})
