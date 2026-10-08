/**
 * The check both runtimes put an extra payment through before storing it, added or changed:
 * shared/loanExtraPayment.ts. The routes' own tests prove each runtime calls it; this proves what
 * it accepts and what it refuses.
 */
import { describe, expect, it } from 'vitest'
import { EXTRA_PAYMENT_ERRORS, readExtraPayment } from '../../../../shared/loanExtraPayment'
import { MAX_TERM_MONTHS } from '../../../../shared/loanSchedule'

describe('readExtraPayment', () => {
  it('keeps the month, the amount to the cent, and the note without its outer spaces', () => {
    expect(readExtraPayment({ month: 12, amount: 2500.456, note: '  Bonus ' }, 120)).toEqual({
      ok: true,
      value: { month: 12, amount: 2500.46, note: 'Bonus' },
    })
  })

  it('takes a missing or null note as no note', () => {
    expect(readExtraPayment({ month: 1, amount: 10 }, 120)).toEqual({
      ok: true,
      value: { month: 1, amount: 10, note: '' },
    })
    expect(readExtraPayment({ month: 1, amount: 10, note: null }, 120)).toMatchObject({
      ok: true,
      value: { note: '' },
    })
  })

  it('accepts the last payment of the term and refuses the one after it', () => {
    expect(readExtraPayment({ month: 120, amount: 10 }, 120).ok).toBe(true)
    expect(readExtraPayment({ month: 121, amount: 10 }, 120)).toEqual({
      ok: false,
      error: EXTRA_PAYMENT_ERRORS.month,
    })
  })

  it('refuses a month that is not a whole payment number from 1', () => {
    for (const month of [0, -1, 1.5, '12', null, undefined, Number.NaN]) {
      expect(readExtraPayment({ month, amount: 10 }, 120)).toEqual({
        ok: false,
        error: EXTRA_PAYMENT_ERRORS.month,
      })
    }
  })

  it('bounds the month by the engine when the loan has no term to go by', () => {
    expect(readExtraPayment({ month: MAX_TERM_MONTHS, amount: 10 }, null).ok).toBe(true)
    expect(readExtraPayment({ month: MAX_TERM_MONTHS + 1, amount: 10 }, 0).ok).toBe(false)
  })

  it('refuses an amount that is not a number above zero, after rounding to the cent', () => {
    for (const amount of [0, -5, 0.004, '100', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readExtraPayment({ month: 1, amount }, 120)).toEqual({
        ok: false,
        error: EXTRA_PAYMENT_ERRORS.amount,
      })
    }
  })

  it('refuses a note that is not text, and a body that is not an object', () => {
    expect(readExtraPayment({ month: 1, amount: 10, note: 7 }, 120)).toEqual({
      ok: false,
      error: EXTRA_PAYMENT_ERRORS.note,
    })
    expect(readExtraPayment(null, 120).ok).toBe(false)
    expect(readExtraPayment('month=1', 120).ok).toBe(false)
  })
})
