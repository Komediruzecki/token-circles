/**
 * Where a statement goes by default in setup (review of 19 Nov, finding 2): the rule on its own,
 * over plain data. The wizard runs it whenever the set of files changes (setupStatements.test.tsx).
 */
import { describe, expect, it } from 'vitest'
import { mainAccountOf, statementTargets } from '../statementTargets'
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
): string[] {
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

  it('two currencies of one bank: the other currency gets a new account in its name', () => {
    expect(
      place([
        { bankId: 'revolut', currency: 'EUR' },
        { bankId: 'revolut', currency: 'USD' },
      ])
    ).toEqual(['Main checking', 'Revolut USD'])
  })

  it('an account named for the bank in the statement currency takes it, and the main is free', () => {
    const accounts = [MAIN, { id: 2, name: 'Revolut EUR', currency: 'EUR' }]
    expect(place([{ bankId: 'revolut' }, { bankId: 'n26' }], { accounts })).toEqual([
      'Revolut EUR',
      'Main checking',
    ])
  })

  it('an account named for the bank in another currency is not where its statement goes', () => {
    const accounts = [MAIN, { id: 2, name: 'Revolut', currency: 'EUR' }]
    expect(place([{ bankId: 'revolut', currency: 'USD' }], { accounts })).toEqual(['Revolut USD'])
  })

  it('a statement in another currency than the main account gets a new account', () => {
    expect(place([{ bankId: 'revolut', currency: 'USD' }, { bankId: 'n26' }])).toEqual([
      'Revolut USD',
      'Main checking',
    ])
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

describe('the main account', () => {
  it('is the one setup made, else the newest in the currency named for no bank', () => {
    const accounts = [
      { id: 1, name: 'Checking', currency: 'EUR' },
      { id: 2, name: 'Erste EUR', currency: 'EUR' },
      { id: 3, name: 'Joint', currency: 'EUR' },
      { id: 4, name: 'Dollars', currency: 'USD' },
    ]
    expect(mainAccountOf('Checking', accounts, 'EUR', 'EUR')?.name).toBe('Checking')
    expect(mainAccountOf(null, accounts, 'EUR', 'EUR')?.name).toBe('Joint')
    expect(mainAccountOf('Gone', accounts.slice(0, 2), 'EUR', 'EUR')?.name).toBe('Checking')
    expect(mainAccountOf(null, accounts, 'USD', 'EUR')?.name).toBe('Dollars')
    expect(mainAccountOf(null, [], 'EUR', 'EUR')).toBeNull()
  })

  it('reopened with no account made, takes the newest in the statement currency', () => {
    const accounts = [
      { id: 1, name: 'Old euros', currency: 'EUR' },
      { id: 2, name: 'New euros', currency: 'EUR' },
      { id: 3, name: 'Dollars', currency: 'USD' },
    ]
    expect(place([{ bankId: 'revolut' }], { accounts, made: null })).toEqual(['New euros'])
  })
})
