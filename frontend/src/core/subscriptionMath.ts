/**
 * Frequency math for subscriptions (Bills → Subscriptions view). The monthly equivalent lives in
 * shared/subscriptionMath.ts, which the circles' subscription card reads too; the per-period
 * suffix a card shows is the screen's own.
 */
export { monthlyEquivalent } from '../../../shared/subscriptionMath'

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
