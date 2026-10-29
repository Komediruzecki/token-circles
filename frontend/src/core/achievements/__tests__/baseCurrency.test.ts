/**
 * Achievements count money in the base currency: a transaction's converted amount
 * (`amount_local`) when it has one, as Budgets, Dashboard and Analytics count it in both runtimes.
 *
 * They added `amount`, the figure in the transaction's own currency, so a month with an entry in
 * another currency was counted in two currencies at once: 50,000 yen of shopping outweighed a
 * whole salary, and 200,000 yen of pay made a month in the red a saving one.
 */
import { describe, expect, it } from 'vitest'
import { buildAdvice } from '../advice'
import { evaluateAchievements } from '../evaluate'
import { buildYearReview } from '../review'
import { adviceInput, input, month, tx } from './fixtures'
import type { AdviceInput } from '../advice'

/** 50,000 yen, converted at import to 310 in the base currency. */
const YEN_SHOPPING = { amount: 50000, amount_local: 310 }
/** 200,000 yen of pay, converted to 1,240. */
const YEN_PAY = { type: 'income' as const, amount: 200000, amount_local: 1240 }

const ids = (r: ReturnType<typeof evaluateAchievements>): string[] => r.earned.map((e) => e.id)

describe('badges, for months with an entry in another currency', () => {
  it('count a month as saving when its income beats its converted spending', () => {
    // 1,000 in, 3 x 100 and 310 out.
    const saving = (m: string) => [
      ...month(m, 3, { amount: 100 }),
      tx(`${m}-20`, YEN_SHOPPING),
      tx(`${m}-25`, { type: 'income', amount: 1000 }),
    ]
    const r = evaluateAchievements(
      input({ transactions: [...saving('2026-05'), ...saving('2026-06'), ...saving('2026-07')] })
    )
    expect(ids(r)).toContain('saver-x3')
  })

  it('do not count a month as saving when its converted income falls short', () => {
    // 1,240 in, 3 x 500 out.
    const short = (m: string) => [...month(m, 3, { amount: 500 }), tx(`${m}-25`, YEN_PAY)]
    const r = evaluateAchievements(
      input({ transactions: [...short('2026-05'), ...short('2026-06'), ...short('2026-07')] })
    )
    expect(ids(r)).not.toContain('saver-x3')
  })

  it('hold a budget by the converted spending in its category', () => {
    // August's budget of 400; 2 x 10 and 310 spent in August, a finished month.
    const r = evaluateAchievements(
      input({
        transactions: [...month('2026-08', 2, { amount: 10 }), tx('2026-08-20', YEN_SHOPPING)],
        budgets: [
          {
            category_id: 1,
            amount: 400,
            period: 'monthly',
            start_date: '2026-08-01',
            end_date: null,
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
      })
    )
    expect(ids(r)).toContain('held-the-line')
  })

  it('measure a rainy-day fund against three months of converted spending', () => {
    // 3 x 100 and 310 a month is 610; three months of it is 1,830, under the 2,000 saved.
    const spend = (m: string) => [...month(m, 3, { amount: 100 }), tx(`${m}-20`, YEN_SHOPPING)]
    const r = evaluateAchievements(
      input({
        transactions: [...spend('2026-06'), ...spend('2026-07'), ...spend('2026-08')],
        goals: [
          {
            name: 'Cushion',
            target_amount: 2000,
            current_amount: 2000,
            created_at: '2026-06-01T00:00:00Z',
            deadline: null,
          },
        ],
      })
    )
    expect(ids(r)).toContain('rainy-day')
  })
})

describe('the year in review, with an entry in another currency', () => {
  it('totals the year and names its biggest category in the base currency', () => {
    const r = buildYearReview({
      transactions: [
        ...month('2026-03', 3, { amount: 100, category_id: 1 }),
        tx('2026-03-20', { ...YEN_SHOPPING, category_id: 2 }),
        tx('2026-03-25', YEN_PAY),
      ],
      today: '2026-09-07',
    })
    expect(r.income).toBe(1240)
    expect(r.expenses).toBe(610)
    expect(r.saved).toBe(630)
    expect(r.bestMonth).toEqual({ month: '2026-03', saved: 630 })
    expect(r.topCategory).toEqual({ id: 2, total: 310 })
  })
})

describe('advice, with an entry in another currency', () => {
  const make = (over: Record<string, unknown>): AdviceInput =>
    adviceInput(over) as unknown as AdviceInput

  it('says how far a month was in the red, in the base currency', () => {
    // August: 1,000 in, 3 x 300 and 310 out.
    const card = buildAdvice(
      make({
        transactions: [
          ...month('2026-08', 3, { amount: 300 }),
          tx('2026-08-20', YEN_SHOPPING),
          tx('2026-08-25', { type: 'income', amount: 1000 }),
        ],
      })
    ).find((c) => c.kind === 'in-the-red')
    expect(card?.figure).toBe('210 over')
  })

  it('compares a budget with the converted spending in its category', () => {
    const card = buildAdvice(
      make({
        budgets: [
          {
            category_id: 1,
            amount: 300,
            period: 'monthly',
            start_date: '2026-09-01',
            end_date: null,
            created_at: '2026-09-01T00:00:00Z',
          },
        ],
        transactions: [tx('2026-09-02', { ...YEN_SHOPPING, category_id: 1 })],
      })
    ).find((c) => c.kind === 'budget-drift')
    expect(card?.figure).toBe('310 of 300')
  })

  it('names the biggest unbudgeted category by its converted spending', () => {
    // 50,000 yen (310) on Food against 400 on Transport.
    const card = buildAdvice(
      make({
        transactions: [
          tx('2026-09-02', { ...YEN_SHOPPING, category_id: 1 }),
          tx('2026-09-03', { amount: 400, category_id: 2 }),
        ],
      })
    ).find((c) => c.kind === 'unbudgeted-category')
    expect(card?.title).toContain('Transport')
    expect(card?.figure).toBe('400')
  })
})
