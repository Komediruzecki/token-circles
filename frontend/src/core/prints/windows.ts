/**
 * Which months make each print, from the tracked months alone (core/prints/shelf.ts tells the
 * whole story). Kept apart from the drawing and the money, so the badges' store can count prints
 * for its toasts without loading either.
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
