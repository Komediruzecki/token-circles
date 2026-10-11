/**
 * The words for how a region was set (components/guidance/regionWords.ts), one sentence for each
 * way, and the household choices a stored count falls under.
 */
import { describe, expect, it } from 'vitest'
import { countChoice, regionReasonText } from '../regionWords'
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
