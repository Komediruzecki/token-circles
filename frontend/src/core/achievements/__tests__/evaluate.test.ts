import { describe, expect, it } from 'vitest'
import { evaluateAchievements } from '../evaluate'
import { input, month, trackedRun, tx } from './fixtures'

type Result = ReturnType<typeof evaluateAchievements>
const ids = (r: Result): string[] => r.earned.map((e) => e.id)
const on = (r: Result, id: string): string | undefined =>
  r.earned.find((e) => e.id === id)?.earnedOn

describe('evaluateAchievements', () => {
  it('earns nothing from nothing', () => {
    const r = evaluateAchievements(input())
    expect(r.earned).toEqual([])
    expect(r.streak).toBe(0)
  })

  it('first entry is dated to the month of the earliest transaction', () => {
    const r = evaluateAchievements(input({ transactions: [tx('2026-08-20'), tx('2025-03-02')] }))
    expect(ids(r)).toEqual(['first-entry'])
    expect(on(r, 'first-entry')).toBe('2025-03-01')
  })

  it('a month needs three transactions to be tracked', () => {
    expect(ids(evaluateAchievements(input({ transactions: month('2026-09', 2) })))).toEqual([
      'first-entry',
    ])
    const r = evaluateAchievements(input({ transactions: month('2026-09', 3) }))
    expect(ids(r)).toContain('one-month')
    expect(r.streak).toBe(1)
    expect(r.trackedMonths).toEqual(['2026-09'])
  })

  it('two years of history unlocks the whole ladder, each dated to the month reached', () => {
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-08', 24) }))
    expect(ids(r)).toEqual(
      expect.arrayContaining(['one-month', 'a-quarter', 'half-a-year', 'a-year', 'two-years'])
    )
    expect(on(r, 'one-month')).toBe('2024-09-01')
    expect(on(r, 'a-quarter')).toBe('2024-11-01')
    expect(on(r, 'half-a-year')).toBe('2025-02-01')
    expect(on(r, 'a-year')).toBe('2025-08-01')
    expect(on(r, 'two-years')).toBe('2026-08-01')
    expect(r.streak).toBe(24)
  })

  it('a gap ends the streak but keeps what an earlier run earned', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2025-06', 6), ...trackedRun('2026-08', 2)] })
    )
    expect(ids(r)).toContain('half-a-year')
    expect(ids(r)).not.toContain('a-year')
    expect(r.streak).toBe(2)
  })

  it('a profile that only imports still tracks months, and first import is dated to the log', () => {
    const r = evaluateAchievements(
      input({
        transactions: trackedRun('2026-08', 3),
        importLogs: [{ created_at: '2026-09-01T10:00:00Z' }],
      })
    )
    expect(ids(r)).toEqual(expect.arrayContaining(['first-import', 'a-quarter']))
    expect(on(r, 'first-import')).toBe('2026-09-01')
  })

  it('saver runs need income above spending in consecutive tracked months', () => {
    const saving = (m: string) => [
      ...month(m, 3, { type: 'expense', amount: 100 }),
      tx(`${m}-25`, { type: 'income', amount: 1000 }),
    ]
    const r = evaluateAchievements(
      input({ transactions: [...saving('2026-05'), ...saving('2026-06'), ...saving('2026-07')] })
    )
    expect(ids(r)).toContain('saver-x3')
    expect(on(r, 'saver-x3')).toBe('2026-07-01')
    expect(ids(r)).not.toContain('saver-x6')
    const broken = evaluateAchievements(
      input({
        transactions: [
          ...saving('2026-05'),
          ...month('2026-06', 3, { amount: 5000 }),
          ...saving('2026-07'),
        ],
      })
    )
    expect(ids(broken)).not.toContain('saver-x3')
  })

  it('named everything needs a tracked month with every non-transfer transaction categorised', () => {
    const r = evaluateAchievements(
      input({
        transactions: [
          ...month('2026-07', 3),
          tx('2026-07-20', { type: 'transfer', category_id: null }),
        ],
      })
    )
    expect(ids(r)).toContain('named-everything')
    const messy = evaluateAchievements(
      input({ transactions: [...month('2026-07', 3), tx('2026-07-21', { category_id: null })] })
    )
    expect(ids(messy)).not.toContain('named-everything')
  })

  it('held the line needs a finished month with every monthly budget held', () => {
    const budgets = [
      {
        category_id: 1,
        amount: 100,
        period: 'monthly' as const,
        start_date: '2026-01-01',
        end_date: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const held = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 20 }) })
    )
    expect(ids(held)).toContain('held-the-line')
    expect(on(held, 'held-the-line')).toBe('2026-07-01')
    expect(on(held, 'first-budget')).toBe('2026-01-01')
    const blown = evaluateAchievements(
      input({ budgets, transactions: month('2026-07', 3, { amount: 40 }) })
    )
    expect(ids(blown)).not.toContain('held-the-line')
    const current = evaluateAchievements(
      input({ budgets, transactions: month('2026-09', 3, { amount: 20 }) })
    )
    expect(ids(current)).not.toContain('held-the-line')
  })

  it('goals: created is dated to creation, reached to today', () => {
    const goals = [
      {
        name: 'Trip',
        target_amount: 500,
        current_amount: 500,
        deadline: null,
        created_at: '2026-02-10T00:00:00Z',
      },
    ]
    const r = evaluateAchievements(input({ goals }))
    expect(on(r, 'goal-in-sight')).toBe('2026-02-01')
    expect(on(r, 'goal-reached')).toBe('2026-09-01')
    expect(
      ids(evaluateAchievements(input({ goals: [{ ...goals[0], current_amount: 10 }] })))
    ).not.toContain('goal-reached')
  })

  it('own the stack follows the storage mode, dated today', () => {
    expect(on(evaluateAchievements(input({ selfHosted: true })), 'own-the-stack')).toBe(
      '2026-09-01'
    )
    expect(ids(evaluateAchievements(input({ selfHosted: false })))).not.toContain('own-the-stack')
  })

  it('returns earned in definition order and ignores unparseable dates', () => {
    const r = evaluateAchievements(
      input({ transactions: [tx('nonsense'), ...month('2026-09', 3)] })
    )
    expect(ids(r)).toEqual(['first-entry', 'named-everything', 'one-month'])
  })
})

