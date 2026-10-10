/**
 * The housing expense rules both runtimes run (shared/housingSchema.ts). The route and handler
 * tests prove each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  checkHousingCreate,
  checkHousingEdit,
  HOUSING_MESSAGES as M,
  HOUSING_TYPES,
  housingAnswer,
  housingDueDate,
  housingFormFields,
  housingRowOf,
} from '../../../../shared/housingSchema'
import { refusalOf } from '../../../../shared/refusal'

const MARCH = { month: 3 }

/** What the Housing form posts. */
const FORM = {
  type: 'rent',
  property_name: 'Flat on the corner',
  monthly_amount: 850.5,
  due_day: 5,
  due_month: 4,
  autopay: true,
  notes: 'To the landlord',
}

describe('a new housing expense', () => {
  it("is the form's fields, read and trimmed, and nothing else", () => {
    expect(checkHousingCreate({ ...FORM, property_name: ' Flat ', id: 9 }, MARCH)).toEqual({
      ok: true,
      value: { ...FORM, property_name: 'Flat' },
    })
  })

  it('takes the name as name when property_name is not sent', () => {
    const checked = checkHousingCreate({ ...FORM, property_name: undefined, name: 'Flat' }, MARCH)
    expect(checked.ok && checked.value.property_name).toBe('Flat')
  })

  it('fills in what a body leaves out: other, the current month, the 1st, no autopay', () => {
    expect(checkHousingCreate({ property_name: 'Parking', monthly_amount: '60' }, MARCH)).toEqual({
      ok: true,
      value: {
        property_name: 'Parking',
        type: 'other',
        monthly_amount: 60,
        due_month: 3,
        due_day: 1,
        autopay: false,
        notes: '',
      },
    })
  })

  it('needs a name and an amount, and says so at each field', () => {
    expect(checkHousingCreate({}, MARCH)).toEqual({
      ok: false,
      fields: { property_name: M.name, monthly_amount: M.amount },
    })
    expect(checkHousingCreate({ ...FORM, property_name: '  ', monthly_amount: '' }, MARCH)).toEqual(
      {
        ok: false,
        fields: { property_name: M.name, monthly_amount: M.amount },
      }
    )
  })

  it('takes a name of up to 100 characters, and refuses a longer one', () => {
    expect(checkHousingCreate({ ...FORM, property_name: 'x'.repeat(100) }, MARCH).ok).toBe(true)
    expect(checkHousingCreate({ ...FORM, property_name: 'x'.repeat(101) }, MARCH)).toEqual({
      ok: false,
      fields: { property_name: 'Keep the name to 100 characters or fewer.' },
    })
  })

  it('refuses an amount that is not a number, is zero or less, is past the cent or too large', () => {
    const amount = (monthly_amount: unknown) =>
      checkHousingCreate({ ...FORM, monthly_amount }, MARCH)
    expect(amount('lots')).toEqual({ ok: false, fields: { monthly_amount: M.amountNumber } })
    expect(amount(0)).toEqual({ ok: false, fields: { monthly_amount: M.amountPositive } })
    expect(amount(-5)).toEqual({ ok: false, fields: { monthly_amount: M.amountPositive } })
    expect(amount(10.555)).toEqual({ ok: false, fields: { monthly_amount: M.amountCents } })
    expect(amount(1e12)).toEqual({ ok: false, fields: { monthly_amount: M.amountMax } })
    expect(amount('1200.50')).toMatchObject({ ok: true, value: { monthly_amount: 1200.5 } })
  })

  it('takes the six types the form offers, and refuses any other', () => {
    for (const type of HOUSING_TYPES) {
      expect(checkHousingCreate({ ...FORM, type }, MARCH)).toMatchObject({ ok: true })
    }
    expect(checkHousingCreate({ ...FORM, type: 'castle' }, MARCH)).toEqual({
      ok: false,
      fields: { type: 'Choose Rent, Mortgage, HOA Fees, Property Tax, Insurance or Other.' },
    })
  })

  it('takes a due month from 1 to 12 and a due day from 1 to 31, as numbers or text', () => {
    expect(checkHousingCreate({ ...FORM, due_month: '12', due_day: '31' }, MARCH)).toMatchObject({
      ok: true,
      value: { due_month: 12, due_day: 31 },
    })
    for (const due_month of [0, 13, 1.5, 'May']) {
      expect(checkHousingCreate({ ...FORM, due_month }, MARCH)).toEqual({
        ok: false,
        fields: { due_month: M.dueMonth },
      })
    }
    for (const due_day of [0, 32, 2.5, 'first']) {
      expect(checkHousingCreate({ ...FORM, due_day }, MARCH)).toEqual({
        ok: false,
        fields: { due_day: 'Enter a day of the month from 1 to 31.' },
      })
    }
  })

  it('refuses a due day the month does not have, and takes 29 February', () => {
    expect(checkHousingCreate({ ...FORM, due_month: 4, due_day: 31 }, MARCH)).toEqual({
      ok: false,
      fields: { due_day: 'April has no 31st. Enter a day from 1 to 30.' },
    })
    expect(checkHousingCreate({ ...FORM, due_month: '2', due_day: '30' }, MARCH)).toEqual({
      ok: false,
      fields: { due_day: 'February has no 30th. Enter a day from 1 to 29.' },
    })
    expect(checkHousingCreate({ ...FORM, due_month: 2, due_day: 29 }, MARCH)).toMatchObject({
      ok: true,
      value: { due_month: 2, due_day: 29 },
    })
    // A body without a month falls due in the person's month, and is checked against that one.
    expect(
      checkHousingCreate({ ...FORM, due_month: undefined, due_day: 31 }, { month: 6 })
    ).toEqual({
      ok: false,
      fields: { due_day: 'June has no 31st. Enter a day from 1 to 30.' },
    })
  })

  it('refuses autopay that is not yes or no, and notes that are not text', () => {
    expect(checkHousingCreate({ ...FORM, autopay: 'maybe', notes: 5 }, MARCH)).toEqual({
      ok: false,
      fields: { autopay: M.autopay, notes: M.notes },
    })
  })

  it('answers the refusal both runtimes send', () => {
    const checked = checkHousingCreate({ ...FORM, property_name: '', monthly_amount: 0 }, MARCH)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields)).toEqual({
      error: `${M.name} ${M.amountPositive}`,
      fields: { property_name: M.name, monthly_amount: M.amountPositive },
    })
  })

  it('is stored as its columns, the due month and day as "MM-DD"', () => {
    const checked = checkHousingCreate(FORM, MARCH)
    if (!checked.ok) throw new Error('refused')
    expect(housingRowOf(checked.value)).toEqual({
      name: 'Flat on the corner',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: true,
      notes: 'To the landlord',
    })
    expect(housingDueDate(12, 1)).toBe('12-01')
  })
})

