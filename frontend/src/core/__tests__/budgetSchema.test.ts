/**
 * The budget rules both runtimes run (shared/budgetSchema.ts). The route and handler tests prove
 * each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  BUDGET_MESSAGES as M,
  checkAllocation,
  checkBudgetCreate,
  checkBudgetEdit,
  checkBudgetMonth,
  checkRollover,
} from '../../../../shared/budgetSchema'
import { refusalOf } from '../../../../shared/refusal'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)
const DEFAULTS = { monthStart: '2026-10-01' }

describe('a new budget', () => {
  it('needs a category and an amount; the rest take their defaults', () => {
    expect(checkBudgetCreate({ category_id: 4, amount: 250 }, DEFAULTS)).toEqual({
      ok: true,
      value: {
        category_id: 4,
        amount: 250,
        period: 'monthly',
        start_date: '2026-10-01',
        end_date: null,
        rollover_enabled: false,
      },
    })
  })

  it('reads every field, as numbers or text, and drops the rest', () => {
    expect(
      checkBudgetCreate(
        {
          category_id: '4',
          amount: '250.50',
          period: 'Yearly',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          rollover_enabled: 1,
          profile_id: 99,
          spent: 12,
        },
        DEFAULTS
      )
    ).toEqual({
      ok: true,
      value: {
        category_id: 4,
        amount: 250.5,
        period: 'yearly',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        rollover_enabled: true,
      },
    })
  })

  it('takes a budget of zero: spend nothing here', () => {
    expect(checkBudgetCreate({ category_id: 4, amount: 0 }, DEFAULTS).ok).toBe(true)
  })

  it('asks for the category', () => {
    for (const category_id of [undefined, null, '', 0, -1, 1.5, 'food']) {
      expect(refused(checkBudgetCreate({ category_id, amount: 10 }, DEFAULTS))).toEqual({
        category_id: M.category,
      })
    }
  })

  it('says what is wrong with the amount', () => {
    const amount = (value: unknown) =>
      refused(checkBudgetCreate({ category_id: 4, amount: value }, DEFAULTS)).amount
    expect(amount(undefined)).toBe(M.amount)
    expect(amount('')).toBe(M.amount)
    expect(amount('12abc')).toBe(M.amountNumber)
    expect(amount(Number.NaN)).toBe(M.amountNumber)
    expect(amount(-5)).toBe(M.amountNegative)
    expect(amount(10.555)).toBe(M.amountCents)
    expect(amount(1e12)).toBe(M.amountMax)
  })

  it('takes monthly, weekly or yearly', () => {
    expect(
      refused(checkBudgetCreate({ category_id: 4, amount: 1, period: 'daily' }, DEFAULTS))
    ).toEqual({ period: M.period })
  })

  it('needs real dates, and an end on or after the start', () => {
    const dates = (start_date: unknown, end_date: unknown) =>
      refused(checkBudgetCreate({ category_id: 4, amount: 1, start_date, end_date }, DEFAULTS))
    expect(dates('2026-02-30', undefined)).toEqual({ start_date: M.startDate })
    expect(dates('01/02/2026', undefined)).toEqual({ start_date: M.startDate })
    expect(dates('2026-03-01', '2026-13-01')).toEqual({ end_date: M.endDate })
    expect(dates('2026-03-01', '2026-02-28')).toEqual({ end_date: M.endDate })
    expect(dates('2026-03-01', '2026-03-01')).toEqual({})
    // No start date: the end is measured against the month's first day.
    expect(dates(undefined, '2026-09-30')).toEqual({ end_date: M.endDate })
  })

  it('says rollover is on or off', () => {
    expect(
      refused(checkBudgetCreate({ category_id: 4, amount: 1, rollover_enabled: 'yes' }, DEFAULTS))
    ).toEqual({ rollover_enabled: M.rollover })
  })

  it('sums every message up for a client that cannot place them', () => {
    expect(refusalOf(refused(checkBudgetCreate({}, DEFAULTS)))).toEqual({
      error: `${M.category} ${M.amount}`,
      fields: { category_id: M.category, amount: M.amount },
    })
  })
})

describe('an edit of a budget', () => {
  const STORED = {
    id: 7,
    category_id: 4,
    amount: 250,
    period: 'monthly',
    start_date: '2026-10-01',
    end_date: null,
    rollover_enabled: 0,
  }

  it('changes only what it sends', () => {
    expect(checkBudgetEdit({ amount: 300 }, STORED)).toEqual({ ok: true, value: { amount: 300 } })
  })

  it('writes nothing it sends back unchanged, however it is written', () => {
    expect(
      checkBudgetEdit(
        {
          category_id: '4',
          amount: '250.00',
          period: 'monthly',
          start_date: '2026-10-01',
          end_date: '',
          rollover_enabled: false,
        },
        STORED
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('leaves alone what an older version stored, while it is sent back as it was', () => {
    const old = { ...STORED, amount: 10.555, start_date: '01.10.2026', period: 'quarterly' }
    expect(
      checkBudgetEdit(
        { amount: 10.555, start_date: '01.10.2026', period: 'quarterly', rollover_enabled: true },
        old
      )
    ).toEqual({ ok: true, value: { rollover_enabled: true } })
    expect(refused(checkBudgetEdit({ amount: 10.556 }, old))).toEqual({ amount: M.amountCents })
  })

  it('cannot blank the category, the amount or the start date', () => {
    expect(
      refused(checkBudgetEdit({ category_id: null, amount: '', start_date: '' }, STORED))
    ).toEqual({ category_id: M.category, amount: M.amount, start_date: M.startDate })
  })

  it('measures an end date against the start date the budget will have', () => {
    expect(refused(checkBudgetEdit({ end_date: '2026-09-30' }, STORED))).toEqual({
      end_date: M.endDate,
    })
    expect(checkBudgetEdit({ start_date: '2026-09-01', end_date: '2026-09-30' }, STORED)).toEqual({
      ok: true,
      value: { start_date: '2026-09-01', end_date: '2026-09-30' },
    })
    expect(
      refused(checkBudgetEdit({ start_date: '2026-11-01' }, { ...STORED, end_date: '2026-10-31' }))
    ).toEqual({
      end_date: M.endDate,
    })
  })
})

describe('allocating a budget for a month', () => {
  it('needs the category and the amount; the period is monthly unless sent', () => {
    expect(checkAllocation({ category_id: 4, amount: '75.25' })).toEqual({
      ok: true,
      value: { category_id: 4, amount: 75.25, period: 'monthly' },
    })
    expect(refused(checkAllocation({ amount: -1 }))).toEqual({
      category_id: M.category,
      amount: M.amountNegative,
    })
  })

  it('takes the month as YYYY-MM, and the current one when none is given', () => {
    expect(checkBudgetMonth('2026-03', '2026-10')).toEqual({ ok: true, value: '2026-03' })
    expect(checkBudgetMonth(null, '2026-10')).toEqual({ ok: true, value: '2026-10' })
    expect(checkBudgetMonth('', '2026-10')).toEqual({ ok: true, value: '2026-10' })
    for (const month of ['2026-13', '2026-3', 'March', '2026-03-01']) {
      expect(refused(checkBudgetMonth(month, '2026-10'))).toEqual({ month: M.month })
    }
  })
})

describe('a rollover change', () => {
  it('takes on or off, an amount and the amount used', () => {
    expect(checkRollover({ rollover_enabled: true })).toEqual({
      ok: true,
      value: { rollover_enabled: true },
    })
    expect(checkRollover({ rollover_amount: -12.5, rollover_used: '3' })).toEqual({
      ok: true,
      value: { rollover_amount: -12.5, rollover_used: 3 },
    })
  })

  it('says what is wrong with each', () => {
    expect(
      refused(checkRollover({ rollover_enabled: 'maybe', rollover_amount: 'x', rollover_used: -1 }))
    ).toEqual({
      rollover_enabled: M.rollover,
      rollover_amount: M.rolloverAmount,
      rollover_used: M.rolloverUsed,
    })
  })

  it('needs something to change', () => {
    expect(refused(checkRollover({}))).toEqual({ rollover_enabled: M.rolloverNothing })
  })
})
