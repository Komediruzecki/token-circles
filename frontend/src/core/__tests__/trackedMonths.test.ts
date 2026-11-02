/**
 * One definition of a tracked month and of a year on file (shared/trackedMonths.ts), read by the
 * badges, the year in review, the streak card and Getting started, so no two of them can disagree
 * about a count.
 */
import { describe, expect, it } from 'vitest'
import {
  isTrackedMonth,
  TRACKED_MONTH_MIN_TRANSACTIONS,
  trackedMonthsInYearWindow,
  trackedMonthsOf,
  YEAR_ON_FILE_MONTHS,
  YEAR_WINDOW_MONTHS,
} from '../../../../shared/trackedMonths'
import { adviceInput, input, month, tx } from '../achievements/__tests__/fixtures'
import { buildAdvice } from '../achievements/advice'
import { evaluateAchievements } from '../achievements/evaluate'
import { buildYearReview } from '../achievements/review'
import { shelfView } from '../prints/shelf'

/** `n` dates inside `m` ('YYYY-MM'). */
const dates = (m: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)

/** The 'YYYY-MM' months from `first` to `last`, inclusive. */
function monthsFrom(first: string, last: string): string[] {
  const out: string[] = []
  let [y, m] = first.split('-').map(Number)
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`
    out.push(month)
    if (month === last) return out
    m++
    if (m === 13) {
      m = 1
      y++
    }
  }
}

describe('a tracked month', () => {
  it('holds three entries or more', () => {
    expect(TRACKED_MONTH_MIN_TRANSACTIONS).toBe(3)
    expect([0, 2, 3, 40].map(isTrackedMonth)).toEqual([false, false, true, true])
  })

  it('is counted by the dates inside it, whatever the entries are', () => {
    const list = [
      ...dates('2026-03', 3),
      ...dates('2026-01', 2),
      ...dates('2025-12', 5),
      // A datetime still names its month; text that is not a date names none, however often.
      '2026-01-31T23:00:00Z',
      '',
      'not a date',
      '31.01.2026',
      'soon',
      'soon',
      'soon',
    ]
    expect(trackedMonthsOf(list)).toEqual(['2025-12', '2026-01', '2026-03'])
    expect(trackedMonthsOf([])).toEqual([])
  })
})

describe('a year on file', () => {
  it('is twelve tracked months among this month and the twelve before it', () => {
    expect(YEAR_ON_FILE_MONTHS).toBe(12)
    expect(YEAR_WINDOW_MONTHS).toBe(13)

    // October 2025 to September 2026: a year imported up to last month.
    const lastYear = monthsFrom('2025-10', '2026-09')
    expect(trackedMonthsInYearWindow(lastYear, '2026-10-01')).toBe(12)
    // A month later, October 2025 has left the window.
    expect(trackedMonthsInYearWindow(lastYear, '2026-11-30')).toBe(11)
  })

  it('counts this month once it is tracked, and allows one month missing', () => {
    // November 2025 to October 2026, with March missing: twelve of the thirteen.
    const withGap = monthsFrom('2025-10', '2026-10').filter((m) => m !== '2026-03')
    expect(trackedMonthsInYearWindow(withGap, '2026-10-11')).toBe(12)
    expect(trackedMonthsInYearWindow(withGap.slice(1), '2026-10-11')).toBe(11)
  })

  it('counts nothing outside the window, and a month once', () => {
    const old = monthsFrom('2023-01', '2024-12')
    expect(trackedMonthsInYearWindow(old, '2026-10-11')).toBe(0)
    expect(
      trackedMonthsInYearWindow(['2025-09', '2026-11', '2026-10', '2026-10'], '2026-10-11')
    ).toBe(1)
    // Across a new year: January 2027's window starts at January 2026.
    expect(trackedMonthsInYearWindow(['2025-12', '2026-01', '2027-01'], '2027-01-05')).toBe(2)
  })
})

describe('every count reads the same rule', () => {
  // Two entries in July, exactly three in August (one of them income), a transfer in September,
  // and dates that name no month.
  const transactions = [
    ...month('2026-07', 2),
    ...month('2026-08', 2),
    tx('2026-08-20', { type: 'income' }),
    tx('2026-09-02', { type: 'transfer' }),
    tx(''),
    tx('soon'),
  ]

  it('the badges track the months trackedMonthsOf finds', () => {
    const evaluation = evaluateAchievements(input({ transactions, today: '2026-09-07' }))
    expect(evaluation.trackedMonths).toEqual(trackedMonthsOf(transactions.map((t) => t.date)))
    expect(evaluation.trackedMonths).toEqual(['2026-08'])
  })

  it('the year in review counts the same months', () => {
    const review = buildYearReview({ transactions, today: '2026-09-07' })
    expect(review.trackedMonths).toBe(
      trackedMonthsOf(transactions.map((t) => t.date)).filter((m) => m.startsWith('2026')).length
    )
  })

  it('the streak card asks for what a month still needs to be tracked', () => {
    const streak = [...month('2026-07', 3), ...month('2026-08', 3)]
    const twoShort = Array.from({ length: TRACKED_MONTH_MIN_TRANSACTIONS - 1 }, (_, i) =>
      tx(`2026-09-0${i + 1}`)
    )
    const cards = buildAdvice(
      adviceInput({ transactions: [...streak, ...twoShort], today: '2026-09-27' }),
      2
    )
    expect(cards.find((c) => c.kind === 'streak-at-risk')?.figure).toBe('1 entry to go')

    const done = [...twoShort, tx('2026-09-05')]
    expect(isTrackedMonth(done.length)).toBe(true)
    const after = buildAdvice(
      adviceInput({ transactions: [...streak, ...done], today: '2026-09-27' }),
      2
    )
    expect(after.map((c) => c.kind)).not.toContain('streak-at-risk')
  })
})

describe('a month that has not begun', () => {
  // A year from October 2025 to September 2026, and December's bills put in early.
  const today = '2026-10-31'
  const year = monthsFrom('2025-10', '2026-09')
  const transactions = [...year.flatMap((m) => month(m, 3)), ...month('2026-12', 3)]

  it('is not tracked, however many entries are dated in it', () => {
    expect(
      trackedMonthsOf(
        transactions.map((t) => t.date),
        today
      )
    ).toEqual(year)
    // Without a today, every month that holds three entries counts, as before.
    expect(trackedMonthsOf(transactions.map((t) => t.date))).toEqual([...year, '2026-12'])
  })

  it('counts toward no badge, and the year in review leaves it out', () => {
    const evaluation = evaluateAchievements(input({ transactions, today }))
    expect(evaluation.trackedMonths).toEqual(year)
    expect(buildYearReview({ transactions, today }).trackedMonths).toBe(9)
    // On its own, December earns One month only once December has come.
    const early = evaluateAchievements(input({ transactions: month('2026-12', 3), today }))
    expect(early.earned.map((e) => e.id)).not.toContain('one-month')
    const due = evaluateAchievements(
      input({ transactions: month('2026-12', 3), today: '2026-12-04' })
    )
    expect(due.earned).toContainEqual({ id: 'one-month', earnedOn: '2026-12-01' })
  })

  it('leaves the prints alone: the year is a print, and the next plate starts in October', () => {
    const { trackedMonths } = evaluateAchievements(input({ transactions, today }))
    const view = shelfView({ transactions, trackedMonths, today })
    expect(view.prints.map((p) => p.from)).toEqual(['2025-10'])
    // Not a plate of one month from December, as the entries dated ahead made it.
    expect(view.plate).toMatchObject({ from: '2026-10', months: 0 })
  })
})
