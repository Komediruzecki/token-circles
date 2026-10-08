/**
 * The bill rules both runtimes run (shared/billSchema.ts). The route and handler tests prove each
 * runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import { BILL_MESSAGES as M, checkBillCreate, checkBillEdit } from '../../../../shared/billSchema'
import { refusalOf } from '../../../../shared/refusal'
import type { Checked } from '../../../../shared/refusal'

const refused = (checked: Checked<unknown>) => (checked.ok ? {} : checked.fields)
const BILL = { name: 'Power', amount: 60, dueDate: '2026-10-15' }

describe('a new bill', () => {
  it('needs a name, an amount and a due date; the rest take their defaults', () => {
    expect(checkBillCreate(BILL)).toEqual({
      ok: true,
      value: {
        name: 'Power',
        amount: 60,
        due_date: '2026-10-15',
        frequency: 'monthly',
        day_of_month: null,
        category_id: null,
        account_id: null,
        notes: '',
        type: 'bill',
        autopay: false,
      },
    })
  })

  it('reads what the Bills form and the subscription dialogs send, and drops the rest', () => {
    expect(
      checkBillCreate({
        name: ' Streaming ',
        amount: '12.99',
        dueDate: '2026-10-03',
        category_id: '7',
        account_id: 2,
        frequency: 'Yearly',
        autopay: true,
        type: 'subscription',
        day_of_month: '3',
        notes: ' family plan ',
        paid: true,
        profile_id: 99,
      })
    ).toEqual({
      ok: true,
      value: {
        name: 'Streaming',
        amount: 12.99,
        due_date: '2026-10-03',
        frequency: 'yearly',
        day_of_month: 3,
        category_id: 7,
        account_id: 2,
        notes: 'family plan',
        type: 'subscription',
        autopay: true,
      },
    })
  })

  it('reads `due_date` before `dueDate`', () => {
    const checked = checkBillCreate({ ...BILL, due_date: '2026-11-01' })
    expect(checked.ok && checked.value.due_date).toBe('2026-11-01')
  })

  it('says what is wrong with the name', () => {
    expect(refused(checkBillCreate({ ...BILL, name: '' }))).toEqual({ name: M.name })
    expect(refused(checkBillCreate({ ...BILL, name: 'b'.repeat(101) }))).toEqual({
      name: M.nameLength,
    })
  })

  it('says what is wrong with the amount', () => {
    const amount = (value: unknown) => refused(checkBillCreate({ ...BILL, amount: value })).amount
    expect(amount(undefined)).toBe(M.amount)
    expect(amount('ten')).toBe(M.amountNumber)
    expect(amount(0)).toBe(M.amountPositive)
    expect(amount(-3)).toBe(M.amountPositive)
    expect(amount(9.999)).toBe(M.amountCents)
    expect(amount(1e12)).toBe(M.amountMax)
  })

  it('says what is wrong with the due date', () => {
    const due = (value: unknown) => refused(checkBillCreate({ ...BILL, dueDate: value })).due_date
    expect(due(undefined)).toBe(M.dueDate)
    expect(due('')).toBe(M.dueDate)
    expect(due('2026-02-30')).toBe(M.dueDateReal)
    expect(due('15/10/2026')).toBe(M.dueDateReal)
  })

  it('takes the four frequencies the form offers', () => {
    for (const frequency of ['weekly', 'biweekly', 'monthly', 'yearly']) {
      expect(checkBillCreate({ ...BILL, frequency }).ok).toBe(true)
    }
    for (const frequency of ['daily', 'quarterly', 7]) {
      expect(refused(checkBillCreate({ ...BILL, frequency }))).toEqual({ frequency: M.frequency })
    }
  })

  it('says what is wrong with the other fields', () => {
    expect(
      refused(
        checkBillCreate({
          ...BILL,
          day_of_month: 32,
          category_id: 'rent',
          account_id: -1,
          type: 'loan',
          autopay: 'sometimes',
          notes: ['a'],
        })
      )
    ).toEqual({
      day_of_month: M.dayOfMonth,
      category_id: M.category,
      account_id: M.account,
      type: M.type,
      autopay: M.autopay,
      notes: M.notes,
    })
  })

  it('sums every message up for a client that cannot place them', () => {
    expect(refusalOf(refused(checkBillCreate({})))).toEqual({
      error: `${M.name} ${M.amount} ${M.dueDate}`,
      fields: { name: M.name, amount: M.amount, due_date: M.dueDate },
    })
  })
})

describe('an edit of a bill', () => {
  const STORED = {
    id: 5,
    name: 'Power',
    amount: 60,
    frequency: 'monthly',
    day_of_month: null,
    category_id: 7,
    account_id: null,
    due_date: '2026-10-15',
    is_active: 1,
    notes: '',
    type: 'bill',
    autopay: 0,
  }

  it('changes only what it sends', () => {
    expect(checkBillEdit({ amount: '65.50' }, STORED)).toEqual({
      ok: true,
      value: { amount: 65.5 },
    })
  })

  it('writes nothing the Bills form sends back unchanged', () => {
    expect(
      checkBillEdit(
        {
          name: 'Power',
          amount: 60,
          dueDate: '2026-10-15',
          category_id: 7,
          frequency: 'monthly',
          autopay: false,
          type: 'bill',
        },
        STORED
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('pauses and resumes a bill', () => {
    expect(checkBillEdit({ is_active: false }, STORED)).toEqual({
      ok: true,
      value: { is_active: false },
    })
    expect(checkBillEdit({ is_active: 1 }, STORED)).toEqual({ ok: true, value: {} })
  })

  it('leaves alone what an older version stored, while it is sent back as it was', () => {
    const old = { ...STORED, amount: 0, frequency: 'daily', day_of_month: 1 }
    expect(checkBillEdit({ amount: 0, frequency: 'daily', name: 'Electricity' }, old)).toEqual({
      ok: true,
      value: { name: 'Electricity' },
    })
    expect(refused(checkBillEdit({ amount: -1 }, old))).toEqual({ amount: M.amountPositive })
  })

  it('cannot blank the name, the amount or the due date', () => {
    expect(refused(checkBillEdit({ name: ' ', amount: null, dueDate: '' }, STORED))).toEqual({
      name: M.name,
      amount: M.amount,
      due_date: M.dueDate,
    })
  })

  it('takes the category and the account away when sent blank', () => {
    expect(checkBillEdit({ category_id: null, account_id: '' }, STORED)).toEqual({
      ok: true,
      value: { category_id: null },
    })
  })
})
