/**
 * The loan rules both runtimes run (shared/loanSchema.ts): a loan, its rate periods and its extra
 * payments. The route and handler tests prove each runtime uses them; these pin the rules and the
 * words themselves.
 */
import { describe, expect, it } from 'vitest'
import { MAX_TERM_MONTHS } from '../../../../shared/loanSchedule'
import {
  checkExtraPaymentCreate,
  checkExtraPaymentEdit,
  checkLoanCreate,
  checkLoanEdit,
  checkRatePeriodCreate,
  checkRatePeriodEdit,
  extraPaymentTotals,
  lastPaymentOf,
  LOAN_MESSAGES as M,
  periodEndMessage,
  periodStartMessage,
} from '../../../../shared/loanSchema'
import { refusalOf } from '../../../../shared/refusal'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)

/** The body the Loans form sends for a new loan. */
const LOAN = {
  name: 'Car',
  principal: 15000,
  interest_rate: 4.5,
  term_months: 60,
  start_date: '2026-01-15',
  rate_periods: [],
}

describe('a new loan', () => {
  it('keeps what it is sent, checked, and drops what it does not read', () => {
    expect(
      checkLoanCreate({
        ...LOAN,
        name: ' Car ',
        principal: '15000.50',
        interest_rate: '6.875',
        term_months: '60',
        status: 'active',
        prepayments: [{ month: 1, amount: 5 }],
      })
    ).toEqual({
      ok: true,
      value: {
        name: 'Car',
        principal: 15000.5,
        interest_rate: 6.875,
        term_months: 60,
        start_date: '2026-01-15',
        rate_periods: [],
      },
    })
  })

  it('takes a 0 % rate as an interest-free loan, not as a missing rate', () => {
    const checked = checkLoanCreate({ ...LOAN, interest_rate: 0 })
    expect(checked.ok && checked.value.interest_rate).toBe(0)
    const negativeZero = checkLoanCreate({ ...LOAN, interest_rate: '-0' })
    expect(negativeZero.ok && Object.is(negativeZero.value.interest_rate, 0)).toBe(true)
  })

  it('says each missing field in its own words, and the summary says them all', () => {
    const checked = checkLoanCreate({})
    expect(refused(checked)).toEqual({
      name: M.name,
      principal: M.principal,
      interest_rate: M.rate,
      term_months: M.term,
      start_date: M.startDate,
    })
    expect(refusalOf(refused(checked)).error).toBe(
      [M.name, M.principal, M.rate, M.term, M.startDate].join(' ')
    )
  })

  it('refuses a blank or long name', () => {
    expect(refused(checkLoanCreate({ ...LOAN, name: '   ' }))).toEqual({ name: M.name })
    expect(refused(checkLoanCreate({ ...LOAN, name: 7 }))).toEqual({ name: M.name })
    expect(refused(checkLoanCreate({ ...LOAN, name: 'x'.repeat(101) }))).toEqual({
      name: M.nameLength,
    })
    expect(checkLoanCreate({ ...LOAN, name: 'x'.repeat(100) }).ok).toBe(true)
  })

  it('refuses an amount borrowed that is not money more than zero', () => {
    const cases: [unknown, string][] = [
      ['', M.principal],
      [null, M.principal],
      ['lots', M.principalNumber],
      ['15,000', M.principalNumber],
      [0, M.amountPositive],
      [-1, M.amountPositive],
      [100.555, M.principalCents],
      [1e12, M.amountMax],
    ]
    for (const [principal, message] of cases) {
      expect(refused(checkLoanCreate({ ...LOAN, principal })), String(principal)).toEqual({
        principal: message,
      })
    }
  })

  it('refuses a rate that is missing, not a number, or outside 0 to 100', () => {
    const cases: [unknown, string][] = [
      [undefined, M.rate],
      [null, M.rate],
      ['', M.rate],
      ['4,5', M.rateNumber],
      ['five', M.rateNumber],
      [-0.5, M.rateRange],
      [100.01, M.rateRange],
    ]
    for (const [interest_rate, message] of cases) {
      expect(refused(checkLoanCreate({ ...LOAN, interest_rate })), String(interest_rate)).toEqual({
        interest_rate: message,
      })
    }
    expect(checkLoanCreate({ ...LOAN, interest_rate: 100 }).ok).toBe(true)
  })

  it('refuses a term that is not a whole number of months the schedule can amortise', () => {
    expect(refused(checkLoanCreate({ ...LOAN, term_months: '' }))).toEqual({ term_months: M.term })
    for (const term_months of [0, -12, 1.5, 'sixty', MAX_TERM_MONTHS + 1]) {
      expect(refused(checkLoanCreate({ ...LOAN, term_months })), String(term_months)).toEqual({
        term_months: M.termRange,
      })
    }
    expect(checkLoanCreate({ ...LOAN, term_months: MAX_TERM_MONTHS }).ok).toBe(true)
  })

  it('refuses a missing first payment date, and one that does not exist', () => {
    expect(refused(checkLoanCreate({ ...LOAN, start_date: '' }))).toEqual({
      start_date: M.startDate,
    })
    for (const start_date of ['2026-02-30', '15.01.2026', '2026-1-5', 20260115]) {
      expect(refused(checkLoanCreate({ ...LOAN, start_date })), String(start_date)).toEqual({
        start_date: M.startDateReal,
      })
    }
  })
})

