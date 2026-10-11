/**
 * The words for the space questions and the region a profile is compared with: the questions as
 * guidance.md section 5.5 writes them, and how the region was set (shared/guidance/region.ts).
 */
import type { RegionAnswer } from '../../../../shared/guidance/answers'
import type { Region, RegionChoice } from '../../../../shared/guidance/region'

export const REGION_QUESTION = 'Where do you live?'
export const REGION_WHY = 'We compare your numbers with official statistics for that place.'
export const HOUSEHOLD_QUESTION = 'Who does this space cover?'

/** The answers to "Where do you live?", in the question's order. */
export const REGION_CHOICES: readonly { value: Exclude<RegionAnswer, 'skipped'>; label: string }[] =
  [
    { value: 'DE', label: 'Germany' },
    { value: 'HR', label: 'Croatia' },
    { value: 'EU27', label: 'Another EU country' },
    { value: 'UK', label: 'United Kingdom' },
    { value: 'US', label: 'United States' },
    { value: 'elsewhere', label: 'Somewhere else' },
  ]

/** The answers to "Who does this space cover?": 3 stands for three or more. */
export const ADULT_CHOICES: readonly { value: number; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 or more' },
]
export const CHILD_CHOICES: readonly { value: number; label: string }[] = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 or more' },
]

/** The choice a stored count falls under: three and more are "3 or more". */
export function countChoice(count: number | undefined): number | undefined {
  return count === undefined ? undefined : Math.min(count, 3)
}

const REGION_NAMES: Record<Region, string> = {
  DE: 'Germany',
  HR: 'Croatia',
  EU27: 'the EU average',
  UK: 'the United Kingdom',
  US: 'the United States',
}

/** The banks whose statements say where a person lives, as their statements name them. */
const BANK_NAMES: Readonly<Record<string, string>> = {
  dkb: 'DKB',
  sparkasse: 'Sparkasse',
  erste: 'Erste',
  pbz: 'PBZ',
  ing: 'ING',
}

/** How the region was set, in one sentence. */
export function regionReasonText(choice: RegionChoice): string {
  const name = REGION_NAMES[choice.region]
  switch (choice.reason) {
    case 'answer':
      return `Compared with ${name}, from your answer.`
    case 'elsewhere':
      return 'Compared with the EU average. Token Circles has figures for Germany, Croatia, the EU, the United Kingdom and the United States.'
    case 'bank':
      return `Compared with ${name}, going by your ${BANK_NAMES[choice.via ?? ''] ?? String(choice.via)} statements.`
    case 'currency':
      return `Compared with ${name}, going by your base currency, ${String(choice.via)}.`
    case 'fallback':
      return 'Compared with the EU average, as nothing yet says where you live.'
  }
}
