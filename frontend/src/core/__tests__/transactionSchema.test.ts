/**
 * The transaction rules both runtimes run (shared/transactionSchema.ts). The route and handler
 * tests prove each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import { refusalOf } from '../../../../shared/refusal'
import {
  checkTransactionCreate,
  checkTransactionEdit,
  checkTransactionFields,
  hasCents,
  isCalendarDate,
  TRANSACTION_MESSAGES as M,
  transactionMoneyProblems,
} from '../../../../shared/transactionSchema'

const DEFAULTS = { today: '2026-10-08', currency: 'EUR' }

const create = (body: unknown) => checkTransactionCreate(body, DEFAULTS)
const edit = (body: unknown, stored: object) => checkTransactionEdit(body, stored, DEFAULTS)

/** The field messages of a refused check, `{}` when it passed. */
const refused = (checked: ReturnType<typeof create> | ReturnType<typeof edit>) =>
  checked.ok ? {} : checked.fields

describe('a new transaction', () => {
  it('needs a type and an amount; every other field takes its default', () => {
    expect(create({ type: 'expense', amount: 12.5 })).toEqual({
      ok: true,
      value: {
        type: 'expense',
        description: '',
        amount: 12.5,
        currency: 'EUR',
        date: '2026-10-08',
        category_id: null,
        transfer_account_id: null,
        account_id: null,
        beneficiary: '',
        payor: '',
        amount_local: null,
        exchange_rate: 1,
        notes: '',
        means_of_payment: '',
      },
    })
  })

  it('treats blank optional fields as left out', () => {
    const checked = create({
      type: 'income',
      amount: 3000,
      description: '   ',
      date: '',
      currency: ' ',
      category_id: '',
      account_id: null,
      amount_local: '',
      exchange_rate: '',
      notes: null,
    })
    expect(checked.ok && checked.value).toMatchObject({
      description: '',
      date: '2026-10-08',
      currency: 'EUR',
      category_id: null,
      account_id: null,
      amount_local: null,
      exchange_rate: 1,
      notes: '',
    })
  })

  it('reads numbers and ids sent as text, and trims what is written', () => {
    const checked = create({
      type: ' Expense ',
      amount: '12.50',
      description: '  Weekly groceries ',
      currency: 'usd',
      category_id: '7',
      account_id: '3',
      amount_local: '11.40',
      exchange_rate: '0.912',
      beneficiary: ' Market ',
    })
    expect(checked.ok && checked.value).toMatchObject({
      type: 'expense',
      amount: 12.5,
      description: 'Weekly groceries',
      currency: 'USD',
      category_id: 7,
      account_id: 3,
      amount_local: 11.4,
      exchange_rate: 0.912,
      beneficiary: 'Market',
    })
  })

  it('drops keys that are not transaction fields, a reconciled flag among them', () => {
    const checked = create({ type: 'expense', amount: 5, id: 9, profile_id: 2, reconciled: 1 })
    expect(checked.ok && Object.keys(checked.value)).not.toContain('reconciled')
    expect(checked.ok && checked.value).not.toHaveProperty('id')
    expect(checked.ok && checked.value).not.toHaveProperty('profile_id')
  })

  it('accepts a deduction, which the Worker and the balance rules always did', () => {
    expect(create({ type: 'deduction', amount: 40 }).ok).toBe(true)
  })

  it('refuses a type it does not know, or none', () => {
    expect(refused(create({ amount: 5 }))).toEqual({ type: M.type })
    expect(refused(create({ type: 'refund', amount: 5 }))).toEqual({ type: M.type })
    expect(refused(create({ type: 7, amount: 5 }))).toEqual({ type: M.type })
  })

  it.each([
    [undefined, M.amount],
    ['  ', M.amount],
    ['abc', M.amountNumber],
    [true, M.amountNumber],
    [0, M.amountPositive],
    [-12.5, M.amountPositive],
    [12.345, M.amountCents],
    [0.1 + 0.2, M.amountCents],
    [1e12, M.amountMax],
  ])('refuses an amount of %s: %s', (amount, message) => {
    expect(refused(create({ type: 'expense', amount }))).toEqual({ amount: message })
  })

  it.each([0.29, 1.1, 0.07, 99999999.99])('accepts an amount of %s', (amount) => {
    expect(create({ type: 'expense', amount }).ok).toBe(true)
  })

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-5', '2026-10-08T09:00:00Z', 'today'])(
    'refuses the date %s',
    (date) => {
      expect(refused(create({ type: 'expense', amount: 5, date }))).toEqual({ date: M.date })
    }
  )

  it('accepts a leap day in a leap year', () => {
    expect(create({ type: 'expense', amount: 5, date: '2024-02-29' }).ok).toBe(true)
  })

  it('refuses a currency that is not a three-letter code', () => {
    expect(refused(create({ type: 'expense', amount: 5, currency: 'euro' }))).toEqual({
      currency: M.currency,
    })
    expect(refused(create({ type: 'expense', amount: 5, currency: 978 }))).toEqual({
      currency: M.currency,
    })
  })

  it.each([0, -1, 1.5, 'abc', true])('refuses %s as an id, at the field it is', (id) => {
    expect(refused(create({ type: 'expense', amount: 5, category_id: id }))).toEqual({
      category_id: M.category,
    })
    expect(refused(create({ type: 'expense', amount: 5, account_id: id }))).toEqual({
      account_id: M.account,
    })
    expect(
      refused(create({ type: 'transfer', amount: 5, account_id: 1, transfer_account_id: id }))
    ).toEqual({ transfer_account_id: M.account })
  })

  it('refuses a local amount or an exchange rate that is not more than zero', () => {
    expect(refused(create({ type: 'expense', amount: 5, amount_local: 0 }))).toEqual({
      amount_local: M.amountLocal,
    })
    expect(refused(create({ type: 'expense', amount: 5, amount_local: 'x' }))).toEqual({
      amount_local: M.amountLocal,
    })
    expect(refused(create({ type: 'expense', amount: 5, exchange_rate: 0 }))).toEqual({
      exchange_rate: M.exchangeRate,
    })
    expect(refused(create({ type: 'expense', amount: 5, exchange_rate: -1 }))).toEqual({
      exchange_rate: M.exchangeRate,
    })
  })

  it('refuses text fields that are not text', () => {
    expect(
      refused(
        create({
          type: 'expense',
          amount: 5,
          description: 5,
          beneficiary: {},
          payor: [],
          notes: false,
          means_of_payment: 3,
        })
      )
    ).toEqual({
      description: M.description,
      beneficiary: M.beneficiary,
      payor: M.payor,
      notes: M.notes,
      means_of_payment: M.meansOfPayment,
    })
  })

  it('refuses a body that is not an object for its type and amount', () => {
    expect(refused(create(null))).toEqual({ type: M.type, amount: M.amount })
    expect(refused(create([1, 2]))).toEqual({ type: M.type, amount: M.amount })
  })

  describe('a transfer', () => {
    it('needs the account the money leaves and the one it goes to', () => {
      expect(refused(create({ type: 'transfer', amount: 50 }))).toEqual({
        account_id: M.transferFrom,
        transfer_account_id: M.transferTo,
      })
      expect(refused(create({ type: 'transfer', amount: 50, account_id: 1 }))).toEqual({
        transfer_account_id: M.transferTo,
      })
      expect(refused(create({ type: 'transfer', amount: 50, transfer_account_id: 2 }))).toEqual({
        account_id: M.transferFrom,
      })
    })

    it('needs two different accounts', () => {
      expect(
        refused(create({ type: 'transfer', amount: 50, account_id: 4, transfer_account_id: '4' }))
      ).toEqual({ transfer_account_id: M.transferSame })
    })

    it('is marked with every other problem at once', () => {
      expect(refused(create({ type: 'transfer', amount: '', account_id: 4 }))).toEqual({
        amount: M.amount,
        transfer_account_id: M.transferTo,
      })
    })

    it('saves with two accounts', () => {
      const checked = create({
        type: 'transfer',
        amount: 50,
        account_id: 4,
        transfer_account_id: 5,
      })
      expect(checked.ok && checked.value).toMatchObject({ account_id: 4, transfer_account_id: 5 })
    })
  })

  it('says every problem in the summary, in the order the form shows the fields', () => {
    const checked = create({ type: 'expense', amount: 0, date: 'soon', currency: 'x' })
    expect(refusalOf(refused(checked)).error).toBe(`${M.amountPositive} ${M.currency} ${M.date}`)
  })
})

