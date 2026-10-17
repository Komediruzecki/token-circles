/**
 * The person's numbers the circles read (shared/guidance/facts.ts): the window the averages run
 * over, income and spending, what is needed every month, the money a person can reach and a
 * current account's low point, debts with cards and overdrafts, invested money and the savings
 * rate. The thresholds it shares with the official figures are held to them here.
 */
import { describe, expect, it } from 'vitest'
import { addCalendarMonths } from '../../../../shared/calendarMonths'
import { bandFor, bandsFor } from '../../../../shared/guidance/benchmarks'
import {
  FIRST_CUSHION_MONTHS,
  FULL_CUSHION_MONTHS,
  placeCircle,
} from '../../../../shared/guidance/circles'
import {
  balanceMoves,
  CARD_PAYMENT_MONTHS,
  cushionOf,
  debtsOf,
  EXPENSIVE_DEBT_RATE,
  guidanceFacts,
  investedOf,
  liquidOf,
  LOAN_PRINCIPAL_IS_SAVING,
  windowMonths,
} from '../../../../shared/guidance/facts'
import { kindForName } from '../../../../shared/guidance/kinds'
import { REGIONS } from '../../../../shared/guidance/region'
import { amortize } from '../../../../shared/loanSchedule'
import { computeBalanceDeltas } from '../storage/idb'
import type {
  FactsAccount,
  FactsAnswers,
  FactsEntry,
  GuidanceInput,
} from '../../../../shared/guidance/facts'

const TODAY = '2026-10-11'

/** 'YYYY-MM' `n` months before October 2026. */
const ago = (n: number) => addCalendarMonths('2026-10-01', -n).slice(0, 7)

function entry(date: string, over: Partial<FactsEntry> = {}): FactsEntry {
  return { date, type: 'expense', amount: 10, category_id: 1, ...over }
}

/** One month: income, and three expenses (so the month is tracked) adding up to `spent`. */
function month(ym: string, earned: number, spent: number, over: Partial<FactsEntry> = {}) {
  return [
    entry(`${ym}-01`, { type: 'income', amount: earned, category_id: 9, ...over }),
    ...[0.5, 0.3, 0.2].map((share, i) =>
      entry(`${ym}-0${i + 2}`, { amount: spent * share, ...over })
    ),
  ]
}

const categories = [
  { id: 1, name: 'Groceries', type: 'expense', kind: 'groceries' },
  { id: 2, name: 'Eating out', type: 'expense', kind: 'eating_out' },
  { id: 9, name: 'Salary', type: 'income' },
]

function input(over: Partial<GuidanceInput> = {}): GuidanceInput {
  return {
    today: TODAY,
    region: 'DE',
    transactions: [1, 2, 3, 4].flatMap((n) => month(ago(n), 2000, 1000)),
    categories,
    accounts: [{ id: 1, type: 'savings', balance: 1500 }],
    ...over,
  }
}

describe('the window', () => {
  it('is the last twelve tracked months before this one: a month needs three entries', () => {
    const transactions = [
      ...Array.from({ length: 22 }, (_, i) => i + 1)
        .filter((n) => n !== 5)
        .flatMap((n) => month(ago(n), 2000, 1000)),
      // May 2026 has two entries, so it is not tracked.
      ...month(ago(5), 2000, 1000).slice(0, 2),
      // This month is under way.
      ...month('2026-10', 2000, 50),
    ]
    const months = windowMonths(transactions, TODAY)
    expect(months).toHaveLength(12)
    expect(months).not.toContain(ago(5))
    expect(months).not.toContain('2026-10')
    expect(months[11]).toBe(ago(1))
    expect(months[0]).toBe(ago(13))
  })

  it('averages over the months it has, once there are three', () => {
    const two = guidanceFacts(
      input({ transactions: [1, 2].flatMap((n) => month(ago(n), 2000, 1000)) })
    )
    expect(two.averaged).toBe(false)
    expect([two.income, two.spending, two.essentials, two.cushionMonths]).toEqual([
      null,
      null,
      null,
      null,
    ])
    // Liquid money is today's balances, with or without the months.
    expect(two.liquid).toBe(1500)
    expect(
      cushionOf(input({ transactions: [1, 2].flatMap((n) => month(ago(n), 2000, 1000)) }))
    ).toEqual({ liquid: 1500, essentials: null, months: null, against: 'needs' })

    const three = guidanceFacts(
      input({ transactions: [1, 2, 3].flatMap((n) => month(ago(n), 2000, 1000 * n)) })
    )
    expect(three.averaged).toBe(true)
    expect(three.spending).toBeCloseTo(2000, 6)
    expect(three.monthsInYear).toBe(3)
    expect(three.firm).toBe(false)

    // A year is on file at twelve tracked months.
    const year = (n: number) =>
      guidanceFacts(
        input({
          transactions: Array.from({ length: n }, (_, i) => i + 1).flatMap((m) =>
            month(ago(m), 2000, 1000)
          ),
        })
      )
    expect([year(11).firm, year(12).firm]).toEqual([false, true])
  })
})

