import { describe, expect, it } from 'vitest'
import { daysToDue, dueDateLabel, dueInWords, nextDue } from '../billDue'

describe('nextDue', () => {
  it('is the date the runtimes say the bill falls due next', () => {
    expect(nextDue({ due_date: '2026-08-20', next_due_date: '2026-10-20' })).toBe('2026-10-20')
  })

  it('is the first due date for an answer without one', () => {
    expect(nextDue({ due_date: '2026-08-20' })).toBe('2026-08-20')
    expect(nextDue({ due_date: '2026-08-20', next_due_date: null })).toBe('2026-08-20')
  })
})

describe('daysToDue', () => {
  const bill = { due_date: '2026-08-20', next_due_date: '2026-10-20' }

  it('counts the days from today to the next due date', () => {
    expect(daysToDue(bill, '2026-10-08')).toBe(12)
    expect(daysToDue(bill, '2026-10-20')).toBe(0)
    expect(daysToDue(bill, '2026-10-23')).toBe(-3)
  })

  it('counts whole days across a change of clocks', () => {
    expect(daysToDue({ due_date: '2026-10-01', next_due_date: '2026-11-01' }, '2026-10-20')).toBe(
      12
    )
  })
})

describe('dueInWords', () => {
  it('says when, in words', () => {
    expect(dueInWords(12)).toBe('Due in 12 days')
    expect(dueInWords(1)).toBe('Due tomorrow')
    expect(dueInWords(0)).toBe('Due today')
    expect(dueInWords(-1)).toBe('1 day overdue')
    expect(dueInWords(-5)).toBe('5 days overdue')
  })
})

describe('dueDateLabel', () => {
  it('writes the date as it is on the calendar, with or without the year', () => {
    expect(dueDateLabel('2026-10-20')).toBe('Oct 20, 2026')
    expect(dueDateLabel('2026-10-20', false)).toBe('Oct 20')
    expect(dueDateLabel('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('gives back what it cannot read', () => {
    expect(dueDateLabel('soon')).toBe('soon')
  })
})