describe('each field on its own, as the Worker reads a body before it resolves accounts', () => {
  it('lets a transfer through without its accounts, for the whole-row check to judge', () => {
    expect(checkTransactionFields({ type: 'transfer', amount: 50 }, DEFAULTS).ok).toBe(true)
    expect(transactionMoneyProblems({ type: 'transfer', amount: 50, account_id: 3 })).toEqual({
      transfer_account_id: M.transferTo,
    })
  })

  it('still refuses a field that is wrong on its own', () => {
    expect(checkTransactionFields({ type: 'transfer', amount: -1 }, DEFAULTS)).toEqual({
      ok: false,
      fields: { amount: M.amountPositive },
    })
  })
})

describe('the whole-row money rules', () => {
  it('pass a row that moves money the way the balances can follow', () => {
    expect(transactionMoneyProblems({ type: 'expense', amount: 5, account_id: 1 })).toEqual({})
    expect(transactionMoneyProblems({ type: 'deduction', amount: '5' })).toEqual({})
  })

  it('name the field each problem is at', () => {
    expect(
      transactionMoneyProblems({ type: 'payment', amount: 0, amount_local: -2, account_id: 1 })
    ).toEqual({ type: M.type, amount: M.amountPositive, amount_local: M.amountLocal })
  })
})