describe('income and spending', () => {
  it('reads income less deductions, and spending as expenses only, in the base currency', () => {
    const transactions = [1, 2, 3].flatMap((n) => [
      ...month(ago(n), 3000, 1000),
      entry(`${ago(n)}-20`, { type: 'deduction', amount: 600, category_id: null }),
      entry(`${ago(n)}-21`, { type: 'transfer', amount: 500, category_id: null }),
      // 750 in another currency, 100 in the base one.
      entry(`${ago(n)}-22`, { amount: 750, amount_local: 100 }),
    ])
    const facts = guidanceFacts(input({ transactions }))
    expect(facts.income).toBeCloseTo(2400, 6)
    expect(facts.spending).toBeCloseTo(1100, 6)
    expect(facts.annualSpending).toBeCloseTo(13200, 6)
  })

  it('leaves the support the person expects to stop out of their own income', () => {
    const transactions = [1, 2, 3].flatMap((n) => [
      ...month(ago(n), 430, 600),
      entry(`${ago(n)}-15`, { type: 'income', amount: 250, category_id: 8 }),
    ])
    const facts = guidanceFacts(input({ transactions, answers: { supportCategoryIds: [8] } }))
    expect(facts.income).toBeCloseTo(680, 6)
    expect(facts.ownIncome).toBeCloseTo(430, 6)
    expect(guidanceFacts(input({ transactions })).ownIncome).toBeCloseTo(680, 6)
  })

  it('says how much of the spending is filed under a category', () => {
    const transactions = [1, 2, 3].flatMap((n) => [
      ...month(ago(n), 2000, 900),
      entry(`${ago(n)}-20`, { amount: 100, category_id: null }),
    ])
    expect(guidanceFacts(input({ transactions })).sortedShare).toBeCloseTo(90, 6)
  })
})

describe('what is needed every month', () => {
  const kinds = [
    { id: 1, name: 'Groceries', type: 'expense', kind: 'groceries' },
    { id: 2, name: 'Eating out', type: 'expense', kind: 'eating_out' },
    // The person's choice beats the kind, either way.
    { id: 3, name: 'Organic box', type: 'expense', kind: 'groceries', essential: 0 },
    { id: 4, name: 'Gym', type: 'expense', kind: 'leisure', essential: 1 },
    // Nothing says: needed.
    { id: 5, name: 'Konzum', type: 'expense' },
    { id: 9, name: 'Salary', type: 'income' },
  ]
  const transactions = [1, 2, 3].flatMap((n) => [
    entry(`${ago(n)}-01`, { type: 'income', amount: 3000, category_id: 9 }),
    entry(`${ago(n)}-02`, { amount: 400, category_id: 1 }),
    entry(`${ago(n)}-03`, { amount: 200, category_id: 2 }),
    entry(`${ago(n)}-04`, { amount: 50, category_id: 3 }),
    entry(`${ago(n)}-05`, { amount: 30, category_id: 4 }),
    entry(`${ago(n)}-06`, { amount: 120, category_id: 5 }),
    entry(`${ago(n)}-07`, { amount: 80, category_id: null }),
  ])

  it('is the kinds a month costs whatever happens, the person’s choices, and what nothing says', () => {
    expect(kindForName('Konzum')).toBeNull()
    const facts = guidanceFacts(input({ transactions, categories: kinds }))
    // Groceries 400, the gym 30, Konzum 120 and the 80 with no category.
    expect(facts.essentials).toBeCloseTo(630, 6)
    // Konzum and the 80 were counted only because nothing said otherwise; the rest was not.
    expect(facts.unsure).toEqual({ categories: 1, uncategorised: 80, all: false })
    expect(cushionOf(input({ transactions, categories: kinds })).against).toBe('needs')
  })

  it('in a space whose categories have no kind, is everything, and the cushion is read against it', () => {
    // Named in Croatian: no kind is guessed from a name that is not English.
    const croatian = [
      { id: 1, name: 'Najam', type: 'expense' },
      { id: 2, name: 'Hrana', type: 'expense' },
      { id: 3, name: 'Režije', type: 'expense' },
      { id: 9, name: 'Plaća', type: 'income' },
    ]
    for (const { name } of croatian) expect(kindForName(name)).toBeNull()
    const spent = [1, 2, 3].flatMap((n) => [
      entry(`${ago(n)}-01`, { type: 'income', amount: 1500, category_id: 9 }),
      entry(`${ago(n)}-02`, { amount: 500, category_id: 1 }),
      entry(`${ago(n)}-03`, { amount: 300, category_id: 2 }),
      entry(`${ago(n)}-04`, { amount: 100, category_id: 3 }),
    ])
    const facts = guidanceFacts(
      input({
        transactions: spent,
        categories: croatian,
        accounts: [{ id: 1, type: 'savings', balance: 450 }],
      })
    )
    expect(facts.essentials).toBeCloseTo(900, 6)
    expect(facts.essentials).toBeCloseTo(facts.spending!, 6)
    expect(facts.unsure.categories).toBe(3)
    // All of it was counted as needed only because nothing said otherwise.
    expect(facts.unsure.all).toBe(true)
    expect(facts.cushionMonths).toBeCloseTo(0.5, 6)
    const cushion = cushionOf(input({ transactions: spent, categories: croatian }))
    expect(cushion.essentials).toBeCloseTo(900, 6)
    // So the cushion is read against what is spent, and says so.
    expect(cushion.against).toBe('spending')
    // With two months there is no figure to read it against yet.
    const two = spent.filter((one) => one.date.slice(0, 7) !== ago(3))
    expect(guidanceFacts(input({ transactions: two, categories: croatian })).unsure.all).toBe(false)
    expect(cushionOf(input({ transactions: two, categories: croatian })).against).toBe('needs')
    // The circles place it all the same.
    expect(placeCircle(facts).circles[2].checks[0]).toMatchObject({
      id: 'first-cushion',
      met: false,
    })
  })

  it('with nothing needed at all, any money covers a month', () => {
    const optional = [
      { id: 2, name: 'Eating out', type: 'expense', kind: 'eating_out' },
      { id: 9, name: 'Salary', type: 'income' },
    ]
    const facts = guidanceFacts(
      input({
        transactions: [1, 2, 3].flatMap((n) => month(ago(n), 2000, 300, { category_id: 2 })),
        categories: optional,
      })
    )
    expect(facts.essentials).toBe(0)
    expect(facts.cushionMonths).toBe(Number.POSITIVE_INFINITY)
    expect(facts.unsure.all).toBe(false)
    // Set beside the official figures, that cushion is high.
    expect(bandFor('cushion.months', facts.region, facts.cushionMonths!)?.band).toBe('high')
  })

  it('is read against what is spent only while nothing said any of it is needed', () => {
    const against = (cats: GuidanceInput['categories']) =>
      cushionOf(
        input({
          categories: cats,
          transactions: [1, 2, 3].flatMap((n) => [
            entry(`${ago(n)}-01`, { type: 'income', amount: 1500, category_id: 9 }),
            entry(`${ago(n)}-02`, { amount: 500, category_id: 1 }),
            entry(`${ago(n)}-03`, { amount: 300, category_id: null }),
            entry(`${ago(n)}-04`, { amount: 100, category_id: 2 }),
          ]),
        })
      ).against
    const salary = { id: 9, name: 'Salary', type: 'income' }
    // Najam has no kind, so all that is needed is what nothing said about; Eating out is not.
    const najam = { id: 1, name: 'Najam', type: 'expense' }
    const eatingOut = { id: 2, name: 'Eating out', type: 'expense', kind: 'eating_out' }
    expect(against([najam, eatingOut, salary])).toBe('spending')
    // A category the profile no longer has says nothing either.
    expect(against([eatingOut, salary])).toBe('spending')
    // One needed category with a kind, or one the person ticked, and it is what is needed.
    expect(against([{ ...najam, kind: 'housing' }, eatingOut, salary])).toBe('needs')
    expect(against([{ ...najam, essential: 1 }, eatingOut, salary])).toBe('needs')
    expect(against([najam, { ...eatingOut, essential: 1 }, salary])).toBe('needs')
  })
})

