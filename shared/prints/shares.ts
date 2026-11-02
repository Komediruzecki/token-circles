/**
 * From a month's money to a seal's shares: the one place amounts meet the print, and the last.
 *
 * Each month comes in as what it spent and what it kept (income less spending, shared/guidance/
 * flows.ts), in whatever currency the caller sums in. It goes out as two whole numbers on the
 * seal's own scale, which say how the months compare and nothing about how much any of them was:
 *
 * - `spent`: 0 to 100, as a share of the heaviest month in the same set.
 * - `kept`: -100 to 100, as a share of the most any month in the set kept or overspent. A month
 *   that spent more than came in stays below zero however little it overspent, so its stretch of
 *   the band is always copper; one that kept under half a share rounds to 0, "about even".
 *
 * The scale is the set's own, so a petal's length moves when a heavier month joins the seal.
 */
import type { SealMonth } from './seal';

/** A month as summed from its entries: what it spent, and income less spending. */
export interface MonthMoney {
  spent: number;
  kept: number;
}

export function sealShares(months: ReadonlyArray<MonthMoney | null>): Array<SealMonth | null> {
  let heaviest = 0;
  let widest = 0;
  for (const m of months) {
    if (m === null) continue;
    heaviest = Math.max(heaviest, Math.max(0, m.spent));
    widest = Math.max(widest, Math.abs(m.kept));
  }
  return months.map((m) => {
    if (m === null) return null;
    const spent = heaviest > 0 ? Math.round((100 * Math.max(0, m.spent)) / heaviest) : 0;
    const share = widest > 0 ? (100 * m.kept) / widest : 0;
    const kept = m.kept < 0 ? Math.min(-1, Math.round(share)) : Math.round(share);
    // `+ 0` turns a -0 from Math.round into 0, so a share is never written as -0.
    return { spent: spent + 0, kept: kept + 0 };
  });
}
