/**
 * When a bill is paid up and when it falls due next (shared/billSchedule.ts), the one rule the
 * Bills page, its calendar, the Dashboard, GET /api/bills/upcoming and mark-paid use in both
 * runtimes.
 */
import { describe, expect, it } from 'vitest'
import {
  billDay,
  comingUp,
  daysFrom,
  dueWithin,
  isPaidUp,
  nextDueDate,
  paidFrom,
} from '../../../../shared/billSchedule'

describe("a bill's day of the month", () => {
  it('is its due date’s day', () => {
    expect(billDay({ due_date: '2026-10-15', day_of_month: 1 })).toBe(15)
  })

  it('is the day of the month only when there is no due date the calendar can read', () => {
    expect(billDay({ due_date: null, day_of_month: 31 })).toBe(31)
    expect(billDay({ due_date: '15/10/2026', day_of_month: '9' })).toBe(9)
    expect(billDay({ due_date: null, day_of_month: null })).toBe(1)
    expect(billDay({ due_date: null, day_of_month: 40 })).toBe(1)
  })
})

describe('the period a payment settles', () => {
  it('is the month, the year, or the last 7 or 14 days, today included', () => {
    expect(paidFrom('monthly', '2026-10-08')).toBe('2026-10-01')
    expect(paidFrom('yearly', '2026-10-08')).toBe('2026-01-01')
    expect(paidFrom('weekly', '2026-10-08')).toBe('2026-10-02')
    expect(paidFrom('biweekly', '2026-10-08')).toBe('2026-09-25')
    // A frequency no screen offers is read as monthly, as the next due date reads it.
    expect(paidFrom('quarterly', '2026-10-08')).toBe('2026-10-01')
    expect(paidFrom(null, '2026-10-08')).toBe('2026-10-01')
  })

  it('pays a bill up with a payment on or after its start', () => {
    expect(isPaidUp({ frequency: 'monthly', last_paid_date: '2026-10-01' }, '2026-10-31')).toBe(
      true
    )
    expect(isPaidUp({ frequency: 'monthly', last_paid_date: '2026-09-30' }, '2026-10-01')).toBe(
      false
    )
    expect(isPaidUp({ frequency: 'monthly', last_paid_date: null }, '2026-10-01')).toBe(false)
    // A payment stamped with a time still counts by its date.
    expect(
      isPaidUp({ frequency: 'monthly', last_paid_date: '2026-10-02T09:00:00Z' }, '2026-10-05')
    ).toBe(true)
  })

  it('is due again a week after a weekly payment, not a day later', () => {
    const bill = { frequency: 'weekly', last_paid_date: '2026-10-01' }
    expect(isPaidUp(bill, '2026-10-07')).toBe(true)
    expect(isPaidUp(bill, '2026-10-08')).toBe(false)
  })
})

describe('the next due date of a monthly bill', () => {
  const rent = { frequency: 'monthly', due_date: '2026-09-15' }

  it('is this month’s while it is not paid, overdue once the day has passed', () => {
    expect(nextDueDate(rent, '2026-10-08')).toBe('2026-10-15')
    expect(nextDueDate(rent, '2026-10-15')).toBe('2026-10-15')
    expect(nextDueDate(rent, '2026-10-20')).toBe('2026-10-15')
  })

  it('moves to next month once it is paid', () => {
    expect(nextDueDate({ ...rent, last_paid_date: '2026-10-02' }, '2026-10-08')).toBe('2026-11-15')
    expect(nextDueDate({ ...rent, last_paid_date: '2026-10-16' }, '2026-10-20')).toBe('2026-11-15')
  })

  it('falls on the last day of a shorter month, and on its own day again after', () => {
    const end = { frequency: 'monthly', due_date: '2027-01-31' }
    expect(nextDueDate({ ...end, last_paid_date: '2027-01-31' }, '2027-02-01')).toBe('2027-02-28')
    expect(nextDueDate({ ...end, last_paid_date: '2027-02-28' }, '2027-03-01')).toBe('2027-03-31')
    expect(nextDueDate(end, '2028-02-10')).toBe('2028-02-29')
  })

  it('is never before its first due date', () => {
    expect(nextDueDate({ frequency: 'monthly', due_date: '2026-12-05' }, '2026-10-08')).toBe(
      '2026-12-05'
    )
  })

  it('goes by the day of the month when there is no due date', () => {
    expect(nextDueDate({ frequency: 'monthly', day_of_month: 31 }, '2026-11-02')).toBe('2026-11-30')
  })

  it('is read as monthly for a frequency no screen offers', () => {
    expect(nextDueDate({ frequency: 'quarterly', due_date: '2026-01-20' }, '2026-10-08')).toBe(
      '2026-10-20'
    )
  })
})

