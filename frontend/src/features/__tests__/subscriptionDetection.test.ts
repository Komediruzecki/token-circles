import { describe, expect, it } from 'vitest'
import {
  cadenceFromGapDays,
  detectSubscriptions,
  editDistance,
  matchMerchant,
  normalizeMerchantText,
} from '../subscriptionDetection'
import type { DetectableTransaction } from '../subscriptionDetection'

const TODAY = '2026-07-16'

/** Expense transaction with statement-ish text. */
function txn(
  description: string,
  amount: number,
  date: string,
  extra: Partial<DetectableTransaction> = {}
): DetectableTransaction {
  return { description, amount, date, type: 'expense', currency: 'EUR', ...extra }
}

function detect(txns: DetectableTransaction[], bills: { name: string }[] = []) {
  return detectSubscriptions(txns, bills, { today: TODAY })
}

describe('normalizeMerchantText', () => {
  it('lowercases, strips punctuation and diacritics, collapses whitespace', () => {
    expect(normalizeMerchantText('NETFLIX.COM  *Amsterdam')).toBe('netflix com amsterdam')
    expect(normalizeMerchantText('CAFÉ Zürich')).toBe('cafe zurich')
    expect(normalizeMerchantText('GOOGLE *Google One')).toBe('google google one')
  })
})

describe('editDistance', () => {
  it('computes small edit distances', () => {
    expect(editDistance('netflix', 'netflix')).toBe(0)
    expect(editDistance('netflx', 'netflix')).toBe(1)
    expect(editDistance('spotefy', 'spotify')).toBe(1)
    expect(editDistance('amazon', 'amzn')).toBe(2)
  })
})

describe('matchMerchant', () => {
  const cases: [string, string | null][] = [
    ['NETFLIX.COM AMSTERDAM', 'Netflix'],
    ['NETFLX COM', 'Netflix'], // one-letter typo still matches
    ['Spotify P0FF8B1C34', 'Spotify'],
    ['GOOGLE *GOOGLE ONE g.co/helppay#', 'Google One'], // catalog phrase beats bare brand
    ['CLAUDE.AI SUBSCRIPTION', 'Claude'],
    ['ANTHROPIC, PBC', 'Claude'], // brand alias resolves to the Claude identity
    ['To YouTube Premium', 'YouTube Premium'],
    ['HBO MAX MONTH', 'HBO Max'],
    ['MAXIMA MARKET ZAGREB', null], // bare "max" must not substring-match
    ['KONZUM ZAGREB 042', null],
    ['1PASSWORD.COM', '1Password'],
  ]
  for (const [text, expected] of cases) {
    it(`resolves "${text}" -> ${expected}`, () => {
      expect(matchMerchant(text)?.name ?? null).toBe(expected)
    })
  }
})

describe('cadenceFromGapDays', () => {
  it('buckets gaps into frequencies', () => {
    expect(cadenceFromGapDays(7)).toBe('weekly')
    expect(cadenceFromGapDays(14)).toBe('biweekly')
    expect(cadenceFromGapDays(30)).toBe('monthly')
    expect(cadenceFromGapDays(28)).toBe('monthly')
    expect(cadenceFromGapDays(365)).toBe('yearly')
    expect(cadenceFromGapDays(55)).toBeNull()
    expect(cadenceFromGapDays(3)).toBeNull()
  })
})