describe('the long ladder', () => {
  it('earns each rung as the streak reaches it, and dates it to that month', () => {
    // Sixty tracked months ending this month: everything up to Five years, nothing above.
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-09', 60) }))
    const earned = ids(r)
    expect(earned).toContain('three-years')
    expect(earned).toContain('five-years')
    expect(earned).not.toContain('ten-years')
    expect(earned).not.toContain('twenty-years')
    expect(r.streak).toBe(60)

    // The run starts 2021-10, so the 36th month is 2024-09 and the 60th is 2026-09.
    expect(on(r, 'three-years')).toBe('2024-09-01')
    expect(on(r, 'five-years')).toBe('2026-09-01')
  })

  it('a decade earns Ten years but not Twenty', () => {
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-09', 120) }))
    expect(ids(r)).toContain('ten-years')
    expect(ids(r)).not.toContain('twenty-years')
  })

  it('a gap resets the ladder: two runs of thirty do not make five years', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2023-06', 30), ...trackedRun('2026-09', 30)] })
    )
    expect(ids(r)).toContain('two-years')
    expect(ids(r)).not.toContain('three-years')
    expect(ids(r)).not.toContain('five-years')
  })
})

describe('volume badges', () => {
  it('are dated to the month the count was reached, not to today', () => {
    // 120 transactions, four a month over thirty months ending 2025-12.
    const r = evaluateAchievements(
      input({ transactions: trackedRun('2025-12', 30, 4), today: '2026-09-07' })
    )
    expect(ids(r)).toContain('hundred-entries')
    expect(ids(r)).not.toContain('thousand-entries')
    // The 100th transaction by date falls in the 25th month of the run, 2025-07.
    expect(on(r, 'hundred-entries')).toBe('2025-07-01')
  })

  it('counts every transaction, tracked month or not', () => {
    // Two transactions a month is below the tracked threshold, so no month badge is earned,
    // but the entries still count towards volume.
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-09', 60, 2) }))
    expect(ids(r)).toContain('hundred-entries')
    expect(ids(r)).not.toContain('one-month')
  })

  it('needs the full count: ninety-nine entries earn nothing', () => {
    const txs = Array.from({ length: 99 }, (_, i) => tx(`2026-0${(i % 9) + 1}-05`))
    expect(ids(evaluateAchievements(input({ transactions: txs })))).not.toContain('hundred-entries')
  })
})