describe('an edit', () => {
  const stored = {
    id: 4,
    name: 'Flat on the corner',
    type: 'rent',
    monthly_amount: 850.5,
    due_date: '04-05',
    autopay: 1,
    notes: 'To the landlord',
  }

  it('reads a stored row as the form names its fields', () => {
    expect(housingFormFields(stored)).toEqual({
      property_name: 'Flat on the corner',
      type: 'rent',
      monthly_amount: 850.5,
      due_month: 4,
      due_day: 5,
      autopay: 1,
      notes: 'To the landlord',
    })
    expect(housingFormFields({ ...stored, due_date: '' })).toMatchObject({
      due_month: undefined,
      due_day: undefined,
    })
  })

  it('changes only what it changes, the type too', () => {
    expect(checkHousingEdit({ type: 'mortgage', monthly_amount: '900' }, stored, MARCH)).toEqual({
      ok: true,
      value: { type: 'mortgage', monthly_amount: 900 },
    })
  })

  it('writes nothing it is sent back unchanged', () => {
    expect(checkHousingEdit({ ...FORM, autopay: true }, stored, MARCH)).toEqual({
      ok: true,
      value: {},
    })
  })

  it('moves the due date with the month or the day, keeping the other', () => {
    expect(checkHousingEdit({ due_day: 20 }, stored, MARCH)).toEqual({
      ok: true,
      value: { due_date: '04-20' },
    })
    expect(checkHousingEdit({ due_month: 11 }, stored, MARCH)).toEqual({
      ok: true,
      value: { due_date: '11-05' },
    })
  })

  it("gives a row without a due date one, from the person's month and the 1st", () => {
    const undated = { ...stored, due_date: '' }
    expect(checkHousingEdit({ due_day: 9 }, undated, MARCH)).toEqual({
      ok: true,
      value: { due_date: '03-09' },
    })
    expect(checkHousingEdit({ due_month: 3 }, undated, MARCH)).toEqual({
      ok: true,
      value: { due_date: '03-01' },
    })
    expect(checkHousingEdit({ due_month: '', due_day: '' }, undated, MARCH)).toEqual({
      ok: true,
      value: {},
    })
  })

  it('refuses a due date the month does not have, whichever of the two changes', () => {
    const lastOfJanuary = { ...stored, due_date: '01-31' }
    expect(checkHousingEdit({ due_month: 4 }, lastOfJanuary, MARCH)).toEqual({
      ok: false,
      fields: { due_day: 'April has no 31st. Enter a day from 1 to 30.' },
    })
    expect(checkHousingEdit({ due_day: 31 }, stored, MARCH)).toEqual({
      ok: false,
      fields: { due_day: 'April has no 31st. Enter a day from 1 to 30.' },
    })
    expect(checkHousingEdit({ due_day: 31, monthly_amount: 0 }, stored, MARCH)).toEqual({
      ok: false,
      fields: {
        monthly_amount: M.amountPositive,
        due_day: 'April has no 31st. Enter a day from 1 to 30.',
      },
    })
    expect(checkHousingEdit({ due_month: 2, due_day: 29 }, stored, MARCH)).toEqual({
      ok: true,
      value: { due_date: '02-29' },
    })
    // A date an older version stored is sent back as it was, so it is not checked.
    expect(
      checkHousingEdit(
        { ...FORM, due_month: 2, due_day: 30, notes: 'New' },
        { ...stored, due_date: '02-30' },
        MARCH
      )
    ).toEqual({ ok: true, value: { notes: 'New' } })
  })

  it('checks a changed field like a new expense', () => {
    expect(checkHousingEdit({ property_name: ' ', monthly_amount: 0 }, stored, MARCH)).toEqual({
      ok: false,
      fields: { property_name: M.name, monthly_amount: M.amountPositive },
    })
  })

  it('takes back what an older version stored', () => {
    const older = { ...stored, name: 'y'.repeat(120), monthly_amount: 10.555 }
    expect(
      checkHousingEdit(
        { ...FORM, property_name: 'y'.repeat(120), monthly_amount: 10.555, notes: 'New' },
        older,
        MARCH
      )
    ).toEqual({ ok: true, value: { notes: 'New' } })
  })
})

describe('a listed row', () => {
  it('is its columns, with autopay as true or false, whichever runtime stored it', () => {
    const local = {
      id: 4,
      profile_id: 1,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: 1,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
      property_name: 'Flat',
      due_day: 5,
      due_month: 4,
    }
    expect(housingAnswer(local)).toEqual({
      id: 4,
      profile_id: 1,
      name: 'Flat',
      type: 'rent',
      monthly_amount: 850.5,
      due_date: '04-05',
      autopay: true,
      notes: '',
      created_at: '2026-01-01T00:00:00.000Z',
    })
    expect(housingAnswer({ ...local, autopay: 0 }).autopay).toBe(false)
    expect(housingAnswer({ ...local, autopay: false }).autopay).toBe(false)
  })
})
