/**
 * Where a statement goes by default in setup (review of 19 Nov, finding 2): the rule on its own,
 * over plain data. The wizard runs it whenever the set of files changes (setupStatements.test.tsx).
 */
import { describe, expect, it } from 'vitest'
import { inOtherCurrency, mainAccountOf, statementTargets } from '../statementTargets'
import type { SetupStatement } from '../../../core/onboardingStore'
import type { StatementToPlace, TargetAccount } from '../statementTargets'

const MAIN: TargetAccount = { id: 1, name: 'Main checking', currency: 'EUR' }

function place(
  statements: Array<Partial<StatementToPlace> & Pick<StatementToPlace, 'bankId'>>,
  options: {
    accounts?: TargetAccount[]
    made?: string | null
    earlier?: SetupStatement[]
    base?: string
  } = {}
): Array<string | null> {
  const accounts = options.accounts ?? [MAIN]
  return statementTargets({
    statements: statements.map((s) => ({ currency: 'EUR', byHand: null, ...s })),
    earlier: options.earlier ?? [],
    accounts,
    made: options.made === undefined ? MAIN.name : options.made,
    base: options.base ?? 'EUR',
  })
}

describe('where a statement goes', () => {
  it('picked together: the first bank into the main account, another into a new one', () => {
    expect(place([{ bankId: 'revolut' }, { bankId: 'n26' }])).toEqual(['Main checking', 'N26 EUR'])
  })

  it('one after another: a bank brought in after the first gets a new account', () => {
    const earlier = [{ bankId: 'revolut' as const, currency: 'EUR', account: 'Main checking' }]
    expect(place([{ bankId: 'n26' }], { earlier })).toEqual(['N26 EUR'])
    // The bank the main account received keeps going there.
    expect(place([{ bankId: 'revolut' }], { earlier })).toEqual(['Main checking'])
  })

  it('two currencies of one bank: the one not in the base currency is set aside, with no account', () => {
    expect(
      place([
        { bankId: 'revolut', currency: 'EUR' },
        { bankId: 'revolut', currency: 'USD' },
      ])
    ).toEqual(['Main checking', null])
  })

  it('an account named for the bank in the statement currency takes it, and the main is free', () => {
    const accounts = [MAIN, { id: 2, name: 'Revolut EUR', currency: 'EUR' }]
    expect(place([{ bankId: 'revolut' }, { bankId: 'n26' }], { accounts })).toEqual([
      'Revolut EUR',
      'Main checking',
    ])
  })

  it('a statement in another currency goes into no account it finds, in either currency', () => {
    const accounts = [
      MAIN,
      { id: 2, name: 'Revolut', currency: 'EUR' },
      { id: 3, name: 'Revolut USD', currency: 'USD' },
    ]
    expect(place([{ bankId: 'revolut', currency: 'USD' }], { accounts })).toEqual([null])
  })

  it('a statement in another currency, picked first, leaves the main account to the next bank', () => {
    expect(place([{ bankId: 'revolut', currency: 'USD' }, { bankId: 'n26' }])).toEqual([
      null,
      'Main checking',
    ])
  })

  it('names a new account for the base currency only', () => {
    expect(
      place(
        [
          { bankId: 'revolut', currency: 'usd' },
          { bankId: 'n26', currency: 'eur' },
        ],
        { accounts: [], made: null }
      )
    ).toEqual([null, 'N26 EUR'])
  })

  it('keeps a target picked by hand, and one into the main account claims it', () => {
    expect(place([{ bankId: 'revolut' }, { bankId: 'n26', byHand: 'Main checking' }])).toEqual([
      'Revolut EUR',
      'Main checking',
    ])
    expect(place([{ bankId: 'revolut', byHand: 'Revolut EUR' }, { bankId: 'n26' }])).toEqual([
      'Revolut EUR',
      'Main checking',
    ])
  })

  it('puts no second bank by default into an account another bank holds, one named for it included', () => {
    const accounts = [MAIN, { id: 2, name: 'Revolut EUR', currency: 'EUR' }]
    // N26 picked by hand into the account named for Revolut: Revolut takes the main account.
    expect(
      place([{ bankId: 'revolut' }, { bankId: 'n26', byHand: 'Revolut EUR' }], { accounts })
    ).toEqual(['Main checking', 'Revolut EUR'])
    // The same, with the main account N26's from an earlier statement: a new account, under a
    // name of its own.
    const earlier = [{ bankId: 'n26' as const, currency: 'EUR', account: 'Main checking' }]
    expect(
      place([{ bankId: 'revolut' }, { bankId: 'n26', byHand: 'Revolut EUR' }], {
        accounts,
        earlier,
      })
    ).toEqual(['Revolut EUR 2', 'Revolut EUR'])
    // Held so by an earlier statement, too.
    expect(
      place([{ bankId: 'revolut' }], {
        accounts,
        earlier: [{ bankId: 'n26', currency: 'EUR', account: 'Revolut EUR' }],
      })
    ).toEqual(['Main checking'])
    // Two picks by hand can share an account.
    expect(
      place([
        { bankId: 'revolut', byHand: 'Main checking' },
        { bankId: 'n26', byHand: 'Main checking' },
      ])
    ).toEqual(['Main checking', 'Main checking'])
  })

  it('reads no currency as the base currency, on the statement and on the account', () => {
    const main = { id: 1, name: 'Main checking', currency: null }
    expect(
      place(
        [
          { bankId: 'revolut', currency: null },
          { bankId: 'n26', currency: null },
        ],
        {
          accounts: [main],
          base: 'GBP',
        }
      )
    ).toEqual(['Main checking', 'N26 GBP'])
  })

  it('never sends a statement into a main account named for another bank', () => {
    const main = { id: 1, name: 'Erste giro', currency: 'EUR' }
    expect(place([{ bankId: 'revolut' }], { accounts: [main], made: main.name })).toEqual([
      'Revolut EUR',
    ])
  })

  it('with no main account, makes one per bank', () => {
    expect(place([{ bankId: 'revolut' }, { bankId: 'n26' }], { accounts: [], made: null })).toEqual(
      ['Revolut EUR', 'N26 EUR']
    )
  })
})