describe('money moved between accounts', () => {
  const moving = [
    { id: 1, name: 'Groceries', type: 'expense', kind: 'groceries' },
    // Where the bank import's worldwide rules file a transfer: no kind, so needed if it counted.
    { id: 7, name: 'Transfers', type: 'expense' },
    { id: 9, name: 'Salary', type: 'income' },
  ]
  // Each month: a salary of 1,200, groceries of 400, and 1,000 put by as an expense.
  const putBy = (categoryId: number) =>
    [1, 2, 3].flatMap((n) => [
      entry(`${ago(n)}-01`, { type: 'income', amount: 1200, category_id: 9 }),
      entry(`${ago(n)}-02`, { amount: 250, category_id: 1 }),
      entry(`${ago(n)}-03`, { amount: 150, category_id: 1 }),
      entry(`${ago(n)}-04`, { amount: 1000, category_id: categoryId }),
    ])
  const savings: FactsAccount[] = [{ id: 1, type: 'savings', balance: 1000 }]

  it('filed as an expense under Transfers is neither spending nor needed', () => {
    const facts = guidanceFacts(
      input({ transactions: putBy(7), categories: moving, accounts: savings })
    )
    expect(facts.spending).toBeCloseTo(400, 6)
    expect(facts.essentials).toBeCloseTo(400, 6)
    expect(facts.sortedShare).toBeCloseTo(100, 6)
    expect(facts.unsure).toEqual({ categories: 0, uncategorised: 0, all: false })
    // The cushion: 1,000 against 400 a month, not against 1,400.
    expect(facts.cushionMonths).toBeCloseTo(2.5, 6)
    expect(
      cushionOf(input({ transactions: putBy(7), categories: moving, accounts: savings }))
    ).toEqual({ liquid: 1000, essentials: 400, months: 2.5, against: 'needs' })
    // The savings rate: 800 of 1,200 kept.
    expect(facts.savings.cash).toBeCloseTo((800 / 1200) * 100, 6)
    // Circle 2: the salary covers what is spent.
    expect(placeCircle(facts).circles.find((place) => place.circle === 2)?.checks).toEqual([
      expect.objectContaining({ id: 'own-income', met: true }),
    ])
  })

  it('is any category of transfers or accounts, Transfers however it is written, and what is filed inside one', () => {
    const others = [
      ...moving,
      // Even marked as needed every month: what it holds was moved, not spent.
      { id: 2, name: 'Transfers', type: 'expense', essential: 1 },
      { id: 3, name: 'Moving money', type: 'transfer' },
      { id: 4, name: 'Tagesgeld', type: 'account' },
      { id: 5, name: '  TRANSFERS ', type: 'expense' },
      { id: 6, name: 'To the holiday pot', type: 'expense', parent_id: 7 },
    ]
    for (const id of [2, 3, 4, 5, 6]) {
      const facts = guidanceFacts(
        input({ transactions: putBy(id), categories: others, accounts: savings })
      )
      expect([id, facts.spending, facts.essentials]).toEqual([id, 400, 400])
    }
  })

  it('leaves Other as spending, which its kind does not count as needed', () => {
    const other = [...moving, { id: 8, name: 'Other', type: 'expense' }]
    expect(kindForName('Other')).toBe('other')
    const facts = guidanceFacts(
      input({ transactions: putBy(8), categories: other, accounts: savings })
    )
    expect(facts.spending).toBeCloseTo(1400, 6)
    expect(facts.essentials).toBeCloseTo(400, 6)
    expect(facts.unsure).toEqual({ categories: 0, uncategorised: 0, all: false })
  })
})