describe('the next due date of a yearly bill', () => {
  const insurance = { frequency: 'yearly', due_date: '2025-03-15' }

  it('is this year’s while it is not paid, and next year’s once it is', () => {
    expect(nextDueDate(insurance, '2026-02-01')).toBe('2026-03-15')
    expect(nextDueDate(insurance, '2026-10-08')).toBe('2026-03-15')
    expect(nextDueDate({ ...insurance, last_paid_date: '2026-03-14' }, '2026-10-08')).toBe(
      '2027-03-15'
    )
  })

  it('falls on 28 February in a year without the 29th', () => {
    expect(nextDueDate({ frequency: 'yearly', due_date: '2024-02-29' }, '2027-01-10')).toBe(
      '2027-02-28'
    )
  })
})

describe('the next due date of a weekly or biweekly bill', () => {
  it('is its first due date until that has passed', () => {
    expect(nextDueDate({ frequency: 'weekly', due_date: '2026-10-12' }, '2026-10-08')).toBe(
      '2026-10-12'
    )
  })

  it('is its latest date on or before today while it has never been paid', () => {
    const gym = { frequency: 'weekly', due_date: '2026-10-01' }
    expect(nextDueDate(gym, '2026-10-08')).toBe('2026-10-08')
    expect(nextDueDate(gym, '2026-10-10')).toBe('2026-10-08')
    expect(nextDueDate({ frequency: 'biweekly', due_date: '2026-09-01' }, '2026-10-08')).toBe(
      '2026-09-29'
    )
  })

  it('is a week, or two, after the last payment', () => {
    const gym = { frequency: 'weekly', due_date: '2026-10-01', last_paid_date: '2026-10-09' }
    expect(nextDueDate(gym, '2026-10-10')).toBe('2026-10-16')
    expect(nextDueDate(gym, '2026-10-20')).toBe('2026-10-16')
    expect(
      nextDueDate(
        { frequency: 'biweekly', due_date: '2026-10-01', last_paid_date: '2026-10-01' },
        '2026-10-08'
      )
    ).toBe('2026-10-15')
  })
})

describe('days from today', () => {
  it('counts whole days, negative when past', () => {
    expect(daysFrom('2026-10-08', '2026-10-15')).toBe(7)
    expect(daysFrom('2026-10-08', '2026-10-08')).toBe(0)
    expect(daysFrom('2026-10-08', '2026-10-05')).toBe(-3)
    expect(daysFrom('2027-02-01', '2027-03-01')).toBe(28)
  })
})

describe('the bills coming up', () => {
  const bills = [
    { name: 'Rent', frequency: 'monthly', due_date: '2026-09-25', is_active: 1 },
    { name: 'Phone', frequency: 'monthly', due_date: '2026-09-05', is_active: 1 },
    { name: 'Gym', frequency: 'monthly', due_date: '2026-09-21', is_active: 0 },
    { name: 'Power', frequency: 'monthly', due_date: '2026-09-25', is_active: true },
    { name: 'Water', frequency: 'monthly', due_date: '2026-09-20', last_paid_date: '2026-10-01' },
  ]

  it('are the active ones, the most overdue first, then the soonest, then by name', () => {
    expect(
      comingUp(bills, '2026-10-20').map((b) => [b.name, b.next_due_date, b.days_until, b.paid])
    ).toEqual([
      ['Phone', '2026-10-05', -15, false],
      ['Power', '2026-10-25', 5, false],
      ['Rent', '2026-10-25', 5, false],
      ['Water', '2026-11-20', 31, true],
    ])
  })

  it('on the Dashboard, are the ones due from today through the days given', () => {
    expect(dueWithin(bills, '2026-10-20', 30).map((b) => b.name)).toEqual(['Power', 'Rent'])
    expect(dueWithin(bills, '2026-10-20', 31).map((b) => b.name)).toEqual([
      'Power',
      'Rent',
      'Water',
    ])
  })
})