describe('an empty statement', () => {
  it('never takes the main account, and goes in once its bank has it', () => {
    expect(place([{ bankId: 'revolut', empty: true }, { bankId: 'n26' }])).toEqual([
      'Revolut EUR',
      'Main checking',
    ])
    expect(place([{ bankId: 'revolut' }, { bankId: 'revolut', empty: true }])).toEqual([
      'Main checking',
      'Main checking',
    ])
  })
})

describe('the main account', () => {
  it('is the one setup made, else the newest in the base currency named for no bank', () => {
    const accounts = [
      { id: 1, name: 'Checking', currency: 'EUR' },
      { id: 2, name: 'Erste EUR', currency: 'EUR' },
      { id: 3, name: 'Joint', currency: 'EUR' },
      { id: 4, name: 'Dollars', currency: 'USD' },
    ]
    expect(mainAccountOf('Checking', accounts, 'EUR')?.name).toBe('Checking')
    expect(mainAccountOf(null, accounts, 'EUR')?.name).toBe('Joint')
    expect(mainAccountOf('Gone', accounts.slice(0, 2), 'EUR')?.name).toBe('Checking')
    expect(mainAccountOf(null, [], 'EUR')).toBeNull()
  })

  it('reopened with no account made, takes the newest in the base currency', () => {
    const accounts = [
      { id: 1, name: 'Old euros', currency: 'EUR' },
      { id: 2, name: 'New euros', currency: 'EUR' },
      { id: 3, name: 'Dollars', currency: 'USD' },
    ]
    expect(place([{ bankId: 'revolut' }], { accounts, made: null })).toEqual(['New euros'])
  })
})

describe('a currency other than the base', () => {
  it('is one the statement names and the base is not; none counts as the base', () => {
    expect(inOtherCurrency('USD', 'EUR')).toBe(true)
    expect(inOtherCurrency(' usd ', 'eur')).toBe(true)
    expect(inOtherCurrency('EUR', 'EUR')).toBe(false)
    expect(inOtherCurrency('eur', 'EUR')).toBe(false)
    expect(inOtherCurrency(null, 'EUR')).toBe(false)
    expect(inOtherCurrency('', 'EUR')).toBe(false)
  })
})