describe('the money a person can reach', () => {
  // October 11th: the last 30 days run from September 12th.
  const giro: FactsAccount = { id: 1, type: 'giro', balance: 1500 }
  const payday = [
    // The day before the 30 days: not read back, or the account would have been 4,450 short.
    entry('2026-09-11', { type: 'income', amount: 5000, account_id: 1, category_id: 9 }),
    entry('2026-09-20', { amount: 50, account_id: 1 }),
    entry('2026-09-25', { type: 'income', amount: 2000, account_id: 1, category_id: 9 }),
    entry('2026-09-26', { amount: 900, account_id: 1 }),
    entry('2026-10-05', { amount: 100, account_id: 1 }),
  ]

  it('takes a current account at its lowest in the last 30 days: the day before payday', () => {
    // 1500 now; 1600 before the 5th; 2500 before the rent; 500 before the salary; 550 before that.
    expect(liquidOf([giro], payday, TODAY)).toBe(500)
  })

  it('reads an entry dated later than today as not having happened yet', () => {
    const booked = [entry('2026-10-20', { amount: 50, account_id: 1 })]
    expect(liquidOf([{ id: 1, type: 'giro', balance: 950 }], booked, TODAY)).toBe(1000)
  })

  it('reads savings and cash at their balance today, as it does a current account', () => {
    // Rent of 900 booked for the 31st: the stored 600 already has it taken out, and today holds 1,500.
    const rent = [entry('2026-10-31', { amount: 900, account_id: 1 })]
    for (const type of ['giro', 'savings', 'cash']) {
      expect(liquidOf([{ id: 1, type, balance: 600 }], rent, TODAY), type).toBe(1500)
    }
  })

  it('reads a transfer to savings out of the one account and into the other', () => {
    const moved = [
      entry('2026-10-01', { type: 'transfer', amount: 400, account_id: 1, transfer_account_id: 2 }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: 100 },
      { id: 2, type: 'savings', balance: 400 },
    ]
    // Before the transfer the current account held 500; after it, 100.
    expect(liquidOf(accounts, moved, TODAY)).toBe(500)
    // The same with more put by: 2,000 on the 6th, and the two never held less than 7,500.
    const putBy = [
      entry('2026-10-06', {
        type: 'transfer',
        amount: 2000,
        account_id: 1,
        transfer_account_id: 2,
      }),
    ]
    const after = [
      { id: 1, type: 'giro', balance: 500 },
      { id: 2, type: 'savings', balance: 7000 },
    ]
    expect(liquidOf(after, putBy, TODAY)).toBe(7500)
  })

  it('reads the current accounts as one pool: a move between two of them hides nothing', () => {
    // 1,000 moved from one current account to the other on the 1st: the two never held less.
    const moved = [
      entry('2026-10-01', {
        type: 'transfer',
        amount: 1000,
        account_id: 1,
        transfer_account_id: 2,
      }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: 0 },
      { id: 2, type: 'giro', balance: 1000 },
    ]
    expect(liquidOf(accounts, moved, TODAY)).toBe(1000)
  })

  it('reads a switch of banks at the low point before the salary', () => {
    // The salary came into the old bank on September 21st; on the 8th it all moved to the new one.
    const switched = [
      entry('2026-09-21', { type: 'income', amount: 2000, account_id: 1, category_id: 9 }),
      entry('2026-10-08', {
        type: 'transfer',
        amount: 2400,
        account_id: 1,
        transfer_account_id: 2,
      }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: 0 },
      { id: 2, type: 'giro', balance: 2400 },
    ]
    expect(liquidOf(accounts, switched, TODAY)).toBe(400)
  })

  it('counts a salary passed on from the account it comes into once, and before it came', () => {
    // Paid into the salary account on September 21st, all of it moved on to the spending account on
    // the 1st: 3,000 since the salary, 1,000 before it.
    const paid = [
      entry('2026-09-21', { type: 'income', amount: 2000, account_id: 1, category_id: 9 }),
      entry('2026-10-01', {
        type: 'transfer',
        amount: 2000,
        account_id: 1,
        transfer_account_id: 2,
      }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: 1000 },
      { id: 2, type: 'giro', balance: 2000 },
    ]
    expect(liquidOf(accounts, paid, TODAY)).toBe(1000)
  })

  it('takes nothing from one current account for the overdraft of another', () => {
    // The first account was 200 overdrawn from the 6th to the 8th; the second held 400 throughout.
    const dipped = [
      entry('2026-10-06', { amount: 500, account_id: 1 }),
      entry('2026-10-08', { type: 'income', amount: 500, account_id: 1, category_id: 9 }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: 300 },
      { id: 2, type: 'giro', balance: 400 },
    ]
    expect(liquidOf(accounts, dipped, TODAY)).toBe(400)
  })

  it('reads money moved in from savings at the current account’s low point before it came', () => {
    // 2,000 moved from savings to the current account on the 6th. Savings count at their balance and
    // the current accounts at their low point, so the 2,000 counts from the day the low point
    // passes it: until then 3,500 reads, held or spent. An under-count, towards a larger cushion.
    const moved = [
      entry('2026-10-06', {
        type: 'transfer',
        amount: 2000,
        account_id: 2,
        transfer_account_id: 1,
      }),
    ]
    const held = [
      { id: 1, type: 'giro', balance: 2500 },
      { id: 2, type: 'savings', balance: 3000 },
    ]
    expect(liquidOf(held, moved, TODAY)).toBe(3500)
    // Spent on a 2,000 bill on the 7th.
    const spent = [...moved, entry('2026-10-07', { amount: 2000, account_id: 1 })]
    const after = [
      { id: 1, type: 'giro', balance: 500 },
      { id: 2, type: 'savings', balance: 3000 },
    ]
    expect(liquidOf(after, spent, TODAY)).toBe(3500)
  })

  it('reads back exactly 30 days: today and the 29 before it', () => {
    // September 12th is the first of the 30: its balance at the end of the day counts, so a salary
    // that day was already there. One on the 13th was not, the day before.
    const salaryOn = (date: string) => [
      entry(date, { type: 'income', amount: 1000, account_id: 1, category_id: 9 }),
    ]
    const giro = [{ id: 1, type: 'giro', balance: 1000 }]
    expect(liquidOf(giro, salaryOn('2026-09-12'), TODAY)).toBe(1000)
    expect(liquidOf(giro, salaryOn('2026-09-13'), TODAY)).toBe(0)
  })

  it('adds savings and cash, leaves investments and cards out, and counts nothing below zero', () => {
    const accounts = [
      giro,
      { id: 2, type: 'savings', balance: 300 },
      { id: 3, type: 'cash', balance: 20 },
      { id: 4, type: 'ib', balance: 5000 },
      { id: 5, type: 'credit', balance: -200 },
      { id: 6, type: 'savings', balance: -40 },
    ]
    expect(liquidOf(accounts, payday, TODAY)).toBe(820)
    // A current account that went below zero before payday counts as nothing.
    expect(liquidOf([{ id: 1, type: 'giro', balance: 100 }], payday, TODAY)).toBe(0)
  })

  it('reads an old type name as the type it became', () => {
    expect(liquidOf([{ id: 1, type: 'checking', balance: 70 }], [], TODAY)).toBe(70)
  })

  it('is unknown without the accounts, or with none money could be in', () => {
    expect(liquidOf(null, payday, TODAY)).toBeNull()
    expect(liquidOf([], payday, TODAY)).toBeNull()
    expect(liquidOf([{ id: 4, type: 'ib', balance: 5000 }], payday, TODAY)).toBeNull()
    expect(guidanceFacts(input({ accounts: null })).cushionMonths).toBeNull()
    expect(guidanceFacts(input({ accounts: null })).accountsKnown).toBe(false)
    expect(guidanceFacts(input({ accounts: [] })).accountsKnown).toBe(true)
  })

  it('moves balances as local-first books them', () => {
    const table: FactsEntry[] = [
      entry('2026-10-01', { type: 'income', amount: 100, account_id: 5 }),
      entry('2026-10-01', { type: 'expense', amount: 100, account_id: 5 }),
      entry('2026-10-01', { type: 'expense', amount: 750, amount_local: 100, account_id: 5 }),
      entry('2026-10-01', { type: 'transfer', amount: 100, account_id: 1, transfer_account_id: 2 }),
      entry('2026-10-01', { type: 'transfer', amount: 100, account_id: 1 }),
      entry('2026-10-01', { type: 'income', amount: 100, transfer_account_id: 2 }),
      entry('2026-10-01', { type: 'transfer', amount: 100, transfer_account_id: 2 }),
      entry('2026-10-01', { type: 'expense', amount: 100, transfer_account_id: 2 }),
      entry('2026-10-01', { type: 'deduction', amount: 100, account_id: 5 }),
      entry('2026-10-01', { type: 'income', amount: 100, account_id: 5, transfer_account_id: 2 }),
      entry('2026-10-01', { type: 'expense', amount: 100 }),
    ]
    for (const row of table) {
      const app = computeBalanceDeltas({ ...row, type: row.type, amount: row.amount })
      expect(balanceMoves(row), JSON.stringify(row)).toEqual(
        app.map(({ accountId, delta }) => ({ account: accountId, delta }))
      )
    }
  })
})

