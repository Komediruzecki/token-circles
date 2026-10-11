/**
 * The recurring-payment finder: regular payments to a payee the catalogue and the brand registry
 * have no name for, found by `detectSubscriptions` after its named match. Every payee here is
 * invented, and none of them matches a name (asserted below), so each is the finder's to find.
 */
import { describe, expect, it } from 'vitest'
import { parseDay } from '../chargePatterns'
import { findRecurringPayments, payeeKey, payeeName } from '../recurringPayments'
import { detectSubscriptions, matchMerchant, worthTracking } from '../subscriptionDetection'
import type { KindedCategory } from '../../../../shared/guidance/kinds'
import type { DetectableTransaction } from '../subscriptionDetection'

const TODAY = '2026-07-16'

const GYM = 'Kraftraum Beispielstadt'
const LANDLORD = 'Hausverwaltung Muster GmbH'
const POWER = 'Stadtwerke Beispielstadt'
const CAFE = 'Cafe Beispiel'
const DRINKS = 'Getraenkemarkt Muster'
const SAVINGS = 'Tagesgeld Beispielbank'

const CATEGORIES: KindedCategory[] = [
  { id: 1, name: 'Housing', type: 'expense', kind: 'housing', parent_id: null },
  { id: 2, name: 'Utilities', type: 'expense', kind: 'utilities', parent_id: null },
  // No kind of its own: it goes by its parent's.
  { id: 3, name: 'Strom', type: 'expense', kind: null, parent_id: 2 },
  { id: 4, name: 'Sport', type: 'expense', kind: null, parent_id: null },
  { id: 5, name: 'Sonstiges', type: 'expense', kind: null, parent_id: null },
  // Where the bank import files a transfer whose other account it could not tell.
  { id: 8, name: 'Transfers', type: 'expense', kind: null, parent_id: null },
  { id: 9, name: 'Savings', type: 'account', kind: null, parent_id: null },
]

/** A payment to `payee` on `date`, as a bank statement imports one. */
function paid(
  payee: string,
  amount: number,
  date: string,
  extra: Partial<DetectableTransaction> = {}
): DetectableTransaction {
  return {
    beneficiary: payee,
    description: `SEPA-LASTSCHRIFT REF ${date.replaceAll('-', '')}`,
    amount: -amount,
    date,
    type: 'expense',
    currency: 'EUR',
    ...extra,
  }
}

/** The day `days` before TODAY. */
function daysAgo(days: number): string {
  return new Date(parseDay(TODAY) - days * 86_400_000).toISOString().slice(0, 10)
}

function detect(transactions: DetectableTransaction[], bills: { name: string }[] = []) {
  return detectSubscriptions(transactions, bills, { today: TODAY, categories: CATEGORIES })
}

describe('the payees here', () => {
  it('match no name in the catalogue or the brand registry', () => {
    for (const payee of [GYM, LANDLORD, POWER, CAFE, DRINKS, SAVINGS]) {
      expect(matchMerchant(`SEPA-LASTSCHRIFT REF 20260701 ${payee}`), payee).toBeNull()
    }
  })
})

