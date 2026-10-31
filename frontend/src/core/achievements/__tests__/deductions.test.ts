/**
 * Every place achievements count spending reads a deduction as shared/guidance/flows.ts does: pay
 * that never reached an account, which lowers income and is never spending.
 *
 * They counted it as spending. A month's verdict did not change (income beat expenses plus
 * deductions exactly when income less deductions beat expenses), but the figures did: the
 * rainy-day badge measured a goal against three months of spending with tax in it, and the year in
 * review and the in-the-red advice showed tax as money spent.
 *
 * The last test scans the code: a sum that lists expense and deduction together is the old reading
 * coming back.
 */
import { describe, expect, it } from 'vitest'
import { evaluateAchievements } from '../evaluate'
import { monthInTheRed } from '../monthFacts'
import { buildYearReview } from '../review'
import { input, tx } from './fixtures'
import type { Tx } from '../evaluate'

/** 3,000 of pay with 600 of tax taken at source, 2,600 spent and 500 moved to savings. */
const taxed = (m: string): Tx[] => [
  tx(`${m}-01`, { type: 'income', amount: 3000, category_id: 9 }),
  tx(`${m}-01`, { type: 'deduction', amount: 600, category_id: 9 }),
  tx(`${m}-05`, { amount: 1000 }),
  tx(`${m}-12`, { amount: 1600 }),
  tx(`${m}-20`, { type: 'transfer', amount: 500, category_id: null }),
]

describe('a deduction, where achievements count spending', () => {
  it('is not spending in the three months a rainy-day fund is measured against', () => {
    // 2,600 a month, three months of it 7,800: under the 8,000 saved. With tax it was 9,600.
    const r = evaluateAchievements(
      input({
        transactions: [...taxed('2026-06'), ...taxed('2026-07'), ...taxed('2026-08')],
        goals: [
          {
            name: 'Cushion',
            target_amount: 8000,
            current_amount: 8000,
            created_at: '2026-06-01T00:00:00Z',
            deadline: null,
          },
        ],
      })
    )
    expect(r.earned.map((e) => e.id)).toContain('rainy-day')
  })

  it('lowers what came in, in a saving month', () => {
    // 2,400 reached the account and 2,500 was spent: no saving month, three times over.
    const short = (m: string) => [
      ...taxed(m).filter((t) => t.amount !== 1600),
      tx(`${m}-12`, { amount: 1500 }),
    ]
    const r = evaluateAchievements(
      input({ transactions: [...short('2026-05'), ...short('2026-06'), ...short('2026-07')] })
    )
    expect(r.earned.map((e) => e.id)).not.toContain('saver-x3')
  })

  it('is income not received in the year in review, not money spent', () => {
    const r = buildYearReview({ transactions: taxed('2026-03'), today: '2026-09-07' })
    expect(r).toMatchObject({ income: 2400, expenses: 2600, saved: -200, bestMonth: null })
  })

  it('is income not received in a month in the red, not money spent', () => {
    expect(monthInTheRed(taxed('2026-03'))).toEqual({ income: 2400, out: 2600 })
  })

  it('is never summed with expenses in the app or shared code', () => {
    const sources = {
      ...import.meta.glob(['../../../**/*.ts', '../../../**/*.tsx'], {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
      ...import.meta.glob('../../../../../shared/**/*.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    } as Record<string, string>
    const code = Object.entries(sources).filter(
      ([path]) => !path.includes('/__tests__/') && !/\.test\.tsx?$/.test(path)
    )
    expect(code.length, 'the sources were read').toBeGreaterThan(300)
    const together = /\[\s*['"](expense|deduction)['"]\s*,\s*['"](expense|deduction)['"]\s*\]/
    expect(code.filter(([, source]) => together.test(source)).map(([path]) => path)).toEqual([])
  })
})
