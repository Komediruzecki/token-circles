/**
 * Money in and money out (shared/guidance/flows.ts). A deduction is pay that never reached an
 * account: it lowers income, it is never spending, and a transfer is neither.
 */
import { describe, expect, it } from 'vitest'
import { flowsByMonth, flowsOf, savedOf } from '../../../../shared/guidance/flows'

type Entry = { type: string; date: string; amount: number }
const e = (type: string, amount: number, date = '2026-03-10'): Entry => ({ type, amount, date })
const flows = (entries: Entry[]) => flowsOf(entries, (entry) => entry.amount)

describe('the flows of a set of entries', () => {
  it.each([
    ['nothing', [], { income: 0, deductions: 0, spending: 0 }, 0],
    ['pay alone', [e('income', 3000)], { income: 3000, deductions: 0, spending: 0 }, 3000],
    [
      'pay with tax taken at source',
      [e('income', 3000), e('deduction', 600)],
      { income: 2400, deductions: 600, spending: 0 },
      2400,
    ],
    [
      'pay, tax, spending and a transfer',
      [e('income', 3000), e('deduction', 600), e('expense', 2600), e('transfer', 500)],
      { income: 2400, deductions: 600, spending: 2600 },
      -200,
    ],
    [
      'a deduction with no pay booked',
      [e('deduction', 150), e('expense', 40)],
      { income: -150, deductions: 150, spending: 40 },
      -190,
    ],
    [
      'amounts stored with a sign',
      [e('income', -3000), e('deduction', -600), e('expense', -100)],
      { income: 2400, deductions: 600, spending: 100 },
      2300,
    ],
    [
      'a type the sums do not know',
      [e('refund', 80)],
      { income: 0, deductions: 0, spending: 0 },
      0,
    ],
  ])('%s', (_, entries, expected, saved) => {
    expect(flows(entries)).toEqual(expected)
    expect(savedOf(flows(entries))).toBe(saved)
  })

  it('counts each entry at the amount the caller gives it', () => {
    const converted = [{ type: 'expense', date: '2026-03-01', amount: 50000, local: 310 }]
    expect(flowsOf(converted, (entry) => entry.local).spending).toBe(310)
  })

  it('splits by month', () => {
    const byMonth = flowsByMonth(
      [
        e('income', 3000, '2026-03-25'),
        e('deduction', 600, '2026-03-25'),
        e('expense', 100, '2026-04-02'),
      ],
      (entry) => entry.amount
    )
    expect(Object.fromEntries(byMonth)).toEqual({
      '2026-03': { income: 2400, deductions: 600, spending: 0 },
      '2026-04': { income: 0, deductions: 0, spending: 100 },
    })
  })
})