describe('a gym it has no name for', () => {
  it('at four monthly charges, is a likely regular payment, ticked', () => {
    const found = detect(
      ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((day) => paid(GYM, 29.9, day))
    )
    expect(found).toHaveLength(1)
    const [gym] = found
    expect(gym).toMatchObject({
      key: 'recurring:kraftraum beispielstadt',
      name: GYM,
      amount: 29.9,
      currency: 'EUR',
      frequency: 'monthly',
      confidence: 'medium',
      occurrences: 4,
      firstDate: '2026-04-01',
      lastDate: '2026-07-01',
      suggestedDueDate: '2026-08-01',
      categoryHints: [],
      alreadyTracked: false,
      matchedVia: 'recurring',
      billType: 'subscription',
    })
    expect(gym.sampleDescriptions).toEqual([
      'SEPA-LASTSCHRIFT REF 20260501',
      'SEPA-LASTSCHRIFT REF 20260601',
      'SEPA-LASTSCHRIFT REF 20260701',
    ])
    expect(worthTracking(gym)).toBe(true)
  })

  it('at three, is a guess, left unticked', () => {
    const [gym] = detect(['2026-05-01', '2026-06-01', '2026-07-01'].map((d) => paid(GYM, 29.9, d)))
    expect(gym.confidence).toBe('low')
    expect(gym.occurrences).toBe(3)
    expect(worthTracking(gym)).toBe(false)
  })

  it('at two, is nothing yet', () => {
    expect(detect(['2026-06-01', '2026-07-01'].map((d) => paid(GYM, 29.9, d)))).toEqual([])
  })

  it('is found weekly too', () => {
    const found = detect([2, 9, 16, 23].map((days) => paid(GYM, 12, daysAgo(days))))
    expect(found.map((f) => [f.name, f.frequency, f.confidence])).toEqual([
      [GYM, 'weekly', 'medium'],
    ])
  })

  it('keeps going through a paused month', () => {
    // No charge in May: one gap of two months among four of one.
    const found = detect(
      ['2026-02-01', '2026-03-01', '2026-04-01', '2026-06-01', '2026-07-01'].map((d) =>
        paid(GYM, 29.9, d)
      )
    )
    expect(found.map((f) => [f.name, f.frequency, f.occurrences])).toEqual([[GYM, 'monthly', 5]])
  })

  it('is not proposed once its last charge is more than one and a half periods old', () => {
    // Monthly, so 45 days: 1 June is 45 days before 16 July, 31 May is 46.
    const running = ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']
    const stopped = ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']
    expect(detect(running.map((d) => paid(GYM, 29.9, d)))).toHaveLength(1)
    expect(detect(stopped.map((d) => paid(GYM, 29.9, d)))).toEqual([])
  })

  it('is already tracked by a bill under its name', () => {
    const charges = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d) =>
      paid(GYM, 29.9, d)
    )
    const [gym] = detect(charges, [{ name: 'KRAFTRAUM Beispielstadt 2' }])
    expect(gym.alreadyTracked).toBe(true)
    expect(worthTracking(gym)).toBe(false)
  })
})

describe('amounts', () => {
  it('that drift a little are one payment, at the latest amount', () => {
    const found = detect([
      paid(POWER, 61.2, '2026-04-01'),
      paid(POWER, 59.8, '2026-05-01'),
      paid(POWER, 62.4, '2026-06-01'),
      paid(POWER, 60.9, '2026-07-01'),
    ])
    expect(found.map((f) => [f.name, f.amount, f.occurrences])).toEqual([[POWER, 60.9, 4]])
  })

  it('that wander, even on a steady day of the month, are not', () => {
    const found = detect([
      paid(DRINKS, 18.4, '2026-04-01'),
      paid(DRINKS, 31.75, '2026-05-01'),
      paid(DRINKS, 24.1, '2026-06-01'),
      paid(DRINKS, 40.6, '2026-07-01'),
    ])
    expect(found).toEqual([])
  })

  it('that keep to one price on random days are everyday shopping, not a regular payment', () => {
    // A coffee at one price: the median gap is a week, but most gaps are not.
    const days = [2, 6, 13, 23, 26, 32, 40, 45, 57, 61, 70, 73]
    expect(detect(days.map((d) => paid(CAFE, 3.6, daysAgo(d))))).toEqual([])
  })
})

describe('transfers', () => {
  const monthly = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']

  it('between accounts are not payments', () => {
    const found = detect(monthly.map((d) => paid(SAVINGS, 200, d, { type: 'transfer' })))
    expect(found).toEqual([])
  })

  it('filed under an account category, or under Transfers, are not payments either', () => {
    expect(detect(monthly.map((d) => paid(SAVINGS, 200, d, { category_id: 9 })))).toEqual([])
    expect(detect(monthly.map((d) => paid(SAVINGS, 200, d, { category_id: 8 })))).toEqual([])
    // Filed under anything else, the same payments are one.
    expect(detect(monthly.map((d) => paid(SAVINGS, 200, d, { category_id: 5 })))).toHaveLength(1)
  })
})