describe("a new loan's rate periods", () => {
  it('keeps each period checked, an empty last payment or 0 as the end of the loan', () => {
    const checked = checkLoanCreate({
      ...LOAN,
      rate_periods: [
        { rate: '6.25', start_month: '13', end_month: '30' },
        { rate: 3, start_month: 31, end_month: null },
        { rate: 3.5, start_month: 40, end_month: 0, id: 9 },
      ],
    })
    expect(checked.ok && checked.value.rate_periods).toEqual([
      { rate: 6.25, start_month: 13, end_month: 30 },
      { rate: 3, start_month: 31, end_month: null },
      { rate: 3.5, start_month: 40, end_month: null },
    ])
  })

  it('takes a missing or null list as none, and refuses one that is not a list', () => {
    const { rate_periods: _left, ...without } = LOAN
    expect(checkLoanCreate(without)).toMatchObject({ ok: true, value: { rate_periods: [] } })
    expect(checkLoanCreate({ ...LOAN, rate_periods: null })).toMatchObject({
      ok: true,
      value: { rate_periods: [] },
    })
    expect(refused(checkLoanCreate({ ...LOAN, rate_periods: { rate: 3 } }))).toEqual({
      rate_periods: M.ratePeriods,
    })
  })

  it("says what is wrong at the period's own field, by its place in the list", () => {
    expect(
      refused(
        checkLoanCreate({
          ...LOAN,
          rate_periods: [
            { rate: 5, start_month: 1, end_month: 12 },
            { rate: '', start_month: 0, end_month: null },
            { rate: 101, start_month: 30, end_month: 24 },
            { rate: 'x', start_month: 61, end_month: 61 },
          ],
        })
      )
    ).toEqual({
      'rate_periods.1.rate': M.periodRate,
      'rate_periods.1.start_month': periodStartMessage(60),
      'rate_periods.2.rate': M.rateRange,
      'rate_periods.2.end_month': periodEndMessage(30, 60),
      'rate_periods.3.rate': M.rateNumber,
      'rate_periods.3.start_month': periodStartMessage(60),
      'rate_periods.3.end_month': periodEndMessage(1, 60),
    })
  })

  it("bounds a period's payments by the loan's own term", () => {
    expect(
      refused(
        checkLoanCreate({
          ...LOAN,
          term_months: 24,
          rate_periods: [{ rate: 5, start_month: 25, end_month: null }],
        })
      )
    ).toEqual({ 'rate_periods.0.start_month': periodStartMessage(24) })
    // A term that is refused itself leaves the periods to the schedule's own bound.
    expect(
      refused(
        checkLoanCreate({
          ...LOAN,
          term_months: 0,
          rate_periods: [{ rate: 5, start_month: 25, end_month: null }],
        })
      )
    ).toEqual({ term_months: M.termRange })
  })

  it('reads the last payment a term allows', () => {
    expect(lastPaymentOf(60)).toBe(60)
    expect(lastPaymentOf('48')).toBe(48)
    expect(lastPaymentOf(MAX_TERM_MONTHS * 2)).toBe(MAX_TERM_MONTHS)
    for (const term of [0, null, undefined, 'x']) expect(lastPaymentOf(term)).toBe(MAX_TERM_MONTHS)
  })
})