describe('the comeback', () => {
  it('is earned by resuming after a real break, and dated to the month tracking resumed', () => {
    // Four tracked months to 2025-04, nothing in May-July, back in 2025-08.
    const r = evaluateAchievements(
      input({
        transactions: [...trackedRun('2025-04', 4), ...trackedRun('2026-09', 3)],
      })
    )
    expect(ids(r)).toContain('the-comeback')
    expect(on(r, 'the-comeback')).toBe('2026-07-01')
  })

  it('needs a run of three before the break', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2025-04', 2), ...trackedRun('2026-09', 3)] })
    )
    expect(ids(r)).not.toContain('the-comeback')
  })

  it('a single missed month is not a comeback', () => {
    const r = evaluateAchievements(
      input({ transactions: [...trackedRun('2026-04', 4), ...trackedRun('2026-09', 3)] })
    )
    expect(ids(r)).toContain('the-comeback')
    // One month off is a gap of one, which does not count.
    const tight = evaluateAchievements(
      input({ transactions: [...trackedRun('2026-06', 4), ...trackedRun('2026-09', 2)] })
    )
    expect(ids(tight)).not.toContain('the-comeback')
  })
})

describe('the chased set', () => {
  it('Reconciled needs every transaction in the month marked', () => {
    const done = month('2026-03', 3, { reconciled: true })
    expect(ids(evaluateAchievements(input({ transactions: done })))).toContain('reconciled')

    const partial = [...month('2026-03', 2, { reconciled: true }), ...month('2026-03', 1)]
    expect(ids(evaluateAchievements(input({ transactions: partial })))).not.toContain('reconciled')
  })

  it('The full picture needs income, spending and a transfer, all named', () => {
    const mixed = [
      ...month('2026-03', 1, { type: 'income' }),
      ...month('2026-03', 1, { type: 'expense' }),
      ...month('2026-03', 1, { type: 'transfer' }),
    ]
    expect(ids(evaluateAchievements(input({ transactions: mixed })))).toContain('the-full-picture')

    const spendOnly = month('2026-03', 3, { type: 'expense' })
    expect(ids(evaluateAchievements(input({ transactions: spendOnly })))).not.toContain(
      'the-full-picture'
    )
  })

  it('A perfect year is twelve saving months in a row', () => {
    const saving = (m: string) => [
      ...month(m, 2, { type: 'income', amount: 500 }),
      ...month(m, 2, { type: 'expense', amount: 50 }),
    ]
    const twelve = Array.from({ length: 12 }, (_, i) =>
      saving(`2026-${String(i + 1).padStart(2, '0')}`)
    ).flat()
    const r = evaluateAchievements(input({ transactions: twelve, today: '2026-12-31' }))
    expect(ids(r)).toContain('perfect-year')
    expect(ids(r)).toContain('every-month')
    expect(on(r, 'every-month')).toBe('2026-12-01')
  })

  it('Every month of a year needs all twelve of one calendar year', () => {
    // Twelve in a row but straddling two years: a streak, not a calendar year.
    const r = evaluateAchievements(input({ transactions: trackedRun('2026-06', 12) }))
    expect(ids(r)).toContain('a-year')
    expect(ids(r)).not.toContain('every-month')
  })

  it('Ahead of plan needs a deadline still ahead; Goal reached does not', () => {
    const goal = (over: Record<string, unknown>) => ({
      target_amount: 1000,
      current_amount: 1000,
      created_at: '2026-01-01',
      deadline: null as string | null,
      name: 'Fund',
      ...over,
    })
    const early = evaluateAchievements(input({ goals: [goal({ deadline: '2026-12-01' })] }))
    expect(ids(early)).toContain('ahead-of-plan')

    const late = evaluateAchievements(input({ goals: [goal({ deadline: '2026-01-01' })] }))
    expect(ids(late)).toContain('goal-reached')
    expect(ids(late)).not.toContain('ahead-of-plan')
  })

  it('Rainy day needs a reached goal worth three months of spending', () => {
    // Three tracked months at 300 a month: the bar is 900.
    const spend = trackedRun('2026-08', 3, 3).map((t) => ({ ...t, amount: 100 }))
    const withGoal = (target: number) =>
      evaluateAchievements(
        input({
          transactions: spend,
          goals: [
            {
              target_amount: target,
              current_amount: target,
              created_at: '2026-01-01',
              deadline: null,
              name: 'Emergency fund',
            },
          ],
        })
      )
    expect(ids(withGoal(900))).toContain('rainy-day')
    expect(ids(withGoal(500))).not.toContain('rainy-day')
  })

  it('Clean sweep needs the month both fully named and fully under budget', () => {
    const budgets = [
      {
        category_id: 1,
        amount: 1000,
        period: 'monthly' as const,
        start_date: '2026-01-01',
        end_date: null,
        created_at: '2026-01-01',
      },
    ]
    // Amounts are pinned: `tx` derives its default from a module-wide counter, so a test that
    // relies on it being small passes alone and fails after a case that created a few hundred.
    const named = evaluateAchievements(
      input({ transactions: month('2026-03', 3, { amount: 100 }), budgets, today: '2026-09-07' })
    )
    expect(ids(named)).toContain('clean-sweep')

    // Same month, one transaction left uncategorised: named fails, so the sweep does too.
    const messy = evaluateAchievements(
      input({
        transactions: [
          ...month('2026-03', 2, { amount: 100 }),
          ...month('2026-03', 1, { amount: 100, category_id: null }),
        ],
        budgets,
        today: '2026-09-07',
      })
    )
    expect(ids(messy)).toContain('held-the-line')
    expect(ids(messy)).not.toContain('clean-sweep')
  })
})

