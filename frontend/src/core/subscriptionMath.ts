/**
 * Frequency math for subscriptions (Bills → Subscriptions view).
 *
 * Bills store a raw `amount` per billing period plus a `frequency` (the UI offers
 * monthly/weekly/biweekly/yearly; imported or API data may hold other strings). The
 * summary card advertises a MONTHLY total, so each period must be normalized to its
 * monthly equivalent — a yearly plan divided by 12, a weekly one multiplied by 52/12,
 * and so on. Unknown or missing frequencies are treated as monthly rather than dropped,
 * so the total never silently under-counts.
 */

const MONTHS_PER_YEAR = 12
const WEEKS_PER_YEAR = 52
const DAYS_PER_YEAR = 365

const PER_MONTH_FACTORS: Record<string, number> = {
  daily: DAYS_PER_YEAR / MONTHS_PER_YEAR,
  weekly: WEEKS_PER_YEAR / MONTHS_PER_YEAR,
  biweekly: WEEKS_PER_YEAR / 2 / MONTHS_PER_YEAR,
  monthly: 1,
  yearly: 1 / MONTHS_PER_YEAR,
  annual: 1 / MONTHS_PER_YEAR,
}

/** Monthly-equivalent cost of one subscription. */
export function monthlyEquivalent(amount: number, frequency?: string | null): number {
  const factor = PER_MONTH_FACTORS[(frequency ?? 'monthly').toLowerCase()] ?? 1
  return amount * factor
}

const SUFFIXES: Record<string, string> = {
  daily: 'day',
  weekly: 'wk',
  biweekly: 'biwk',
  monthly: 'mo',
  yearly: 'yr',
  annual: 'yr',
}

/** Compact per-period suffix for a subscription card, e.g. the "mo" in "€9.99/mo". */
export function frequencySuffix(frequency?: string | null): string {
  return SUFFIXES[(frequency ?? 'monthly').toLowerCase()] ?? 'mo'
}
