/**
 * The words for how a region was set (components/guidance/regionWords.ts), one sentence for each
 * way, the household choices a stored count falls under, and the household answers as a status
 * line.
 */
import { describe, expect, it } from 'vitest'
import { countChoice, householdText, regionReasonText } from '../regionWords'
import type { RegionChoice } from '../../../../../shared/guidance/region'

describe('how the region was set', () => {
  it.each<[RegionChoice, string]>([
    [{ region: 'DE', reason: 'answer', via: null }, 'Compared with Germany, from your answer.'],
    [
      { region: 'EU27', reason: 'answer', via: null },
      'Compared with the EU average, from your answer.',
    ],
    [
      { region: 'EU27', reason: 'elsewhere', via: null },
      'Compared with the EU average. Token Circles has figures for Germany, Croatia, the EU, the United Kingdom and the United States.',
    ],
    [
      { region: 'DE', reason: 'bank', via: 'dkb' },
      'Compared with Germany, going by your DKB statements.',
    ],
    [
      { region: 'HR', reason: 'bank', via: 'pbz' },
      'Compared with Croatia, going by your PBZ statements.',
    ],
    [
      { region: 'EU27', reason: 'bank', via: 'ing' },
      'Compared with the EU average, going by your ING statements.',
    ],
    [
      { region: 'US', reason: 'currency', via: 'USD' },
      'Compared with the United States, going by your base currency, USD.',
    ],
    [
      { region: 'EU27', reason: 'fallback', via: null },
      'Compared with the EU average, as nothing yet says where you live.',
    ],
  ])('%j', (choice, words) => {
    expect(regionReasonText(choice)).toBe(words)
  })
})

describe('the household choice a stored count falls under', () => {
  it('is the count up to three, and "3 or more" above it', () => {
    expect([undefined, 0, 1, 2, 3, 4, 9].map(countChoice)).toEqual([undefined, 0, 1, 2, 3, 3, 3])
  })
})

describe('the household answers as a status line', () => {
  it.each<[number | undefined, number | undefined, string]>([
    [undefined, undefined, 'Not answered yet.'],
    [1, 0, '1 adult, no children.'],
    [2, 1, '2 adults, 1 child.'],
    [1, 2, '1 adult, 2 children.'],
    [3, 3, '3 or more adults, 3 or more children.'],
    // A count above three, as an older or another client may store it, reads as its chip.
    [5, 7, '3 or more adults, 3 or more children.'],
    [2, undefined, '2 adults. Children not answered yet.'],
    [1, undefined, '1 adult. Children not answered yet.'],
    [undefined, 1, 'Adults not answered yet. 1 child.'],
    [undefined, 0, 'Adults not answered yet. No children.'],
    [undefined, 3, 'Adults not answered yet. 3 or more children.'],
  ])('adults %s, children %s', (adults, children, words) => {
    expect(householdText(adults, children)).toBe(words)
  })
})