describe('detectSubscriptions', () => {
  it('detects a stable monthly charge with high confidence and the right cadence', () => {
    const result = detect([
      txn('NETFLIX.COM', 13.99, '2026-04-14'),
      txn('NETFLIX.COM', 13.99, '2026-05-14'),
      txn('NETFLIX.COM', 13.99, '2026-06-14'),
    ])
    expect(result).toHaveLength(1)
    const netflix = result[0]
    expect(netflix.name).toBe('Netflix')
    expect(netflix.frequency).toBe('monthly')
    expect(netflix.confidence).toBe('high')
    expect(netflix.amount).toBeCloseTo(13.99, 2)
    expect(netflix.occurrences).toBe(3)
    expect(netflix.matchedPlan?.price).toBeCloseTo(13.99, 2)
    expect(netflix.suggestedDueDate).toBe('2026-07-14' < TODAY ? '2026-08-14' : '2026-07-14')
    expect(netflix.alreadyTracked).toBe(false)
  })

  it('proposes a single charge that exactly matches a catalogue plan (Claude Pro)', () => {
    const result = detect([txn('CLAUDE.AI SUBSCRIPTION ANTHROPIC', 18.0, '2026-07-02')])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Claude')
    expect(result[0].confidence).toBe('medium')
    expect(result[0].frequency).toBe('monthly')
    expect(result[0].matchedPlan?.label).toBe('Pro')
    expect(result[0].suggestedDueDate).toBe('2026-08-02')
  })

  it('ignores merchants that match nothing', () => {
    expect(detect([txn('KONZUM ZAGREB', 45.12, '2026-07-01')])).toEqual([])
  })

  it('drops a one-off charge matched only via an ambiguous retailer token', () => {
    expect(detect([txn('AMAZON.DE ORDER 402-99', 63.49, '2026-06-21')])).toEqual([])
  })

  it('drops repeated ambiguous-token charges when amounts vary (shopping, not a plan)', () => {
    const result = detect([
      txn('AMAZON.DE 402-1', 63.49, '2026-04-03'),
      txn('AMAZON.DE 402-2', 12.0, '2026-05-11'),
      txn('AMAZON.DE 402-3', 129.9, '2026-06-27'),
    ])
    expect(result).toEqual([])
  })

  it('detects a real Prime cadence hidden among Amazon shopping', () => {
    const result = detect([
      txn('AMAZON PRIME*2B4', 8.99, '2026-04-05'),
      txn('AMAZON.DE ORDER', 63.49, '2026-04-19'),
      txn('AMAZON PRIME*9K1', 8.99, '2026-05-05'),
      txn('AMAZON.DE ORDER', 24.9, '2026-05-22'),
      txn('AMAZON PRIME*3P8', 8.99, '2026-06-05'),
    ])
    expect(result).toHaveLength(1)
    const prime = result[0]
    expect(prime.name).toBe('Amazon Prime')
    expect(prime.amount).toBeCloseTo(8.99, 2)
    expect(prime.frequency).toBe('monthly')
    expect(prime.occurrences).toBe(3)
    expect(prime.confidence).toBe('high')
  })

  it('follows a price change once the new price has recurred', () => {
    const result = detect([
      txn('SPOTIFY', 10.99, '2026-01-03'),
      txn('SPOTIFY', 10.99, '2026-02-03'),
      txn('SPOTIFY', 10.99, '2026-03-03'),
      txn('SPOTIFY', 11.99, '2026-04-03'),
      txn('SPOTIFY', 11.99, '2026-05-03'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].amount).toBeCloseTo(11.99, 2)
    expect(result[0].name).toBe('Spotify')
  })

  it('detects weekly and yearly cadences', () => {
    const result = detect([
      txn('STRAVA MEMBERSHIP', 11.99, '2025-07-10'),
      txn('STRAVA MEMBERSHIP', 11.99, '2026-07-10'),
      txn('PELOTON APP', 3.0, '2026-06-24'),
      txn('PELOTON APP', 3.0, '2026-07-01'),
      txn('PELOTON APP', 3.0, '2026-07-08'),
    ])
    const strava = result.find((r) => r.name === 'Strava')
    const peloton = result.find((r) => r.name === 'Peloton')
    expect(strava?.frequency).toBe('yearly')
    expect(peloton?.frequency).toBe('weekly')
  })

  it('rolls the suggested due date forward to today or later', () => {
    const result = detect([
      txn('NETFLIX.COM', 13.99, '2026-03-10'),
      txn('NETFLIX.COM', 13.99, '2026-04-10'),
    ])
    // Last charge 2026-04-10 monthly -> 05-10, 06-10, 07-10 all before TODAY (07-16)
    expect(result[0].suggestedDueDate).toBe('2026-08-10')
  })

  it('marks identities that already have a bill/subscription as tracked and sorts them last', () => {
    const result = detect(
      [
        txn('NETFLIX.COM', 13.99, '2026-05-14'),
        txn('NETFLIX.COM', 13.99, '2026-06-14'),
        txn('SPOTIFY', 11.99, '2026-06-01'),
        txn('SPOTIFY', 11.99, '2026-07-01'),
      ],
      [{ name: 'Netflix Premium' }]
    )
    const netflix = result.find((r) => r.name === 'Netflix')
    const spotify = result.find((r) => r.name === 'Spotify')
    expect(netflix?.alreadyTracked).toBe(true)
    expect(spotify?.alreadyTracked).toBe(false)
    expect(result[result.length - 1].name).toBe('Netflix')
  })

  it('only considers expenses (type field or negative amount)', () => {
    const result = detect([
      txn('NETFLIX REFUND', 13.99, '2026-06-20', { type: 'income' }),
      txn('NETFLIX.COM', -13.99, '2026-06-14', { type: null }),
      txn('NETFLIX.COM', 13.99, '2026-05-14', { type: undefined, amount: -13.99 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].occurrences).toBe(2)
    expect(result[0].amount).toBeCloseTo(13.99, 2)
  })

  it('reads merchant text from beneficiary/payor fields too', () => {
    const result = detect([
      txn('Card payment', 12.99, '2026-06-03', { beneficiary: 'YouTube Premium' }),
      txn('Card payment', 12.99, '2026-07-03', { beneficiary: 'YouTube Premium' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('YouTube Premium')
    expect(result[0].confidence).toBe('high') // 2 stable occurrences + exact plan price
  })

  it('picks the dominant currency and surfaces sample descriptions', () => {
    const result = detect([
      txn('SPOTIFY', 11.99, '2026-05-01', { currency: 'USD' }),
      txn('SPOTIFY', 11.99, '2026-06-01', { currency: 'EUR' }),
      txn('SPOTIFY', 11.99, '2026-07-01', { currency: 'EUR' }),
    ])
    expect(result[0].currency).toBe('EUR')
    expect(result[0].sampleDescriptions).toContain('SPOTIFY')
  })

  it('requires recurrence for generic catalogue aliases like gym', () => {
    expect(detect([txn('FITLIFE GYM ZAGREB', 29.99, '2026-06-04')])).toEqual([])
    const recurring = detect([
      txn('FITLIFE GYM ZAGREB', 29.99, '2026-05-04'),
      txn('FITLIFE GYM ZAGREB', 29.99, '2026-06-04'),
      txn('FITLIFE GYM ZAGREB', 29.99, '2026-07-04'),
    ])
    expect(recurring).toHaveLength(1)
    expect(recurring[0].name).toBe('Gym membership')
    expect(recurring[0].confidence).toBe('high')
  })

  it('handles the statement wordings from the bank import pipeline', () => {
    // Revolut-style "To <merchant>" descriptions
    const result = detect([
      txn('To Netflix', 13.99, '2026-05-14'),
      txn('To Netflix', 13.99, '2026-06-14'),
      txn('To Google One', 1.99, '2026-06-20'),
    ])
    expect(result.map((r) => r.name).sort()).toEqual(['Google One', 'Netflix'])
    const gone = result.find((r) => r.name === 'Google One')
    expect(gone?.matchedPlan?.label).toBe('Basic')
    expect(gone?.confidence).toBe('medium') // single charge but exact plan price
  })

  it('returns an empty list for empty input', () => {
    expect(detect([])).toEqual([])
  })
})
