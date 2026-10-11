/**
 * The account rules both runtimes run (shared/accountSchema.ts). The route and handler tests prove
 * each runtime uses them; these pin the rules and the words themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_MESSAGES as M,
  ACCOUNT_TYPE_WORDS,
  ACCOUNT_TYPES,
  checkAccountCreate,
  checkAccountEdit,
  readAccountType,
  storedAccountType,
  takesCreditLine,
} from '../../../../shared/accountSchema'
import { refusalOf } from '../../../../shared/refusal'

/** The field messages of a refused check, `{}` when it passed. */
const refused = (
  checked: ReturnType<typeof checkAccountCreate> | ReturnType<typeof checkAccountEdit>
) => (checked.ok ? {} : checked.fields)

describe('a new account', () => {
  it('needs a name; every other field takes its default', () => {
    expect(checkAccountCreate({ name: 'Everyday' })).toEqual({
      ok: true,
      value: {
        name: 'Everyday',
        type: 'giro',
        bank_name: '',
        starting_balance: 0,
        starting_date: null,
        balance: 0,
        currency: null,
        notes: '',
        credit_limit: null,
        credit_rate: null,
      },
    })
  })

  it('reads every field the form sends, trimmed, and drops the rest', () => {
    expect(
      checkAccountCreate({
        name: '  Holiday fund ',
        type: 'Savings',
        bank_name: ' Credit Union ',
        starting_balance: '1250.50',
        starting_date: '2026-01-31',
        balance: 1250.5,
        notes: 'For the summer',
        currency: ' eur',
        profile_id: 9,
        current_balance: 4,
      })
    ).toEqual({
      ok: true,
      value: {
        name: 'Holiday fund',
        type: 'savings',
        bank_name: 'Credit Union',
        starting_balance: 1250.5,
        starting_date: '2026-01-31',
        balance: 1250.5,
        currency: 'EUR',
        notes: 'For the summer',
        credit_limit: null,
        credit_rate: null,
      },
    })
  })

  it('opens at its starting balance, or at the balance when only that is given', () => {
    const opened = (body: object) => {
      const checked = checkAccountCreate({ name: 'Card', ...body })
      return checked.ok ? [checked.value.starting_balance, checked.value.balance] : checked.fields
    }
    expect(opened({ starting_balance: 1000, balance: 1200 })).toEqual([1000, 1000])
    expect(opened({ balance: -80.25 })).toEqual([-80.25, -80.25])
    expect(opened({ starting_balance: '', balance: '300' })).toEqual([300, 300])
    expect(opened({})).toEqual([0, 0])
  })

  it('reads the type names older versions stored as the ones that replaced them', () => {
    const typeOf = (type: unknown) => {
      const checked = checkAccountCreate({ name: 'Old', type })
      return checked.ok ? checked.value.type : checked.fields
    }
    expect(typeOf('checking')).toBe('giro')
    expect(typeOf('investment')).toBe('ib')
    expect(typeOf('retirement')).toBe('ib')
    expect(typeOf(' ')).toBe('giro')
    expect(typeOf(null)).toBe('giro')
    expect(typeOf('CASH')).toBe('cash')
  })

  it.each([
    ['no name', {}, { name: M.name }],
    ['a blank name', { name: '   ' }, { name: M.name }],
    ['a name that is not text', { name: 7 }, { name: M.name }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }, { name: M.nameLength }],
    ['a type the app does not have', { name: 'A', type: 'loan' }, { type: M.type }],
    ['a type that is not text', { name: 'A', type: 2 }, { type: M.type }],
    ['a balance that is not a number', { name: 'A', balance: '12abc' }, { balance: M.balance }],
    ['a balance of Infinity', { name: 'A', balance: Infinity }, { balance: M.balance }],
    [
      'a starting balance that is not a number',
      { name: 'A', starting_balance: 'lots' },
      { starting_balance: M.startingBalance },
    ],
    [
      'a starting date that does not exist',
      { name: 'A', starting_date: '2026-02-30' },
      { starting_date: M.startingDate },
    ],
    [
      'a starting date in another format',
      { name: 'A', starting_date: '31.01.2026' },
      { starting_date: M.startingDate },
    ],
    ['a currency that is not a code', { name: 'A', currency: 'EURO' }, { currency: M.currency }],
    ['a currency that is not text', { name: 'A', currency: 978 }, { currency: M.currency }],
    ['a bank name that is not text', { name: 'A', bank_name: 5 }, { bank_name: M.bankName }],
    ['notes that are not text', { name: 'A', notes: ['x'] }, { notes: M.notes }],
  ])('refuses %s', (_, body, fields) => {
    expect(refused(checkAccountCreate(body))).toEqual(fields)
  })

  it('names every field it refuses at once, and summarizes them', () => {
    const checked = checkAccountCreate({ name: '', type: 'loan', balance: 'abc' })
    expect(refused(checked)).toEqual({ name: M.name, type: M.type, balance: M.balance })
    expect(refusalOf(refused(checked))).toEqual({
      error: `${M.name} ${M.type} ${M.balance}`,
      fields: { name: M.name, type: M.type, balance: M.balance },
    })
  })

  it('refuses a body that is not an object for its name', () => {
    expect(refused(checkAccountCreate(null))).toEqual({ name: M.name })
    expect(refused(checkAccountCreate(['Everyday']))).toEqual({ name: M.name })
  })
})

