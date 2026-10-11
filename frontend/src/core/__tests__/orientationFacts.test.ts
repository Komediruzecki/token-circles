/**
 * The facts Getting started reads (core/orientation.ts), built from what the last badge
 * evaluation loaded. Each count comes from the function its own page uses: the tracked months
 * from the badges, the subscriptions from the scan's own window and tick rule, the month and the
 * category from the Progress page's advice. These tests pin that they agree.
 */
import { describe, expect, it } from 'vitest'
import { nextSteps } from '../../../../shared/orientation'
import { trackedMonthsInYearWindow } from '../../../../shared/trackedMonths'
import { detectSubscriptions } from '../../features/subscriptionDetection'
import { buildAdvice } from '../achievements/advice'
import { evaluateAchievements } from '../achievements/evaluate'
import { orientationFacts } from '../orientation'
import type { AchievementsSnapshot } from '../achievementsStore'
import type { OrientationSource } from '../orientation'

const TODAY = '2026-10-11'
const NOW = Date.parse('2026-10-11T09:00:00Z')

type Row = OrientationSource['transactions'][number]

/** An expense at a shop the scan knows nothing about, unless `over` says otherwise. */
function row(date: string, over: Partial<Row> = {}): Row {
  return {
    date,
    type: 'expense',
    amount: 10,
    category_id: 1,
    reconciled: false,
    description: 'KONZUM ZAGREB',
    ...over,
  }
}

/** `n` entries dated inside `month`, day 3 onwards. */
const entries = (month: string, n: number, over: Partial<Row> = {}): Row[] =>
  Array.from({ length: n }, (_, i) => row(`${month}-${String(3 + i).padStart(2, '0')}`, over))

const categories = [
  { id: 1, name: 'Household' },
  { id: 7, name: 'Groceries' },
  { id: 8, name: 'Rent' },
  { id: 9, name: 'Transport' },
  { id: 10, name: 'Travel' },
]

function source(transactions: Row[], over: Partial<OrientationSource> = {}): OrientationSource {
  return {
    today: TODAY,
    evaluation: evaluateAchievements({
      transactions,
      budgets: [],
      goals: [],
      importLogs: [],
      loans: [],
      selfHosted: false,
      today: TODAY,
    }),
    transactions,
    budgets: [],
    bills: [],
    categories,
    loans: [],
    ...over,
  }
}

/** September 2026, the last full month: it earned 1000 and spent 1263. */
const september = [
  row('2026-09-01', { type: 'income', amount: 1000, category_id: null }),
  row('2026-09-02', { amount: -300, category_id: 7 }),
  row('2026-09-03', { amount: -900, category_id: 8 }),
  row('2026-09-04', { amount: -50, category_id: 9 }),
  row('2026-09-14', { amount: -13, category_id: 1, description: 'NETFLIX.COM' }),
]

const transactions = [
  // Netflix, three months running: a subscription the scan ticks.
  row('2026-07-14', { amount: -13, description: 'NETFLIX.COM' }),
  row('2026-08-14', { amount: -13, description: 'NETFLIX.COM' }),
  ...september,
  // Spotify is a bill already.
  row('2026-08-01', { amount: -11.99, description: 'SPOTIFY' }),
  row('2026-09-01', { amount: -11.99, description: 'SPOTIFY' }),
  // Disney+, three months running, but in 2023: outside the scan's 750 days.
  row('2023-01-03', { amount: -8.99, description: 'DISNEY PLUS' }),
  row('2023-02-03', { amount: -8.99, description: 'DISNEY PLUS' }),
  row('2023-03-03', { amount: -8.99, description: 'DISNEY PLUS' }),
  // Tracked months: June to September 2026, January 2026, and May 2024 (before the year).
  ...entries('2024-05', 3),
  ...entries('2026-06', 3),
  ...entries('2026-07', 2),
  ...entries('2026-08', 1),
  ...entries('2026-01', 3, { category_id: null }),
  // This month: a big trip, and a transfer with no category.
  row('2026-10-02', { amount: -5000, category_id: 10 }),
  row('2026-10-03', { type: 'transfer', amount: -200, category_id: null }),
]