describe('debts', () => {
  const loan = {
    principal: 10000,
    interest_rate: 6,
    start_date: '2025-01-01',
    term_months: 48,
    rate_periods: [],
    prepayments: [],
  }

  it('are the loans with a balance left, at the rate charged now', () => {
    const repaid = { ...loan, start_date: '2020-01-01', term_months: 12 }
    // Fixed at 3% for two years, then 12%: the rate now is 12%.
    const reset = {
      ...loan,
      id: 7,
      name: 'Mortgage',
      interest_rate: 3,
      rate_periods: [{ rate: 12, start_month: 13, end_month: null }],
    }
    const debts = debtsOf({ today: TODAY, transactions: [], accounts: [], loans: [repaid, reset] })
    expect(debts).toHaveLength(1)
    expect(debts[0]).toMatchObject({
      kind: 'loan',
      id: 7,
      name: 'Mortgage',
      rate: 12,
      expensive: true,
    })
    expect(debts[0].owed).toBeGreaterThan(0)
    expect(debts[0].payment).toBeGreaterThan(0)
  })

  it('call a loan expensive from the line up', () => {
    const at = (rate: number) =>
      debtsOf({
        today: TODAY,
        transactions: [],
        accounts: [],
        loans: [{ ...loan, interest_rate: rate }],
      })[0].expensive
    expect(at(EXPENSIVE_DEBT_RATE - 0.01)).toBe(false)
    expect(at(EXPENSIVE_DEBT_RATE)).toBe(true)
  })

  it('count a card or an overdraft below zero, expensive unless its rate is set below the line', () => {
    // Each card's balance is carried, as the person says: the rate decides.
    const accounts: FactsAccount[] = [
      { id: 1, type: 'credit', balance: -1500, credit_rate: 19.9, name: 'Visa' },
      { id: 2, type: 'credit', balance: -800, credit_rate: 0, name: 'Store card' },
      { id: 3, type: 'credit', balance: -300, credit_rate: null, name: 'Old card' },
      { id: 4, type: 'giro', balance: -250, credit_rate: 11.5, name: 'Current' },
      { id: 5, type: 'credit', balance: 20, credit_rate: 19.9, name: 'Paid off' },
      { id: 6, type: 'savings', balance: -10 },
    ]
    const debts = debtsOf({
      today: TODAY,
      transactions: [],
      accounts,
      loans: [],
      answers: { carriesCardBalance: true },
    })
    expect(
      debts.map(({ kind, id, owed, rate, expensive }) => ({ kind, id, owed, rate, expensive }))
    ).toEqual([
      { kind: 'card', id: 1, owed: 1500, rate: 19.9, expensive: true },
      { kind: 'card', id: 2, owed: 800, rate: 0, expensive: false },
      { kind: 'card', id: 3, owed: 300, rate: null, expensive: true },
      { kind: 'overdraft', id: 4, owed: 250, rate: 11.5, expensive: true },
    ])
  })

  it('read cards and current accounts at their balance today', () => {
    const booked = [
      // Rent booked for the 31st took the stored balance below zero: today the account holds 800.
      entry('2026-10-31', { amount: 900, account_id: 1 }),
      // The card's payment is booked for the 20th: today 300 is owed on it.
      entry('2026-10-20', { type: 'transfer', amount: 300, account_id: 9, transfer_account_id: 2 }),
    ]
    const accounts = [
      { id: 1, type: 'giro', balance: -100, credit_rate: 11.5 },
      { id: 2, type: 'credit', balance: 0, credit_rate: 19.9 },
    ]
    const debts = debtsOf({ today: TODAY, transactions: booked, accounts, loans: [] })
    expect(debts.map(({ kind, id, owed }) => ({ kind, id, owed }))).toEqual([
      { kind: 'card', id: 2, owed: 300 },
    ])
  })

  it('leave cards and overdrafts out when the person carries no balance on either', () => {
    const accounts = [{ id: 1, type: 'credit', balance: -1500, credit_rate: 19.9 }]
    const debts = debtsOf({
      today: TODAY,
      transactions: [],
      accounts,
      loans: [loan],
      answers: { carriesCardBalance: false },
    })
    expect(debts.map((d) => d.kind)).toEqual(['loan'])
  })

  it("take a card's payment as what went into it, a month on average over three full months", () => {
    const into = (date: string, amount: number) =>
      entry(date, { type: 'transfer', amount, account_id: 9, transfer_account_id: 1 })
    const transactions = [
      into('2026-07-15', 300),
      into('2026-08-15', 200),
      into('2026-09-15', 100),
      // Not a full month yet, and before the three.
      into('2026-10-02', 999),
      into('2026-06-15', 999),
      // Spending on the card is not a payment, and nor is a refund.
      entry('2026-09-20', { amount: 80, account_id: 1 }),
      entry('2026-09-25', { type: 'income', amount: 40, account_id: 1 }),
    ]
    const [card] = debtsOf({
      today: TODAY,
      transactions,
      accounts: [{ id: 1, type: 'credit', balance: -1500, credit_rate: 19.9 }],
      loans: [],
    })
    expect(card.payment).toBeCloseTo(200, 6)
  })

  it('count the expensive ones for the circles, cards included', () => {
    const facts = guidanceFacts(
      input({
        accounts: [
          { id: 1, type: 'savings', balance: 5000 },
          { id: 2, type: 'credit', balance: -6200, credit_rate: 24.9 },
        ],
        loans: [{ ...loan, interest_rate: 7.2 }],
        answers: { carriesCardBalance: true },
      })
    )
    expect(facts.debts.map((d) => [d.kind, d.expensive])).toEqual([
      ['loan', false],
      ['card', true],
    ])
    expect(
      placeCircle(facts).circles[3].checks.find((c) => c.id === 'no-expensive-debt')
    ).toMatchObject({
      met: false,
      value: 1,
    })
  })

  describe('a card', () => {
    // October 11th: the card's payment is averaged over July, August and September.
    const into = (date: string, amount: number) =>
      entry(date, { type: 'transfer', amount, account_id: 9, transfer_account_id: 1 })
    const spent = (date: string, amount: number) => entry(date, { amount, account_id: 1 })
    const cards = (
      transactions: readonly FactsEntry[],
      balance: number,
      answers?: FactsAnswers,
      rate: number | null = 19.9
    ) =>
      debtsOf({
        today: TODAY,
        transactions,
        accounts: [{ id: 1, type: 'credit', balance, credit_rate: rate }],
        loans: [],
        answers,
      })
    // Cleared each month: what a month spent on it is paid in at the month's end.
    const cleared = [
      ...['2026-06', '2026-07', '2026-08', '2026-09'].flatMap((m) => [
        spent(`${m}-05`, 300),
        into(`${m}-28`, 300),
      ]),
      spent('2026-10-05', 300),
    ]
    // Carrying 2,000: 100 spent on it and 150 paid in a month, since May.
    const carrying = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((m) => [
      spent(`${m}-05`, 100),
      into(`${m}-28`, 150),
    ])
    // Opened in September: too little history to say.
    const recent = [spent('2026-09-10', 300), into('2026-09-28', 100), spent('2026-10-05', 300)]

    it('cleared each month carries no balance, and is no debt', () => {
      expect(CARD_PAYMENT_MONTHS).toBe(3)
      expect(cards(cleared, -300)).toEqual([])
    })

    it('carrying a balance is carried, and expensive unless its rate is below the line', () => {
      expect(cards(carrying, -2000)).toEqual([
        expect.objectContaining({ kind: 'card', owed: 2000, carried: true, expensive: true }),
      ])
      expect(cards(carrying, -2000, undefined, 5)[0]).toMatchObject({
        carried: true,
        expensive: false,
      })
    })

    it('with too little history, is not known to be carried, nor to be expensive', () => {
      expect(cards(recent, -500)).toEqual([
        expect.objectContaining({ kind: 'card', owed: 500, carried: null, expensive: null }),
      ])
      // Below the line it is not expensive either way.
      expect(cards(recent, -500, undefined, 5)[0]).toMatchObject({
        carried: null,
        expensive: false,
      })
      // Nor is a card with no entries at all.
      expect(cards([], -500)[0]).toMatchObject({ carried: null, expensive: null })
      // Its entries go back far enough from the first of the three months.
      const since = (date: string) => cards([spent(date, 400), into('2026-09-28', 100)], -500)[0]
      expect(since('2026-07-01')).toMatchObject({ carried: true, expensive: true })
      expect(since('2026-07-02')).toMatchObject({ carried: null, expensive: null })
    })

    it('leaves an overdraft carried, whatever its entries', () => {
      const [overdraft] = debtsOf({
        today: TODAY,
        transactions: [],
        accounts: [{ id: 4, type: 'giro', balance: -250, credit_rate: null }],
        loans: [],
      })
      expect(overdraft).toMatchObject({ kind: 'overdraft', carried: true, expensive: true })
    })

    it('is what the person says, when they have said, whatever its entries show', () => {
      const cases: Array<[FactsEntry[], number]> = [
        [cleared, -300],
        [carrying, -2000],
        [recent, -500],
      ]
      for (const [transactions, balance] of cases) {
        expect(cards(transactions, balance, { carriesCardBalance: false })).toEqual([])
        expect(cards(transactions, balance, { carriesCardBalance: true })).toEqual([
          expect.objectContaining({ carried: true, expensive: true }),
        ])
      }
    })

    it('not known to be carried, leaves expensive debt not known: a question, not advice', () => {
      const debt = (transactions: FactsEntry[], balance: number, answers?: FactsAnswers) =>
        placeCircle(
          guidanceFacts(
            input({
              transactions: [...input().transactions, ...transactions],
              accounts: [
                { id: 2, type: 'savings', balance: 5000 },
                { id: 1, type: 'credit', balance, credit_rate: null },
              ],
              answers,
            })
          )
        ).circles[3].checks.find((c) => c.id === 'no-expensive-debt')
      // Counted among the expensive ones only once it is known to be one.
      expect(debt(recent, -500)).toMatchObject({ met: null, unknown: 'not-on-file', value: 0 })
      expect(debt(cleared, -300)).toMatchObject({ met: true, unknown: null })
      expect(debt(carrying, -2000)).toMatchObject({ met: false, unknown: null, value: 1 })
      expect(debt(recent, -500, { carriesCardBalance: false })).toMatchObject({ met: true })
      expect(debt(recent, -500, { carriesCardBalance: true })).toMatchObject({ met: false })
    })
  })
})

