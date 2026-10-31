/**
 * The Prints section's words (phase 4 design, section 9), kept apart from the component so each
 * line is tested as written. Months are named in English, as the advice cards name them, because
 * they sit inside English sentences.
 */
import { addMonths } from '../achievements/months'
import type { SealWords } from '../../../../shared/prints/describe'
import type { PrintView, ShelfView } from './shelf'

export const printWords: SealWords = {
  monthName: (month) =>
    new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
}

const monthName = printWords.monthName

const COUNT = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
]

export const DIVIDER_META = 'One for every twelve months in a row'
export const FIRST_EYEBROW = 'Your first print'
export const EMPTY_LINE =
  'It fills in here, one petal for each month you track. A month counts once it holds three entries.'
export const LEGEND =
  'Read it like a clock, from the top: one petal for each month, longer the more that month spent. The woven band swells where a month kept money and turns copper where it spent more than came in.'
export const SHAPE_LINE = 'Only the shape of your year is on it.'
export const NEXT_HEADING = 'Next print'
export const EVERY_HEADING = 'Every print'
export const READOUT_IDLE = 'Tap a petal to see its month.'
export const MONTHS_HEADING = 'Month by month'

/** The eyebrow over a finished print: the first one by name, the rest by number. */
export const printEyebrow = (k: number): string => (k === 1 ? FIRST_EYEBROW : `Print ${k}`)

/** "October 2025 to September 2026": a print's twelve months. */
export const periodOf = (print: Pick<PrintView, 'from'>): string =>
  `${monthName(print.from)} to ${monthName(addMonths(print.from, 11))}`

export const thumbLabel = (print: Pick<PrintView, 'from'>): string =>
  `Show the print for ${periodOf(print)}`

/** "6 of 12 months", and where a run that stopped got to. */
export function plateTitle(plate: PrintView, view: ShelfView): string {
  const count = `${plate.months} of 12 months`
  return view.live ? count : `${count}, up to ${monthName(addMonths(plate.from, plate.months - 1))}`
}

/** "September 2026 has 2 entries; a month counts once it holds three." */
export function gapLine(gap: NonNullable<ShelfView['gap']>): string {
  const held =
    gap.entries === 0
      ? 'no entries yet'
      : `${gap.entries} ${gap.entries === 1 ? 'entry' : 'entries'}`
  return `${monthName(gap.month)} has ${held}; a month counts once it holds three.`
}

/**
 * The line under the plate's count: how many more months finish it while its run is going, or
 * which month stopped the run.
 */
export function plateLine(plate: PrintView, view: ShelfView): string | null {
  if (!view.live) return view.gap ? gapLine(view.gap) : null
  const left = 12 - plate.months
  return left === 1
    ? 'One more tracked month finishes it.'
    : `${COUNT[left]} more tracked months in a row finish it.`
}

/** The next plate before any month is on it. */
export function nextStart(plate: PrintView, view: ShelfView): string {
  return view.live
    ? `Starts with ${monthName(plate.from)}.`
    : 'Starts with your next tracked month.'
}

export const runningLine = (month: string): string =>
  `${monthName(month)} is still running, so its petal can still change.`

/** Whether `month` is one of the months on a print or plate. */
export const holdsMonth = (print: PrintView, month: string | null): boolean =>
  month !== null && month >= print.from && month <= addMonths(print.from, print.months - 1)
