/**
 * The holding rules both runtimes run (shared/holdingSchema.ts). The route and handler tests prove
 * each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  checkHoldingCreate,
  checkHoldingEdit,
  HOLDING_MESSAGES as M,
  toHoldingPrecision,
} from '../../../../shared/holdingSchema'
import { refusalOf } from '../../../../shared/refusal'

/** What the Portfolio form posts. */
const FORM = {
  ticker: 'EXMPL',
  shares: 12,
  purchase_price: 48.5,
  purchase_date: '2026-02-10',
  notes: 'Monthly plan',
}

describe('a new holding', () => {
  it("is the form's fields, read and trimmed, the ticker in capitals, and nothing else", () => {
    expect(
      checkHoldingCreate({ ...FORM, ticker: ' exmpl ', purchase_date: ' 2026-02-10 ', id: 9 })
    ).toEqual({ ok: true, value: FORM })
  })

  it('reads shares and a price sent as text, and notes left out as none', () => {
    expect(
      checkHoldingCreate({ ...FORM, shares: '2.5', purchase_price: '101.25', notes: undefined })
    ).toEqual({ ok: true, value: { ...FORM, shares: 2.5, purchase_price: 101.25, notes: '' } })
  })

  it('needs a ticker, shares, a price and a date, and says so at each field', () => {
    expect(checkHoldingCreate({})).toEqual({
      ok: false,
      fields: {
        ticker: M.ticker,
        shares: M.shares,
        purchase_price: M.price,
        purchase_date: M.date,
      },
    })
    expect(
      checkHoldingCreate({ ticker: ' ', shares: '', purchase_price: null, purchase_date: '' })
    ).toEqual({
      ok: false,
      fields: {
        ticker: M.ticker,
        shares: M.shares,
        purchase_price: M.price,
        purchase_date: M.date,
      },
    })
  })

  it('takes a ticker of up to 20 characters, and refuses a longer one', () => {
    const ticker = (value: unknown) => checkHoldingCreate({ ...FORM, ticker: value })
    expect(ticker('ABCDEFGHIJKLMNOP.XYZ')).toMatchObject({ ok: true })
    expect(ticker('ABCDEFGHIJKLMNOPQ.XYZ')).toEqual({
      ok: false,
      fields: { ticker: 'Keep the ticker to 20 characters or fewer.' },
    })
    expect(ticker(true)).toEqual({ ok: false, fields: { ticker: M.ticker } })
    // A number is the ticker written as one, as both runtimes stored it before.
    expect(ticker(7203)).toMatchObject({ ok: true, value: { ticker: '7203' } })
  })

  it('refuses shares that are not a number, are zero or less, or are too many', () => {
    const shares = (value: unknown) => checkHoldingCreate({ ...FORM, shares: value })
    expect(shares('lots')).toEqual({ ok: false, fields: { shares: M.sharesNumber } })
    expect(shares('12abc')).toEqual({ ok: false, fields: { shares: M.sharesNumber } })
    expect(shares(0)).toEqual({ ok: false, fields: { shares: M.sharesPositive } })
    expect(shares(-3)).toEqual({ ok: false, fields: { shares: M.sharesPositive } })
    expect(shares(1e12)).toEqual({ ok: false, fields: { shares: M.sharesMax } })
  })

  it('takes a fraction of a share and a price in fractions of a cent', () => {
    expect(checkHoldingCreate({ ...FORM, shares: 0.12345678, purchase_price: 0.0345 })).toEqual({
      ok: true,
      value: { ...FORM, shares: 0.12345678, purchase_price: 0.0345 },
    })
  })

  it('refuses a price that is not a number, is zero or less, or is too large', () => {
    const price = (value: unknown) => checkHoldingCreate({ ...FORM, purchase_price: value })
    expect(price('cheap')).toEqual({ ok: false, fields: { purchase_price: M.priceNumber } })
    expect(price(0)).toEqual({ ok: false, fields: { purchase_price: M.pricePositive } })
    expect(price(-0.01)).toEqual({ ok: false, fields: { purchase_price: M.pricePositive } })
    expect(price(1e12)).toEqual({ ok: false, fields: { purchase_price: M.priceMax } })
  })

  it('refuses a date that is not a real one written YYYY-MM-DD', () => {
    for (const purchase_date of ['1 May', '2026-02-30', '2026-2-1', 20260210]) {
      expect(checkHoldingCreate({ ...FORM, purchase_date })).toEqual({
        ok: false,
        fields: { purchase_date: 'Enter a real date, written like 2026-02-10.' },
      })
    }
  })

  it('refuses notes that are not text', () => {
    expect(checkHoldingCreate({ ...FORM, notes: 5 })).toEqual({
      ok: false,
      fields: { notes: M.notes },
    })
  })

  it('answers the refusal both runtimes send', () => {
    const checked = checkHoldingCreate({ ...FORM, ticker: '', shares: 0 })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields)).toEqual({
      error: `${M.ticker} ${M.sharesPositive}`,
      fields: { ticker: M.ticker, shares: M.sharesPositive },
    })
  })
})

describe('an edit', () => {
  const stored = {
    id: 4,
    profile_id: 1,
    ticker: 'EXMPL',
    shares: 12,
    purchase_price: 48.5,
    purchase_date: '2026-02-10',
    notes: 'Monthly plan',
  }

  it('changes only what it changes', () => {
    expect(checkHoldingEdit({ shares: 15, notes: 'Doubled' }, stored)).toEqual({
      ok: true,
      value: { shares: 15, notes: 'Doubled' },
    })
  })

  it('writes nothing it is sent back unchanged, however it is written', () => {
    expect(
      checkHoldingEdit(
        { ticker: 'exmpl', shares: '12', purchase_price: '48.50', purchase_date: '2026-02-10' },
        stored
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('checks a changed field like a new holding', () => {
    expect(checkHoldingEdit({ ticker: ' ', shares: 0, purchase_date: 'soon' }, stored)).toEqual({
      ok: false,
      fields: { ticker: M.ticker, shares: M.sharesPositive, purchase_date: M.dateReal },
    })
  })

  it('takes back what an older version stored', () => {
    const older = { ...stored, ticker: 'A'.repeat(25), purchase_price: -5, purchase_date: 'soon' }
    expect(
      checkHoldingEdit(
        {
          ...FORM,
          ticker: 'A'.repeat(25),
          purchase_price: -5,
          purchase_date: 'soon',
          notes: 'New',
        },
        older
      )
    ).toEqual({ ok: true, value: { notes: 'New' } })
  })

  it('gives notes to a row that never had any, and leaves it alone when they are blank', () => {
    const bare = { ...stored, notes: undefined }
    expect(checkHoldingEdit({ ...FORM, notes: '' }, bare)).toEqual({ ok: true, value: {} })
    expect(checkHoldingEdit({ ...FORM, notes: 'First' }, bare)).toEqual({
      ok: true,
      value: { notes: 'First' },
    })
  })
})

describe('a number the app works out', () => {
  // As text, so the assertion is the digits a person sees in the field.
  const worked = (value: number) => String(toHoldingPrecision(value))

  it('loses the error floating point leaves on a sum or a division', () => {
    expect(worked(0.1 + 0.2)).toBe('0.3')
    expect(worked((30.3 + 71.4) / 10)).toBe('10.17')
    expect(worked(1220 / 12)).toBe('101.66666667')
  })

  it('keeps eight decimal places, and a large number as it is', () => {
    expect(worked(0.12345678)).toBe('0.12345678')
    expect(worked(123456789.123)).toBe('123456789.123')
  })
})