describe('no payment found twice', () => {
  it('reads what no name matched, and nothing else', () => {
    const found = detect([
      ...['2026-04-14', '2026-05-14', '2026-06-14', '2026-07-14'].map((d) =>
        paid('NETFLIX.COM', 13.99, d)
      ),
      ...['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d) => paid(GYM, 29.9, d)),
    ])
    expect(found.map((f) => [f.name, f.matchedVia, f.occurrences])).toEqual([
      ['Netflix', 'catalog', 4],
      [GYM, 'recurring', 4],
    ])
  })

  it('leaves the charges a name matched with that name, though the payee is the same', () => {
    // Two of the gym's charges say "Fitness", which the catalogue's gym membership matches.
    const found = detect([
      paid(GYM, 29.9, '2026-04-01', { description: 'Fitness Abo April' }),
      paid(GYM, 29.9, '2026-05-01', { description: 'Fitness Abo Mai' }),
      paid(GYM, 29.9, '2026-06-01'),
      paid(GYM, 29.9, '2026-07-01'),
    ])
    expect(found.map((f) => [f.name, f.matchedVia, f.occurrences])).toEqual([
      ['Gym membership', 'catalog', 2],
    ])
  })
})

describe('a bill or a subscription', () => {
  const monthly = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']

  it('is a bill for a home, with the category its charges are filed under', () => {
    const [rent] = detect(monthly.map((d) => paid(LANDLORD, 850, d, { category_id: 1 })))
    expect(rent).toMatchObject({ name: LANDLORD, billType: 'bill', categoryId: 1 })
  })

  it('goes by the kind a category takes from its parent', () => {
    const [power] = detect(monthly.map((d) => paid(POWER, 61, d, { category_id: 3 })))
    expect(power).toMatchObject({ billType: 'bill', categoryId: 3 })
  })

  it('is a subscription for any other kind, and for no category at all', () => {
    const [gym] = detect(monthly.map((d) => paid(GYM, 29.9, d, { category_id: 4 })))
    expect(gym).toMatchObject({ billType: 'subscription', categoryId: 4 })
    const [loose] = detect(monthly.map((d) => paid(GYM, 29.9, d)))
    expect(loose.billType).toBe('subscription')
    expect(loose).not.toHaveProperty('categoryId')
  })

  it('takes the category most of its charges are filed under', () => {
    const ids = [1, 1, 1, 5]
    const [rent] = detect(monthly.map((d, i) => paid(LANDLORD, 850, d, { category_id: ids[i] })))
    expect(rent).toMatchObject({ billType: 'bill', categoryId: 1 })
  })

  it('of two categories as common, takes the later charges', () => {
    const ids = [1, 1, 5, 5]
    const [rent] = detect(monthly.map((d, i) => paid(LANDLORD, 850, d, { category_id: ids[i] })))
    expect(rent).toMatchObject({ billType: 'subscription', categoryId: 5 })
  })
})

describe('the payee', () => {
  it('is the description when the entry names no beneficiary, without its numbers', () => {
    const found = detect(
      ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d, i) =>
        paid('', 29.9, d, { description: `LASTSCHRIFT KRAFTRAUM KD-NR 4711 REF 99${String(i)}` })
      )
    )
    expect(found.map((f) => [f.key, f.name])).toEqual([
      ['recurring:lastschrift kraftraum kd nr ref', 'LASTSCHRIFT KRAFTRAUM KD-NR REF'],
    ])
  })

  it('keys ignore case, accents, punctuation and digits', () => {
    expect(payeeKey('Café Müller GmbH, Filiale 12')).toBe('cafe muller gmbh filiale')
    expect(payeeKey('CAFE MULLER GMBH FILIALE 7')).toBe('cafe muller gmbh filiale')
    expect(payeeKey('4711 0815')).toBe('')
  })

  it('names are cut at a word, to sixty characters', () => {
    const long = 'Wohnungsbaugenossenschaft Beispielstadt Mitte eingetragene Genossenschaft'
    expect(payeeName(long)).toBe('Wohnungsbaugenossenschaft Beispielstadt Mitte eingetragene')
    expect(payeeName('A'.repeat(70))).toBe('A'.repeat(60))
    expect(payeeName('123 456')).toBe('123 456')
  })

  it('with nothing to key by, is skipped', () => {
    const found = findRecurringPayments(
      ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d) =>
        paid('', 10, d, { description: '0815 4711' })
      ),
      [],
      { todayMs: parseDay(TODAY) }
    )
    expect(found).toEqual([])
  })
})