describe('invested money', () => {
  it('is the investment accounts or the portfolio, whichever holds more, and savings elsewhere', () => {
    const accounts = [
      { id: 1, type: 'ib', balance: 5000 },
      { id: 2, type: 'investment', balance: 1000 },
      { id: 3, type: 'savings', balance: 9000 },
    ]
    expect(investedOf(accounts, 3000, null)).toBe(6000)
    expect(investedOf(accounts, 7000, null)).toBe(7000)
    expect(investedOf(accounts, 7000, 2500)).toBe(9500)
    expect(investedOf(null, null, undefined)).toBe(0)
  })

  it('reads the investment accounts at their balance today', () => {
    // 1,000 into the investment account is booked for the 20th: today it holds 4,000.
    const booked = entry('2026-10-20', {
      type: 'transfer',
      amount: 1000,
      account_id: 2,
      transfer_account_id: 1,
    })
    const facts = guidanceFacts(
      input({
        transactions: [...input().transactions, booked],
        accounts: [
          { id: 1, type: 'ib', balance: 5000 },
          { id: 2, type: 'giro', balance: 500 },
        ],
      })
    )
    expect(facts.invested).toBe(4000)
    expect(facts.liquid).toBe(1500)
  })
})

describe('the savings rate (D6)', () => {
  it('counts the loan principal repaid in the window as kept, and keeps the cash figure beside it', () => {
    const loan = {
      principal: 12000,
      interest_rate: 0,
      start_date: '2025-01-01',
      term_months: 120,
      rate_periods: [],
      prepayments: [],
    }
    // At no interest, 100 of principal a month.
    expect(amortize(loan)[0].principal).toBeCloseTo(100, 6)
    const facts = guidanceFacts(input({ loans: [loan] }))
    expect(facts.principalRepaid).toBeCloseTo(100, 6)
    expect(facts.savings.cash).toBeCloseTo(50, 6)
    expect(facts.savings.withPrincipal).toBeCloseTo(55, 6)
    expect(LOAN_PRINCIPAL_IS_SAVING).toBe(true)
    expect(facts.savings.rate).toBe(facts.savings.withPrincipal)
  })

  it('counts the principal and the extra payments, not the interest', () => {
    const loan = {
      principal: 12000,
      interest_rate: 12,
      start_date: '2025-01-01',
      term_months: 60,
      rate_periods: [],
      prepayments: [{ month: 20, amount: 500 }],
    }
    const window = new Set([1, 2, 3, 4].map(ago))
    const rows = amortize(loan).filter((row) => window.has(row.date.slice(0, 7)))
    expect(rows).toHaveLength(4)
    expect(rows.some((row) => row.prepayment > 0)).toBe(true)
    const repaid = rows.reduce((sum, row) => sum + row.principal + row.prepayment, 0) / 4
    expect(guidanceFacts(input({ loans: [loan] })).principalRepaid).toBeCloseTo(repaid, 6)
    expect(repaid).toBeLessThan(
      rows.reduce((sum, row) => sum + row.payment + row.prepayment, 0) / 4
    )
  })

  it('has none without income', () => {
    const facts = guidanceFacts(
      input({ transactions: [1, 2, 3].flatMap((n) => month(ago(n), 0, 500).slice(1)) })
    )
    expect(facts.savings).toEqual({ rate: null, cash: null, withPrincipal: null })
  })
})

