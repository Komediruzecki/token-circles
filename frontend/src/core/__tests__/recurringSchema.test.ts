/**
 * The recurring rule checks both runtimes run (shared/recurringSchema.ts). The route and handler
 * tests prove each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  checkRecurringCreate,
  checkRecurringEdit,
  RECURRING_MESSAGES as M,
  recurringIsActive,
} from '../../../../shared/recurringSchema'
import { refusalOf } from '../../../../shared/refusal'

/** What the Recurring form posts. */
const FORM = {
  description: 'Rent',
  amount: 850.5,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-03-01',
  account_id: 3,
  transfer_account_id: null,
  category_id: 7,
  notes: 'Flat 4',
}

const RULE = {
  description: 'Rent',
  amount: 850.5,
  type: 'expense',
  frequency: 'monthly',
  day_of_month: 1,
  next_date: '2026-03-01',
  account_id: 3,
  transfer_account_id: null,
  category_id: 7,
  notes: 'Flat 4',
}

describe('a new recurring rule', () => {
  it("is the form's fields, read and trimmed, and nothing else", () => {
    expect(
      checkRecurringCreate({ ...FORM, description: ' Rent ', id: 9, active: 0, profile_id: 2 })
    ).toEqual({ ok: true, value: RULE })
  })

  it('fills in what a body leaves out: an expense, monthly, no day, no links, no notes', () => {
    expect(
      checkRecurringCreate({ description: 'Gym', amount: '30', next_date: '2026-03-05' })
    ).toEqual({
      ok: true,
      value: {
        description: 'Gym',
        amount: 30,
        type: 'expense',
        frequency: 'monthly',
        day_of_month: null,
        next_date: '2026-03-05',
        account_id: null,
        transfer_account_id: null,
        category_id: null,
        notes: '',
      },
    })
  })

  it('stores no day of the month when the form leaves it blank, and reads the day alias', () => {
    const day = (body: Record<string, unknown>) => {
      const checked = checkRecurringCreate({ ...FORM, ...body })
      return checked.ok ? checked.value.day_of_month : checked.fields
    }
    expect(day({ day_of_month: null })).toBeNull()
    expect(day({ day_of_month: '' })).toBeNull()
    expect(day({ day_of_month: '15' })).toBe(15)
    expect(day({ day_of_month: undefined, day: 20 })).toBe(20)
  })

  it('needs a description, an amount and a next date, and says so at each field', () => {
    expect(checkRecurringCreate({})).toEqual({
      ok: false,
      fields: { description: M.description, amount: M.amount, next_date: M.nextDate },
    })
    expect(checkRecurringCreate({ ...FORM, description: '  ', amount: '', next_date: '' })).toEqual(
      {
        ok: false,
        fields: { description: M.description, amount: M.amount, next_date: M.nextDate },
      }
    )
  })

  it('refuses an amount that is not a number, is zero or less, is past the cent or too large', () => {
    const amount = (value: unknown) => checkRecurringCreate({ ...FORM, amount: value })
    expect(amount('lots')).toEqual({ ok: false, fields: { amount: M.amountNumber } })
    expect(amount(0)).toEqual({ ok: false, fields: { amount: M.amountPositive } })
    expect(amount(-5)).toEqual({ ok: false, fields: { amount: M.amountPositive } })
    expect(amount(10.555)).toEqual({ ok: false, fields: { amount: M.amountCents } })
    expect(amount(1e12)).toEqual({ ok: false, fields: { amount: M.amountMax } })
  })

  it('takes the types and frequencies the form offers, and refuses any other', () => {
    expect(checkRecurringCreate({ ...FORM, type: 'Income' })).toMatchObject({
      ok: true,
      value: { type: 'income' },
    })
    expect(checkRecurringCreate({ ...FORM, type: 'deduction', frequency: 'biweekly' })).toEqual({
      ok: false,
      fields: {
        type: 'Choose Expense, Income or Transfer.',
        frequency: 'Choose Daily, Weekly, Monthly or Yearly.',
      },
    })
    for (const frequency of ['daily', 'weekly', 'monthly', 'yearly']) {
      expect(checkRecurringCreate({ ...FORM, frequency })).toMatchObject({ ok: true })
    }
  })

  it('refuses a day of the month that is not one, and a next date that is not a real date', () => {
    for (const day_of_month of [0, 32, 2.5, 'first']) {
      expect(checkRecurringCreate({ ...FORM, day_of_month })).toEqual({
        ok: false,
        fields: { day_of_month: 'Enter a day of the month from 1 to 31, or leave it blank.' },
      })
    }
    for (const next_date of ['1 May', '2026-02-30', 20260301]) {
      expect(checkRecurringCreate({ ...FORM, next_date })).toEqual({
        ok: false,
        fields: { next_date: 'Enter a real date, written like 2026-03-31.' },
      })
    }
  })

  it('refuses a category or an account that is not an id, in the words for each', () => {
    expect(
      checkRecurringCreate({ ...FORM, category_id: 0, account_id: 'savings', notes: 5 })
    ).toEqual({
      ok: false,
      fields: { account_id: M.account, category_id: M.category, notes: M.notes },
    })
  })

  it('needs a transfer to come from one account and go to another', () => {
    const transfer = (body: Record<string, unknown>) =>
      checkRecurringCreate({ ...FORM, type: 'transfer', ...body })
    expect(transfer({ account_id: null, transfer_account_id: null })).toEqual({
      ok: false,
      fields: {
        account_id: 'Choose the account the money comes from.',
        transfer_account_id: 'Choose the account the money goes to.',
      },
    })
    expect(transfer({ transfer_account_id: 3 })).toEqual({
      ok: false,
      fields: {
        transfer_account_id: 'Choose a different account from the one the money comes from.',
      },
    })
    expect(transfer({ transfer_account_id: 'x' })).toEqual({
      ok: false,
      fields: { transfer_account_id: 'Choose one of your accounts from the list.' },
    })
    expect(transfer({ transfer_account_id: 4 })).toMatchObject({
      ok: true,
      value: { type: 'transfer', account_id: 3, transfer_account_id: 4 },
    })
  })

  it('sends a rule that is not a transfer to no account', () => {
    expect(checkRecurringCreate({ ...FORM, transfer_account_id: 4 })).toMatchObject({
      ok: true,
      value: { transfer_account_id: null },
    })
  })

  it('answers the refusal both runtimes send', () => {
    const checked = checkRecurringCreate({ ...FORM, description: '', amount: 0 })
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(refusalOf(checked.fields)).toEqual({
      error: `${M.description} ${M.amountPositive}`,
      fields: { description: M.description, amount: M.amountPositive },
    })
  })
})