describe('an edit of an account', () => {
  const STORED = {
    id: 4,
    name: 'Everyday',
    type: 'giro',
    bank_name: 'Credit Union',
    balance: 920,
    starting_balance: 1000,
    starting_date: '2026-01-01',
    notes: '',
    currency: 'EUR',
    profile_id: 1,
  }

  /** What the Accounts form sends on a save that changes nothing. */
  const FORM = {
    name: 'Everyday',
    type: 'giro',
    bank_name: 'Credit Union',
    currency: 'EUR',
    starting_date: '2026-01-01',
  }

  it('changes nothing the body leaves out, or sends back as it is', () => {
    expect(checkAccountEdit({}, STORED)).toEqual({ ok: true, value: {} })
    expect(checkAccountEdit(FORM, STORED)).toEqual({ ok: true, value: {} })
    expect(
      checkAccountEdit({ ...FORM, balance: '920', bank_name: ' Credit Union' }, STORED)
    ).toEqual({ ok: true, value: {} })
  })

  it('returns only what it changes, read as a create reads it', () => {
    expect(
      checkAccountEdit(
        { ...FORM, name: ' Main ', starting_balance: 1300, balance: '1220', starting_date: '' },
        STORED
      )
    ).toEqual({
      ok: true,
      value: { name: 'Main', starting_balance: 1300, balance: 1220, starting_date: null },
    })
  })

  it('refuses a change the rules refuse, at its field', () => {
    expect(refused(checkAccountEdit({ ...FORM, name: ' ' }, STORED))).toEqual({ name: M.name })
    expect(refused(checkAccountEdit({ ...FORM, type: 'loan' }, STORED))).toEqual({ type: M.type })
    expect(refused(checkAccountEdit({ starting_date: '2026-13-01' }, STORED))).toEqual({
      starting_date: M.startingDate,
    })
  })

  it('asks for a currency only when it changes one, and keeps the row’s for a blank one', () => {
    expect(checkAccountEdit({ currency: 'usd' }, STORED)).toEqual({
      ok: true,
      value: { currency: 'USD' },
    })
    expect(checkAccountEdit({ currency: 'eur' }, STORED)).toEqual({ ok: true, value: {} })
    expect(checkAccountEdit({ currency: '' }, STORED)).toEqual({ ok: true, value: {} })
    expect(refused(checkAccountEdit({ currency: 'Euro' }, STORED))).toEqual({
      currency: M.currency,
    })
  })

  it('refuses a blank balance, which an account cannot have', () => {
    expect(refused(checkAccountEdit({ balance: '', starting_balance: null }, STORED))).toEqual({
      balance: M.balance,
      starting_balance: M.startingBalance,
    })
  })

  it('saves a row stored under older rules when the edit does not touch what they refuse', () => {
    const old = {
      ...STORED,
      name: 'Joint account held with the credit union since the old days of paper statements and passbooks',
      type: 'checking',
      starting_date: '01/01/2026',
    }
    expect(old.name.length).toBeGreaterThan(90)
    const longer = { ...old, name: `${old.name} ${'and more '.repeat(2)}`.trim() }
    expect(longer.name.length).toBeGreaterThan(100)
    // The form opens with the type as the app reads it (giro) and sends the rest back unchanged.
    expect(
      checkAccountEdit(
        { name: longer.name, type: 'giro', starting_date: '01/01/2026', notes: 'Joint' },
        longer
      )
    ).toEqual({ ok: true, value: { notes: 'Joint' } })
  })
})

describe('an account type', () => {
  it('is read by every writer as the form reads it, or refused', () => {
    expect(readAccountType(undefined)).toBe('giro')
    expect(readAccountType('  ')).toBe('giro')
    expect(readAccountType(' Savings ')).toBe('savings')
    expect(readAccountType('Checking')).toBe('giro')
    expect(readAccountType('retirement')).toBe('ib')
    expect(readAccountType('loan')).toBeNull()
    expect(readAccountType('constructor')).toBeNull()
    expect(readAccountType(7)).toBeNull()
  })

  // What a reader makes of a stored type: one this build does not have stays as it is, so the
  // list still loads, the account shows as a plain one, and an edit sends the type back unchanged.
  it('is read back from storage as stored, a v4 name as its replacement, none as giro', () => {
    expect(storedAccountType('cash')).toBe('cash')
    expect(storedAccountType('loan')).toBe('loan')
    expect(storedAccountType('checking')).toBe('giro')
    expect(storedAccountType('investment')).toBe('ib')
    expect(storedAccountType('constructor')).toBe('constructor')
    expect(storedAccountType(undefined)).toBe('giro')
    expect(storedAccountType('')).toBe('giro')
  })
})

