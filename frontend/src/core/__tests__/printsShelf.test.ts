/**
 * The shelf as Progress draws it (core/prints/shelf.ts, `shelfView`): each print's months as seal
 * shares worked out from the badges' snapshot, never an amount; the first print is the "A year"
 * badge's twelve months; and the plate knows whether its run is still going, which month broke it
 * and whether this month is on it.
 */
import { describe, expect, it } from 'vitest'
import { evaluateAchievements } from '../achievements/evaluate'
import { addMonths } from '../achievements/months'
import { shelfView } from '../prints/shelf'
import type { EvaluateInput } from '../achievements/evaluate'

type Entry = EvaluateInput['transactions'][number]

/** A month of four entries: pay, rent and two shops. Five-digit amounts, so a leak is plain. */
function aMonth(month: string, pay = 31457.25, rent = 12345.5, shop = 2468.75): Entry[] {
  const base = { category_id: 1, reconciled: false }
  return [
    { ...base, date: `${month}-01`, type: 'income', amount: pay },
    { ...base, date: `${month}-02`, type: 'expense', amount: -rent },
    { ...base, date: `${month}-10`, type: 'expense', amount: -shop },
    { ...base, date: `${month}-21`, type: 'expense', amount: -shop },
  ]
}

const months = (from: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => addMonths(from, i))

function evaluate(transactions: Entry[], today: string) {
  return evaluateAchievements({
    transactions,
    budgets: [],
    goals: [],
    importLogs: [],
    loans: [],
    selfHosted: false,
    today,
  })
}

function viewOf(transactions: Entry[], today: string) {
  const evaluation = evaluate(transactions, today)
  return shelfView({ transactions, trackedMonths: evaluation.trackedMonths, today })
}

describe('shelfView', () => {
  it('carries shares and months, and no amount from the entries', () => {
    const transactions = months('2025-01', 15).flatMap((m, i) =>
      aMonth(m, 31457.25 + i * 1013.17, 12345.5 + i * 211.33, 2468.75 + i * 97.41)
    )
    const view = viewOf(transactions, '2026-03-20')
    expect(view.prints.map((p) => p.from)).toEqual(['2025-01'])
    expect(view.plate).toMatchObject({ from: '2026-01', months: 3 })
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/\d{5,}/)
    for (const t of transactions) {
      const a = Math.abs(t.amount)
      expect(text).not.toContain(a.toFixed(2))
      expect(text).not.toContain(String(Math.trunc(a)))
    }
    for (const s of view.prints[0].slots) {
      expect(Number.isInteger(s?.spent)).toBe(true)
      expect(Number.isInteger(s?.kept)).toBe(true)
    }
  })

  it('makes the first print the twelve months the "A year" badge is dated to', () => {
    // Runs of 5, 9 and 14 months with a gap after each: the first run long enough is the third.
    const tracked = [...months('2021-02', 5), ...months('2021-09', 9), ...months('2022-08', 14)]
    const transactions = tracked.flatMap((m) => aMonth(m))
    const today = '2024-01-15'
    const year = evaluate(transactions, today).earned.find((e) => e.id === 'a-year')
    const view = viewOf(transactions, today)
    expect(year?.earnedOn.slice(0, 7)).toBe('2023-07')
    expect(addMonths(view.prints[0].from, 11)).toBe(year?.earnedOn.slice(0, 7))
  })

  it('pads a print and the plate to twelve slots, the plate empty past its months', () => {
    const view = viewOf(
      months('2026-04', 6).flatMap((m) => aMonth(m)),
      '2026-10-05'
    )
    expect(view.prints).toEqual([])
    expect(view.plate?.slots).toHaveLength(12)
    expect(view.plate?.slots.map((s) => s !== null)).toEqual([
      ...Array(6).fill(true),
      ...Array(6).fill(false),
    ])
    // Every month spent the same, so every petal is the heaviest's length.
    expect(view.plate?.slots.slice(0, 6).map((s) => s?.spent)).toEqual(Array(6).fill(100))
  })

  it('reads a run that reaches last month as still going, with no gap and nothing running', () => {
    const view = viewOf(
      months('2026-04', 6).flatMap((m) => aMonth(m)),
      '2026-10-05'
    )
    expect(view.live).toBe(true)
    expect(view.gap).toBeNull()
    expect(view.running).toBeNull()
  })

  it('names the month that broke the newest run, with the entries it holds', () => {
    const transactions = [
      ...months('2026-01', 6).flatMap((m) => aMonth(m)),
      ...aMonth('2026-07').slice(0, 2),
    ]
    const view = viewOf(transactions, '2026-10-05')
    expect(view.live).toBe(false)
    expect(view.plate).toMatchObject({ from: '2026-01', months: 6 })
    expect(view.gap).toEqual({ month: '2026-07', entries: 2 })
    expect(
      viewOf(
        months('2026-01', 6).flatMap((m) => aMonth(m)),
        '2026-10-05'
      ).gap
    ).toEqual({
      month: '2026-07',
      entries: 0,
    })
  })

  it('says this month is running once it is tracked', () => {
    const view = viewOf(
      months('2026-05', 6).flatMap((m) => aMonth(m)),
      '2026-10-25'
    )
    expect(view.running).toBe('2026-10')
    expect(view.live).toBe(true)
  })

  it('has no plate and no gap before any month is tracked', () => {
    const view = viewOf(aMonth('2026-10').slice(0, 2), '2026-10-05')
    expect(view).toEqual({ prints: [], plate: null, live: false, gap: null, running: null })
  })

  it('starts the next plate empty when a run ends on a whole twelve', () => {
    const view = viewOf(
      months('2025-10', 12).flatMap((m) => aMonth(m)),
      '2026-10-05'
    )
    expect(view.prints.map((p) => p.from)).toEqual(['2025-10'])
    expect(view.plate).toMatchObject({ from: '2026-10', months: 0 })
    expect(view.plate?.slots.every((s) => s === null)).toBe(true)
  })
})