describe('an edit of a loan', () => {
  /** A loan as a runtime stores it, rate periods with their ids. */
  const STORED = {
    id: 4,
    name: 'Car',
    principal: 15000,
    interest_rate: 4.5,
    term_months: 60,
    start_date: '2026-01-15',
    rate_periods: [{ id: 7, loan_id: 4, rate: 6, start_month: 13, end_month: 24 }],
  }

  it('changes only what the body changes, sent as the form sends it', () => {
    expect(
      checkLoanEdit(
        {
          name: 'Car loan',
          principal: '15000',
          interest_rate: '4.5',
          term_months: 60,
          start_date: '2026-01-15',
          rate_periods: [{ rate: '6', start_month: '13', end_month: '24' }],
        },
        STORED
      )
    ).toEqual({ ok: true, value: { name: 'Car loan' } })
  })

  it('leaves out what it is not sent, the rate periods included', () => {
    expect(checkLoanEdit({ interest_rate: 3.9 }, STORED)).toEqual({
      ok: true,
      value: { interest_rate: 3.9 },
    })
  })

  it('saves a loan stored under older rules with its own values sent back', () => {
    const old = {
      ...STORED,
      name: 'x'.repeat(140),
      principal: 15000.555,
      interest_rate: 250,
      term_months: 0,
      start_date: '2026-01-15 00:00:00',
      rate_periods: [{ rate: 300, start_month: 0, end_month: 0 }],
    }
    expect(
      checkLoanEdit(
        {
          name: old.name,
          principal: old.principal,
          interest_rate: old.interest_rate,
          term_months: old.term_months,
          start_date: old.start_date,
          rate_periods: [{ rate: 300, start_month: 0, end_month: null }],
        },
        old
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('refuses what it changes as a new loan would be refused', () => {
    expect(
      refused(
        checkLoanEdit(
          { name: ' ', principal: 0, interest_rate: 'x', term_months: 1201, start_date: '' },
          STORED
        )
      )
    ).toEqual({
      name: M.name,
      principal: M.amountPositive,
      interest_rate: M.rateNumber,
      term_months: M.termRange,
      start_date: M.startDate,
    })
  })

  it('refuses a rate left out as null, rather than keeping or inventing one', () => {
    expect(refused(checkLoanEdit({ interest_rate: null }, STORED))).toEqual({
      interest_rate: M.rate,
    })
  })

  it('answers the whole new list of rate periods when it changes, kept periods as stored', () => {
    const old = { ...STORED, rate_periods: [{ id: 7, rate: 300, start_month: 13, end_month: 24 }] }
    expect(
      checkLoanEdit(
        {
          rate_periods: [
            { rate: 300, start_month: 13, end_month: 24 },
            { rate: 2.5, start_month: 25, end_month: '' },
          ],
        },
        old
      )
    ).toEqual({
      ok: true,
      value: {
        rate_periods: [
          { rate: 300, start_month: 13, end_month: 24 },
          { rate: 2.5, start_month: 25, end_month: null },
        ],
      },
    })
    // Removing every period is a change too.
    expect(checkLoanEdit({ rate_periods: [] }, STORED)).toEqual({
      ok: true,
      value: { rate_periods: [] },
    })
  })

  it('checks a changed period against the term the edit leaves the loan with', () => {
    expect(
      refused(
        checkLoanEdit(
          { term_months: 12, rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }] },
          { ...STORED, rate_periods: [] }
        )
      )
    ).toEqual({
      'rate_periods.0.start_month': periodStartMessage(12),
      'rate_periods.0.end_month': periodEndMessage(1, 12),
    })
    // The same period, stored already, stays as it is when the term shortens past it.
    expect(
      checkLoanEdit(
        { term_months: 12, rate_periods: [{ rate: 6, start_month: 13, end_month: 24 }] },
        STORED
      )
    ).toEqual({ ok: true, value: { term_months: 12 } })
  })

  it('matches each stored period to one sent period at most', () => {
    const checked = checkLoanEdit(
      {
        rate_periods: [
          { rate: 6, start_month: 13, end_month: 24 },
          { rate: 6, start_month: 13, end_month: 24 },
        ],
      },
      STORED
    )
    expect(checked.ok && checked.value.rate_periods).toHaveLength(2)
  })
})

describe('a rate period on its own', () => {
  it('is checked as a period in a loan is, against the loan term', () => {
    expect(checkRatePeriodCreate({ rate: '5.5', start_month: 13, end_month: '' }, 60)).toEqual({
      ok: true,
      value: { rate: 5.5, start_month: 13, end_month: null },
    })
    expect(refused(checkRatePeriodCreate({ rate: 5, start_month: 61 }, 60))).toEqual({
      start_month: periodStartMessage(60),
    })
    expect(refused(checkRatePeriodCreate({}, 60))).toEqual({
      rate: M.periodRate,
      start_month: periodStartMessage(60),
    })
  })

  it('changes only what an edit changes', () => {
    const stored = { id: 3, rate: 6, start_month: 13, end_month: 24 }
    expect(checkRatePeriodEdit({ rate: 5.5, start_month: 13, end_month: 24 }, stored, 60)).toEqual({
      ok: true,
      value: { rate: 5.5 },
    })
    expect(checkRatePeriodEdit({ end_month: null }, stored, 60)).toEqual({
      ok: true,
      value: { end_month: null },
    })
    expect(checkRatePeriodEdit({ rate: 6, start_month: 13, end_month: 24 }, stored, 60)).toEqual({
      ok: true,
      value: {},
    })
  })

  it('refuses a start moved past the end it leaves alone, at the end', () => {
    expect(
      refused(
        checkRatePeriodEdit({ start_month: 30 }, { rate: 6, start_month: 13, end_month: 24 }, 60)
      )
    ).toEqual({ end_month: periodEndMessage(30, 60) })
  })

  it('keeps a stored period the term has since passed, while its rate changes', () => {
    expect(
      checkRatePeriodEdit(
        { rate: 4, start_month: 50, end_month: null },
        { rate: 6, start_month: 50, end_month: null },
        24
      )
    ).toEqual({ ok: true, value: { rate: 4 } })
  })
})

describe('an extra payment', () => {
  it('keeps the payment it goes with, the amount and the note without its outer spaces', () => {
    expect(checkExtraPaymentCreate({ month: 12, amount: 2500.45, note: '  Bonus ' }, 120)).toEqual({
      ok: true,
      value: { month: 12, amount: 2500.45, note: 'Bonus' },
    })
    expect(checkExtraPaymentCreate({ month: '3', amount: '100.5' }, 120)).toEqual({
      ok: true,
      value: { month: 3, amount: 100.5, note: '' },
    })
    expect(checkExtraPaymentCreate({ month: 1, amount: 10, note: null }, 120)).toMatchObject({
      ok: true,
      value: { note: '' },
    })
  })

  it('refuses a payment outside the loan, at the month', () => {
    expect(checkExtraPaymentCreate({ month: 120, amount: 10 }, 120).ok).toBe(true)
    for (const month of [0, -1, 1.5, 121, null, undefined, 'June']) {
      expect(refused(checkExtraPaymentCreate({ month, amount: 10 }, 120)), String(month)).toEqual({
        month: M.extraMonth,
      })
    }
    expect(checkExtraPaymentCreate({ month: MAX_TERM_MONTHS, amount: 10 }, null).ok).toBe(true)
    expect(checkExtraPaymentCreate({ month: MAX_TERM_MONTHS + 1, amount: 10 }, 0).ok).toBe(false)
  })

  it('refuses an amount that is not money more than zero, to the cent', () => {
    const cases: [unknown, string][] = [
      [undefined, M.extraAmount],
      ['', M.extraAmount],
      ['lots', M.extraAmountNumber],
      [0, M.amountPositive],
      [-5, M.amountPositive],
      [99.999, M.extraAmountCents],
      [1e12, M.amountMax],
    ]
    for (const [amount, message] of cases) {
      expect(refused(checkExtraPaymentCreate({ month: 1, amount }, 120)), String(amount)).toEqual({
        amount: message,
      })
    }
  })

  it('refuses a note that is not text, and says every field that is wrong at once', () => {
    expect(refused(checkExtraPaymentCreate({ month: 1, amount: 10, note: 7 }, 120))).toEqual({
      note: M.note,
    })
    expect(refused(checkExtraPaymentCreate(null, 120))).toEqual({
      month: M.extraMonth,
      amount: M.extraAmount,
    })
  })

  it('changes only what an edit changes, and keeps a month a shorter term has passed', () => {
    const stored = { id: 2, month: 50, amount: 500, note: null }
    expect(checkExtraPaymentEdit({ month: 50, amount: 750.25, note: '' }, stored, 24)).toEqual({
      ok: true,
      value: { amount: 750.25 },
    })
    expect(refused(checkExtraPaymentEdit({ month: 51, amount: 0 }, stored, 24))).toEqual({
      month: M.extraMonth,
      amount: M.amountPositive,
    })
    expect(checkExtraPaymentEdit({ note: ' Bonus ' }, stored, 24)).toEqual({
      ok: true,
      value: { note: 'Bonus' },
    })
  })
})

describe('the totals a loan list row carries', () => {
  it('counts the extra payments and adds them up to the cent; none is a total of 0', () => {
    expect(extraPaymentTotals([])).toEqual({ total_prepaid: 0, prepayment_count: 0 })
    expect(extraPaymentTotals(undefined)).toEqual({ total_prepaid: 0, prepayment_count: 0 })
    expect(extraPaymentTotals([{ amount: 0.1 }, { amount: 0.2 }, { amount: '1000' }])).toEqual({
      total_prepaid: 1000.3,
      prepayment_count: 3,
    })
  })
})
