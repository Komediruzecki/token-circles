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
 *
 * `shelfView` is what the Prints section on Progress draws from: each print's months as seal
 * shares (shared/prints/shares.ts) and never an amount, so nothing past this module holds one.
 */
import { flowsOf, savedOf } from '../../../../shared/guidance/flows'
import { SEAL_SLOTS } from '../../../../shared/prints/seal'
import { sealShares } from '../../../../shared/prints/shares'
import { baseAmount } from '../achievements/evaluate'
import { addMonths } from '../achievements/months'
import { shelfOf, slotMonth } from './windows'
import type { SealSlot } from '../../../../shared/prints/seal'
import type { MonthMoney } from '../../../../shared/prints/shares'
import type { Tx } from '../achievements/evaluate'
import type { PrintWindow } from './windows'

export { PRINT_MONTHS, shelfOf, slotMonth } from './windows'
export type { PrintWindow, Shelf } from './windows'

/** A print or the plate as the shelf shows it: its months and their shares, never an amount. */
export interface PrintView {
  /** 'YYYY-MM', the month at twelve o'clock. */
  from: string
  /** How many months, from `from` on, are on the seal: 12 for a print, 0 to 11 for the plate. */
  months: number
  /** Twelve slots of shares; a month not on the seal yet is null. */
  slots: SealSlot[]
}

export interface ShelfView {
  /** Complete prints, oldest first. */
  prints: PrintView[]
  /** The next print so far, or null before any month is tracked. */
  plate: PrintView | null
  /** The newest run ends this month or last, so the plate grows without a month being filled in. */
  live: boolean
  /** The month after a newest run that is not live, and how many entries it holds. */
  gap: { month: string; entries: number } | null
  /** This month, once it is tracked: it is still running, so its petal can still change. */
  running: string | null
}

export interface ShelfInput {
  /** The active profile's entries (the badges' snapshot). Only these fields are read. */
  transactions: Array<Pick<Tx, 'date' | 'type' | 'amount' | 'amount_local'>>
  /** The tracked months the badges read (`evaluation.trackedMonths`). */
  trackedMonths: Iterable<string>
  /** YYYY-MM-DD, the snapshot's "today". */
  today: string
}

const MONTH_RE = /^\d{4}-\d{2}/

/**
 * The shelf as Progress shows it. Each month is summed once, in the base currency, as the badges
 * sum it (`baseAmount`, `flowsOf`): what it spent, and income less spending. `sealShares` turns a
 * print's twelve into shares of its own heaviest month, and only the shares go on.
 */
export function shelfView(input: ShelfInput): ShelfView {
  const tracked = new Set(input.trackedMonths)
  const shelf = shelfOf(tracked)
  const byMonth = new Map<string, ShelfInput['transactions']>()
  for (const t of input.transactions) {
    if (!MONTH_RE.test(t.date)) continue
    const month = t.date.slice(0, 7)
    const list = byMonth.get(month)
    if (list) list.push(t)
    else byMonth.set(month, [t])
  }
  const money = (month: string): MonthMoney => {
    const flows = flowsOf(byMonth.get(month) ?? [], baseAmount)
    return { spent: flows.spending, kept: savedOf(flows) }
  }
  const view = (w: PrintWindow): PrintView => {
    const shares = sealShares(Array.from({ length: w.months }, (_, i) => money(slotMonth(w, i))))
    return {
      from: w.from,
      months: w.months,
      slots: Array.from({ length: SEAL_SLOTS }, (_, i) => shares[i] ?? null),
    }
  }
  const nowMonth = input.today.slice(0, 7)
  const live = shelf.last !== null && shelf.last >= addMonths(nowMonth, -1)
  const after = shelf.last === null || live ? null : addMonths(shelf.last, 1)
  return {
    prints: shelf.prints.map(view),
    plate: shelf.plate === null ? null : view(shelf.plate),
    live,
    gap: after === null ? null : { month: after, entries: byMonth.get(after)?.length ?? 0 },
    running: tracked.has(nowMonth) ? nowMonth : null,
  }
}