describe('a credit card and an overdraft', () => {
  const CARD = { id: 7, name: 'Visa', type: 'credit', credit_limit: 2000, credit_rate: 15.9 }
  const OVERDRAWN = { id: 8, name: 'Everyday', type: 'giro', credit_limit: 500, credit_rate: 9.5 }

  it('is a type of its own, which an API client reads about in words', () => {
    expect(ACCOUNT_TYPES).toContain('credit')
    expect(readAccountType(' Credit ')).toBe('credit')
    expect(ACCOUNT_TYPE_WORDS.credit).toBe('a credit card')
    expect(M.type).toBe('Choose Giro, Savings, Investment, Cash or Credit card.')
  })

  it('takes a limit and a rate on a credit card or a Giro account, and on no other type', () => {
    expect(['credit', 'giro', 'checking', undefined, ''].map(takesCreditLine)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    expect(['savings', 'ib', 'cash', 'investment', 'loan'].map(takesCreditLine)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('reads a limit of 0 or more and a rate from 0 to 100, blank as none', () => {
    const value = (body: object) => {
      const checked = checkAccountCreate({ name: 'Visa', type: 'credit', ...body })
      return checked.ok ? [checked.value.credit_limit, checked.value.credit_rate] : checked.fields
    }
    expect(value({ credit_limit: '2000', credit_rate: 15.9 })).toEqual([2000, 15.9])
    expect(value({ credit_limit: 0, credit_rate: '0' })).toEqual([0, 0])
    expect(value({ credit_limit: ' ', credit_rate: null })).toEqual([null, null])
    expect(value({ credit_rate: 100 })).toEqual([null, 100])
    expect(value({ credit_limit: -1, credit_rate: 100.5 })).toEqual({
      credit_limit: M.creditLimit,
      credit_rate: M.creditRate,
    })
    expect(value({ credit_limit: '2k', credit_rate: 'high' })).toEqual({
      credit_limit: M.creditLimit,
      credit_rate: M.creditRate,
    })
  })

  it('refuses either on a new account of another type', () => {
    expect(
      refused(
        checkAccountCreate({ name: 'Pot', type: 'savings', credit_limit: 100, credit_rate: 1 })
      )
    ).toEqual({ credit_limit: M.creditLimitType, credit_rate: M.creditRateType })
    expect(refused(checkAccountCreate({ name: 'Pot', type: 'cash', credit_limit: '' }))).toEqual({})
  })

  it('takes both away when an edit makes the account another type, and keeps them otherwise', () => {
    expect(checkAccountEdit({ type: 'savings' }, OVERDRAWN)).toEqual({
      ok: true,
      value: { type: 'savings', credit_limit: null, credit_rate: null },
    })
    expect(checkAccountEdit({ type: 'credit' }, OVERDRAWN)).toEqual({
      ok: true,
      value: { type: 'credit' },
    })
    expect(checkAccountEdit({ type: 'cash' }, { ...OVERDRAWN, credit_rate: null })).toEqual({
      ok: true,
      value: { type: 'cash', credit_limit: null },
    })
    expect(checkAccountEdit({ name: 'Card', credit_rate: '' }, CARD)).toEqual({
      ok: true,
      value: { name: 'Card', credit_rate: null },
    })
  })

  it('refuses either on an edit of another type, and one sent with the type it leaves', () => {
    const savings = { ...OVERDRAWN, type: 'savings', credit_limit: null, credit_rate: null }
    expect(refused(checkAccountEdit({ credit_limit: 300 }, savings))).toEqual({
      credit_limit: M.creditLimitType,
    })
    expect(refused(checkAccountEdit({ type: 'ib', credit_rate: 4 }, OVERDRAWN))).toEqual({
      credit_rate: M.creditRateType,
    })
    // A type this build does not have takes neither, as it does not know what it is.
    expect(refused(checkAccountEdit({ credit_limit: 300 }, { ...savings, type: 'loan' }))).toEqual({
      credit_limit: M.creditLimitType,
    })
    // The values the form shows, sent back unchanged, are no change.
    expect(checkAccountEdit({ credit_limit: '500', credit_rate: '9.5' }, OVERDRAWN)).toEqual({
      ok: true,
      value: {},
    })
  })
})