describe('an edit', () => {
  const stored = { id: 4, profile_id: 1, ...RULE, active: 1 }

  it('changes only what it changes', () => {
    expect(checkRecurringEdit({ amount: 900, notes: 'Flat 5' }, stored)).toEqual({
      ok: true,
      value: { amount: 900, notes: 'Flat 5' },
    })
  })

  it('writes nothing it is sent back unchanged, however it is written', () => {
    expect(
      checkRecurringEdit(
        { ...FORM, amount: '850.50', frequency: 'Monthly', day_of_month: '1', account_id: '3' },
        stored
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('checks a changed field like a new rule', () => {
    expect(
      checkRecurringEdit({ ...FORM, description: ' ', next_date: 'soon', amount: 0 }, stored)
    ).toEqual({
      ok: false,
      fields: { description: M.description, amount: M.amountPositive, next_date: M.nextDateReal },
    })
  })

  it('takes back what an older version stored', () => {
    const older = {
      ...stored,
      description: '',
      amount: 10.555,
      type: 'deduction',
      frequency: 'biweekly',
      next_date: null,
    }
    expect(
      checkRecurringEdit(
        {
          ...FORM,
          description: '',
          amount: 10.555,
          type: 'deduction',
          frequency: 'biweekly',
          next_date: null,
          notes: 'New',
        },
        older
      )
    ).toEqual({ ok: true, value: { notes: 'New' } })
  })

  it('checks the accounts of a rule made into a transfer, and clears them out of one', () => {
    expect(checkRecurringEdit({ type: 'transfer' }, stored)).toEqual({
      ok: false,
      fields: { transfer_account_id: M.transferTo },
    })
    expect(checkRecurringEdit({ type: 'transfer', transfer_account_id: 4 }, stored)).toEqual({
      ok: true,
      value: { type: 'transfer', transfer_account_id: 4 },
    })
    const transfer = { ...stored, type: 'transfer', transfer_account_id: 4 }
    expect(checkRecurringEdit({ account_id: 4 }, transfer)).toEqual({
      ok: false,
      fields: { transfer_account_id: M.transferSame },
    })
    expect(checkRecurringEdit({ type: 'expense' }, transfer)).toEqual({
      ok: true,
      value: { type: 'expense', transfer_account_id: null },
    })
  })

  it('leaves the accounts of an older transfer alone when the edit does not touch them', () => {
    const halfTransfer = { ...stored, type: 'transfer', account_id: null }
    // The form sends the rule's own values back, with the notes changed.
    expect(
      checkRecurringEdit({ ...FORM, type: 'transfer', account_id: null, notes: 'x' }, halfTransfer)
    ).toEqual({ ok: true, value: { notes: 'x' } })
    // An edit that touches an account checks the whole transfer.
    expect(checkRecurringEdit({ account_id: 3 }, halfTransfer)).toEqual({
      ok: false,
      fields: { transfer_account_id: M.transferTo },
    })
  })

  it('pauses a rule with active, or with is_active as local-first named it', () => {
    expect(checkRecurringEdit({ active: 0 }, stored)).toEqual({
      ok: true,
      value: { active: false },
    })
    expect(checkRecurringEdit({ is_active: false }, stored)).toEqual({
      ok: true,
      value: { active: false },
    })
    expect(checkRecurringEdit({ active: 'maybe' }, stored)).toEqual({
      ok: false,
      fields: { active: M.active },
    })
    // A rule an older local-first version paused with is_active is paused already.
    expect(checkRecurringEdit({ active: false }, { ...RULE, is_active: 0 })).toEqual({
      ok: true,
      value: {},
    })
  })
})

describe('whether a rule is active', () => {
  it('reads active, or is_active on a rule an older local-first version stored', () => {
    expect(recurringIsActive({ active: 1 })).toBe(true)
    expect(recurringIsActive({ active: 0 })).toBe(false)
    expect(recurringIsActive({ is_active: 0 })).toBe(false)
    expect(recurringIsActive({ is_active: false })).toBe(false)
    expect(recurringIsActive({ active: 1, is_active: 0 })).toBe(true)
    expect(recurringIsActive({})).toBe(true)
  })
})