const STORED = {
  id: 41,
  profile_id: 1,
  type: 'expense',
  description: 'Weekly groceries',
  amount: 82.4,
  currency: 'EUR',
  date: '2026-10-01',
  category_id: 7,
  transfer_account_id: null,
  account_id: 3,
  beneficiary: 'Market',
  payor: '',
  amount_local: 82.4,
  exchange_rate: 1,
  notes: '',
  means_of_payment: '',
  reconciled: 0,
  created_at: '2026-10-01 09:00:00',
}

/** What the Transactions form sends on every save: every field, as it reads them. */
const sentBack = (row: Record<string, unknown>, change: Record<string, unknown> = {}) => ({
  type: row.type,
  description: row.description,
  amount: String(row.amount),
  currency: row.currency,
  date: row.date,
  category_id: row.category_id,
  transfer_account_id: row.transfer_account_id,
  account_id: row.account_id,
  beneficiary: row.beneficiary,
  payor: row.payor,
  exchange_rate: String(row.exchange_rate),
  notes: row.notes,
  means_of_payment: row.means_of_payment,
  ...change,
})

describe('an edit', () => {
  it('returns only the fields it changes', () => {
    expect(edit(sentBack(STORED, { description: 'Groceries' }), STORED)).toEqual({
      ok: true,
      value: { description: 'Groceries' },
    })
  })

  it('changes nothing when every field is sent back as stored, written as the form writes it', () => {
    expect(edit(sentBack(STORED), STORED)).toEqual({ ok: true, value: {} })
    expect(
      edit(
        { amount: '82.40', account_id: '3', description: ' Weekly groceries ', type: 'Expense' },
        STORED
      )
    ).toEqual({ ok: true, value: {} })
  })

  it('leaves a field out of the body alone, and drops keys that are not fields', () => {
    expect(edit({ notes: 'Split with Ana', tags: [1], id: 99 }, STORED)).toEqual({
      ok: true,
      value: { notes: 'Split with Ana' },
    })
  })

  it('takes the default for a field it blanks', () => {
    const stored = { ...STORED, exchange_rate: 0.92, notes: 'From the market' }
    expect(edit({ exchange_rate: '', notes: '', date: ' ' }, stored)).toEqual({
      ok: true,
      value: { exchange_rate: 1, notes: '', date: '2026-10-08' },
    })
  })

  it('checks what it changes, as a new transaction is checked', () => {
    expect(edit({ amount: '12.345', date: '2026-02-30' }, STORED)).toEqual({
      ok: false,
      fields: { amount: M.amountCents, date: M.date },
    })
    expect(edit({ category_id: 0 }, STORED)).toEqual({
      ok: false,
      fields: { category_id: M.category },
    })
  })

  it('says what is wrong with a field and with the row it leaves behind at once', () => {
    expect(edit({ type: 'transfer', amount: '' }, STORED)).toEqual({
      ok: false,
      fields: { amount: M.amount, transfer_account_id: M.transferTo },
    })
  })

  it('sets and clears the reconciled flag, which a new transaction cannot', () => {
    expect(edit({ reconciled: 'true' }, STORED)).toEqual({ ok: true, value: { reconciled: 1 } })
    expect(edit({ reconciled: false }, { ...STORED, reconciled: 1 })).toEqual({
      ok: true,
      value: { reconciled: 0 },
    })
    expect(edit({ reconciled: 'maybe' }, STORED)).toEqual({
      ok: false,
      fields: { reconciled: M.reconciled },
    })
  })

  describe('of a row saved under older rules', () => {
    // Values these rules refuse on a create, which older versions, imports or the other runtime
    // stored. Each is sent back unchanged with the description changed, as the form sends it.
    it.each([
      ['an amount with three decimals', { amount: 12.345 }],
      ['a date that is not YYYY-MM-DD', { date: '2026-1-5' }],
      ['a currency that is not a code', { currency: 'euro' }],
      ['a type the form does not offer', { type: 'deduction' }],
      ['a blank description', { description: '' }],
      ['a transfer without a destination', { type: 'transfer', transfer_account_id: null }],
    ])('saves a description change to one with %s', (_, old) => {
      const stored = { ...STORED, ...old }
      expect(edit(sentBack(stored, { description: 'Market run' }), stored)).toEqual({
        ok: true,
        value: { description: 'Market run' },
      })
    })

    it('compares a number the rules refuse as the number it is', () => {
      const stored = { ...STORED, amount: 12.345 }
      expect(edit({ amount: '12.345', notes: 'x' }, stored)).toEqual({
        ok: true,
        value: { notes: 'x' },
      })
    })

    it('still refuses a changed value the rules refuse', () => {
      const stored = { ...STORED, amount: 12.345 }
      expect(edit({ amount: 12.346 }, stored)).toEqual({
        ok: false,
        fields: { amount: M.amountCents },
      })
    })
  })

  describe('that changes how the row moves money', () => {
    const TRANSFER = { ...STORED, type: 'transfer', category_id: null, transfer_account_id: 5 }

    it('checks the row it leaves behind, the unchanged fields included', () => {
      const stored = { ...TRANSFER, transfer_account_id: null }
      expect(edit({ amount: 90 }, stored)).toEqual({
        ok: false,
        fields: { transfer_account_id: M.transferTo },
      })
      expect(edit({ type: 'transfer' }, STORED)).toEqual({
        ok: false,
        fields: { transfer_account_id: M.transferTo },
      })
      expect(edit({ transfer_account_id: 3 }, TRANSFER)).toEqual({
        ok: false,
        fields: { transfer_account_id: M.transferSame },
      })
    })

    it('saves when that row is whole', () => {
      expect(edit({ type: 'transfer', transfer_account_id: 5 }, STORED)).toEqual({
        ok: true,
        value: { type: 'transfer', transfer_account_id: 5 },
      })
    })

    it('drops the destination of a transfer made into anything else', () => {
      expect(edit(sentBack(TRANSFER, { type: 'expense' }), TRANSFER)).toEqual({
        ok: true,
        value: { type: 'expense', transfer_account_id: null },
      })
    })

    it('keeps a destination the edit itself sends', () => {
      expect(edit({ type: 'income', transfer_account_id: 6 }, TRANSFER)).toEqual({
        ok: true,
        value: { type: 'income', transfer_account_id: 6 },
      })
    })

    it('leaves out a stored local amount that a new amount replaces', () => {
      // The local amount moves with a new amount in both runtimes, so a broken stored one does
      // not stand in the way of the edit that replaces it.
      const stored = { ...STORED, amount_local: 0 }
      expect(edit({ amount: 90 }, stored)).toEqual({ ok: true, value: { amount: 90 } })
      expect(edit({ type: 'income' }, stored)).toEqual({
        ok: false,
        fields: { amount_local: M.amountLocal },
      })
    })

    it('clears the local amount when it is sent blank', () => {
      expect(edit({ amount_local: '' }, STORED)).toEqual({
        ok: true,
        value: { amount_local: null },
      })
    })
  })
})

describe('the helpers', () => {
  it('tell a date that exists', () => {
    expect(isCalendarDate('2026-10-08')).toBe(true)
    expect(isCalendarDate('0099-02-28')).toBe(true)
    expect(isCalendarDate('2100-02-29')).toBe(false)
    expect(isCalendarDate('2026-10-8')).toBe(false)
  })

  it('tell an amount in cents', () => {
    expect(hasCents(12.5)).toBe(true)
    expect(hasCents(0.07)).toBe(true)
    expect(hasCents(12.501)).toBe(false)
  })
})
