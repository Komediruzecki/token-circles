/**
 * The words for the space questions and the region a profile is compared with: the questions as
 * guidance.md section 5.5 writes them, and how the region was set (shared/guidance/region.ts).
 */
import type { RegionAnswer } from '../../../../shared/guidance/answers'
import type { Region, RegionChoice } from '../../../../shared/guidance/region'

/**
 * Every word here waits behind the benchmarks gate (core/guidanceGate.ts), and a build with the
 * gate closed compiles it out: vite.config.ts defines __BENCHMARKS_SHOWN__ by the gate's own test.
 * Where nothing defines it (tests), the copy is there.
 */
declare const __BENCHMARKS_SHOWN__: boolean | undefined
const HELD_BACK_COPY = typeof __BENCHMARKS_SHOWN__ === 'undefined' || __BENCHMARKS_SHOWN__

export const REGION_QUESTION = HELD_BACK_COPY ? 'Where do you live?' : ''
export const REGION_WHY = HELD_BACK_COPY
  ? 'We compare your numbers with official statistics for that place.'
  : ''
export const HOUSEHOLD_QUESTION = HELD_BACK_COPY ? 'Who does this space cover?' : ''

/** The answers to "Where do you live?", in the question's order. */
export const REGION_CHOICES: readonly { value: Exclude<RegionAnswer, 'skipped'>; label: string }[] =
  HELD_BACK_COPY
    ? [
        { value: 'DE', label: 'Germany' },
        { value: 'HR', label: 'Croatia' },
        { value: 'EU27', label: 'Another EU country' },
        { value: 'UK', label: 'United Kingdom' },
        { value: 'US', label: 'United States' },
        { value: 'elsewhere', label: 'Somewhere else' },
      ]
    : []

/**
 * The answers to "Who does this space cover?": 3 stands for three or more. `short` is the chip's
 * text where a row has no room for the label (setup's About this space on a phone); the label
 * stays its accessible name.
 */
export const ADULT_CHOICES: readonly { value: number; label: string; short?: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 or more', short: '3+' },
]
export const CHILD_CHOICES: readonly { value: number; label: string; short?: string }[] = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 or more', short: '3+' },
]

/** The choice a stored count falls under: three and more are "3 or more". */
export function countChoice(count: number | undefined): number | undefined {
  return count === undefined ? undefined : Math.min(count, 3)
}

function adultsText(count: number): string {
  if (count >= 3) return '3 or more adults'
  return count === 1 ? '1 adult' : `${count} adults`
}

function childrenText(count: number): string {
  if (count >= 3) return '3 or more children'
  if (count === 0) return 'no children'
  return count === 1 ? '1 child' : `${count} children`
}

/**
 * The household answers as a status line, in the chips' words: "1 adult, no children.", "2
 * adults. Children not answered yet.", or "Not answered yet." with neither.
 */
export function householdText(adults: number | undefined, children: number | undefined): string {
  if (!HELD_BACK_COPY) return ''
  const a = countChoice(adults)
  const c = countChoice(children)
  if (a === undefined && c === undefined) return 'Not answered yet.'
  if (c === undefined) return `${adultsText(a!)}. Children not answered yet.`
  const kids = childrenText(c)
  if (a === undefined) return `Adults not answered yet. ${kids[0].toUpperCase()}${kids.slice(1)}.`
  return `${adultsText(a)}, ${kids}.`
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
  if (!HELD_BACK_COPY) return ''
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
