/**
 * Which months make each print, and the plate being engraved: worked out from the tracked months
 * alone, the set the badges read (`evaluation.trackedMonths`, shared/trackedMonths.ts), so the
 * first print and the "A year" badge always name the same twelve months.
 *
 * A print is twelve tracked months in a row. Each run of consecutive tracked months is cut into
 * twelves from its first month; every whole twelve is a print, oldest first. The plate is the
 * newest run's months after its last whole twelve: the next print, filling in.
 *
 * Nothing here is stored. Prints are drawn from the data each time (design.md section 4), so an
 * edit to a month redraws its print, and a month that stops being tracked takes its print with it.
 */
import { addMonths, runs } from '../achievements/months'

/** Months in a print. */
export const PRINT_MONTHS = 12

/** Twelve months from `from`, of which the first `months` are on the seal. */
export interface PrintWindow {
  /** 'YYYY-MM', the month at twelve o'clock. */
  from: string
  /** How many months, from `from` on, are engraved: 12 for a print, 0 to 11 for the plate. */
  months: number
}

export interface Shelf {
  /** Complete prints, oldest first. */
  prints: PrintWindow[]
  /** The next print so far, or null before any month is tracked. */
  plate: PrintWindow | null
  /** The newest tracked month, or null. */
  last: string | null
}

export function shelfOf(tracked: Iterable<string>): Shelf {
  const all = runs(tracked)
  const prints: PrintWindow[] = []
  for (const run of all) {
    for (let k = 0; k + PRINT_MONTHS <= run.length; k += PRINT_MONTHS) {
      prints.push({ from: addMonths(run.start, k), months: PRINT_MONTHS })
    }
  }
  const newest = all[all.length - 1]
  if (!newest) return { prints, plate: null, last: null }
  const whole = newest.length - (newest.length % PRINT_MONTHS)
  return {
    prints,
    plate: { from: addMonths(newest.start, whole), months: newest.length % PRINT_MONTHS },
    last: addMonths(newest.start, newest.length - 1),
  }
}

/** The month in slot `i` of a window. */
export const slotMonth = (w: PrintWindow, i: number): string => addMonths(w.from, i)