describe('the facts', () => {
  const facts = orientationFacts(
    source(transactions, {
      budgets: [{ category_id: 9 }],
      bills: [
        { name: 'Rent', category_id: 8 },
        { name: 'Spotify', category_id: null },
      ],
      loans: [{}],
    }),
    NOW
  )

  it('count the tracked months the badges count, in the year window', () => {
    const evaluation = source(transactions).evaluation
    expect(evaluation.trackedMonths).toEqual([
      '2024-05',
      '2026-01',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ])
    expect(facts.trackedMonthsInYear).toBe(5)
    expect(facts.trackedMonthsInYear).toBe(
      trackedMonthsInYearWindow(evaluation.trackedMonths, TODAY)
    )
  })

  it("count the subscriptions the scan would tick, inside the scan's window", () => {
    expect(facts.subscriptionsSpotted).toBe(1)
    // Netflix is a subscription, not a bill.
    expect(facts.billsSpotted).toBe(0)
  })

  it('count every entry but transfers, and those without a category', () => {
    expect(facts.entries).toBe(transactions.length - 1)
    // September's income and January's three.
    expect(facts.uncategorised).toBe(4)
  })

  it('name the biggest category with no budget or bill in the last full month', () => {
    // Rent has a bill and Transport a budget; October's trip is not a full month yet.
    expect(facts.topUnbudgeted).toEqual({ categoryId: 7, name: 'Groceries' })
  })

  it('name the last full month when it spent more than it earned', () => {
    expect(facts.heavyMonth).toBe('2026-09')
  })

  it('count the loans', () => {
    expect(facts.loans).toBe(1)
    expect(facts.today).toBe(TODAY)
  })
})

describe('a regular payment the scan proposed', () => {
  // A gym the scan has no name for, monthly, its payee holding digits.
  const gym = ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05'].map((date) =>
    row(date, { amount: -29.9, description: 'FIT24 STUDIO', category_id: null })
  )

  it('is counted until it is added as a bill under the name it was proposed under', () => {
    const before = orientationFacts(source(gym), NOW)
    expect(before.subscriptionsSpotted).toBe(1)
    // With no category to say it is a subscription, it is a bill, and the step says so.
    expect(before.billsSpotted).toBe(1)
    expect(nextSteps(before).find((s) => s.id === 'review-subscriptions')?.title).toBe(
      'Review the regular payment we spotted'
    )

    const [proposed] = detectSubscriptions(gym, [], { today: TODAY })
    const after = orientationFacts(source(gym, { bills: [{ name: proposed.name }] }), NOW)
    expect(after.subscriptionsSpotted).toBe(0)
    expect(nextSteps(after).map((s) => s.id)).not.toContain('review-subscriptions')
  })
})

describe('agreeing with the advice', () => {
  const advice = (list: Row[]) =>
    buildAdvice({
      transactions: list,
      budgets: [],
      goals: [],
      importLogs: [],
      loans: [],
      selfHosted: false,
      today: TODAY,
      categories,
      bills: [],
      dismissed: [],
    })

  it('a month the advice calls in the red is the heavy month, and only then', () => {
    const red = advice(transactions).find((card) => card.kind === 'in-the-red')
    expect(red?.id).toBe('in-the-red:2026-09')
    expect(orientationFacts(source(transactions), NOW).heavyMonth).toBe('2026-09')

    const balanced = transactions.filter((t) => t.category_id !== 8)
    expect(advice(balanced).map((card) => card.kind)).not.toContain('in-the-red')
    expect(orientationFacts(source(balanced), NOW).heavyMonth).toBeNull()
  })

  it('a category the profile has no name for is not offered', () => {
    const facts = orientationFacts(
      source([row('2026-09-02', { amount: -300, category_id: 99 })]),
      NOW
    )
    expect(facts.topUnbudgeted).toBeNull()
  })
})

describe('the source', () => {
  it('is the snapshot the badges were evaluated on', () => {
    // Fails to compile if the store's snapshot stops carrying what the facts read.
    const fromStore = (snapshot: AchievementsSnapshot): OrientationSource => snapshot
    expect(fromStore).toBeTypeOf('function')
  })
})