describe('debt free', () => {
  const loan = (over: Record<string, unknown> = {}) => ({
    principal: 12000,
    start_date: '2020-01-01',
    term_months: 24,
    rate_periods: [{ rate: 5, start_month: 1, end_month: null }],
    prepayments: [] as Array<{ month: number; amount: number }>,
    ...over,
  })

  it('is earned when a loan has run its schedule out, dated to the payoff month', () => {
    const r = evaluateAchievements(input({ loans: [loan()] }))
    expect(ids(r)).toContain('debt-free')
    // Twenty-four payments from 2020-01.
    expect(on(r, 'debt-free')).toBe('2021-12-01')
  })

  it('is not earned while the loan is still running', () => {
    const r = evaluateAchievements(input({ loans: [loan({ start_date: '2026-01-01' })] }))
    expect(ids(r)).not.toContain('debt-free')
  })

  it('counts a prepayment that finishes the loan early', () => {
    const r = evaluateAchievements(
      input({
        loans: [loan({ start_date: '2025-01-01', prepayments: [{ month: 3, amount: 11000 }] })],
      })
    )
    expect(ids(r)).toContain('debt-free')
  })

  it('ignores a loan with no principal', () => {
    const r = evaluateAchievements(input({ loans: [loan({ principal: 0 })] }))
    expect(ids(r)).not.toContain('debt-free')
  })
})