describe('the rest', () => {
  it('reads the withdrawal rate from the settings, 4% when none, and has no number for more than enough until given one', () => {
    expect(guidanceFacts(input()).withdrawalRatePct).toBe(4)
    expect(guidanceFacts(input({ withdrawalRatePct: 3.5 })).withdrawalRatePct).toBe(3.5)
    expect(guidanceFacts(input()).enoughPerYear).toBeNull()
    expect(guidanceFacts(input({ answers: { enoughPerYear: 80000 } })).enoughPerYear).toBe(80000)
  })
})

describe('the lines it shares with the official figures', () => {
  it('calls a debt expensive where every region’s debt-rate band turns high', () => {
    for (const region of REGIONS) {
      const high = bandsFor('debt.rate', region).find((band) => band.band === 'high')
      expect(high?.min, region).toBe(EXPENSIVE_DEBT_RATE)
    }
  })

  it('puts the first and the full cushion where every region’s cushion band turns typical and high', () => {
    for (const region of REGIONS) {
      const bands = bandsFor('cushion.months', region)
      expect(bands.find((band) => band.band === 'typical')?.min, region).toBe(FIRST_CUSHION_MONTHS)
      expect(bands.find((band) => band.band === 'high')?.min, region).toBe(FULL_CUSHION_MONTHS)
    }
  })
})
