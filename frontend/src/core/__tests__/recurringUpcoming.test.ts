/**
 * What the active recurring rules add in the next 30 days (shared/recurringUpcoming.ts), the
 * answer of GET /api/recurring/upcoming in both runtimes.
 */
import { describe, expect, it } from 'vitest'
import { upcomingRecurring } from '../../../../shared/recurringUpcoming'
import type { UpcomingRule } from '../../../../shared/recurringUpcoming'

const rule = (values: Partial<UpcomingRule>): UpcomingRule => ({
  id: 1,
  description: 'Beans',
  amount: 20,
  type: 'expense',
  frequency: 'weekly',
  day_of_month: null,
  next_date: '2026-03-02',
  category_name: 'Coffee',
  category_color: '#c9a0ff',
  ...values,
})

const dates = (answer: ReturnType<typeof upcomingRecurring>) =>
  answer.transactions.map((t) => `${t.id} ${t.next_date}`)

describe('the upcoming recurring transactions', () => {
  it('lists every occurrence of the next 30 days, today included, soonest first', () => {
    const answer = upcomingRecurring(
      [rule({}), rule({ id: 2, description: 'Rent', amount: 850.5, frequency: 'monthly' })],
      '2026-03-02',
      'EUR'
    )
    expect(dates(answer)).toEqual([
      '1 2026-03-02',
      '2 2026-03-02',
      '1 2026-03-09',
      '1 2026-03-16',
      '1 2026-03-23',
      '1 2026-03-30',
    ])
    expect(answer.transactions[0]).toEqual({
      id: 1,
      description: 'Beans',
      amount: 20,
      type: 'expense',
      frequency: 'weekly',
      day_of_month: null,
      next_date: '2026-03-02',
      category_name: 'Coffee',
      category_color: '#c9a0ff',
    })
    expect(answer.currency).toBe('EUR')
  })

  it('lists a rule whose next date has passed once today, then on its own dates', () => {
    const answer = upcomingRecurring([rule({ next_date: '2026-02-20' })], '2026-03-02', 'EUR')
    expect(dates(answer)).toEqual([
      '1 2026-03-02',
      '1 2026-03-06',
      '1 2026-03-13',
      '1 2026-03-20',
      '1 2026-03-27',
    ])
  })

  it('steps a rule on the 31st through a shorter month, as populate does', () => {
    const answer = upcomingRecurring(
      [rule({ frequency: 'monthly', day_of_month: 31, next_date: '2026-01-31' })],
      '2026-01-30',
      'EUR'
    )
    expect(dates(answer)).toEqual(['1 2026-01-31', '1 2026-02-28'])
  })

  it('adds the occurrences up by category, to the cent, the largest first', () => {
    const answer = upcomingRecurring(
      [
        rule({ amount: 0.1, frequency: 'yearly' }),
        rule({ id: 2, amount: 0.2, frequency: 'yearly' }),
        rule({ id: 3, amount: 5, frequency: 'yearly', category_name: null, category_color: null }),
      ],
      '2026-03-02',
      'USD'
    )
    expect(answer.byCategory.map((c) => [c.name, String(c.total), c.items.length])).toEqual([
      ['Uncategorized', '5', 1],
      ['Coffee', '0.3', 2],
    ])
    expect(String(answer.totalMonthly)).toBe('5.3')
    expect(answer.currency).toBe('USD')
  })

  it('lists the first 20 occurrences, and adds them all up', () => {
    const answer = upcomingRecurring([rule({ frequency: 'daily' })], '2026-03-02', 'EUR')
    expect(answer.transactions).toHaveLength(20)
    expect(answer.byCategory[0].items).toHaveLength(31)
    expect(answer.totalMonthly).toBe(620)
  })
})
