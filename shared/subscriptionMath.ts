/**
 * What a bill costs a month, whatever it is billed by. Bills store a raw `amount` per billing
 * period plus a `frequency` (the form offers monthly, weekly, biweekly and yearly; imported or API
 * data may hold other strings). A yearly plan is divided by 12, a weekly one multiplied by 52/12,
 * and so on. Unknown or missing frequencies are treated as monthly rather than dropped, so a total
 * never silently under-counts.
 *
 * Shared by the Bills page's subscription total, the subscription scan and the circles'
 * subscription card (shared/guidance/facts.ts `subscriptionsOf`), so all three count alike.
 */

const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;
const DAYS_PER_YEAR = 365;

const PER_MONTH_FACTORS: Record<string, number> = {
  daily: DAYS_PER_YEAR / MONTHS_PER_YEAR,
  weekly: WEEKS_PER_YEAR / MONTHS_PER_YEAR,
  biweekly: WEEKS_PER_YEAR / 2 / MONTHS_PER_YEAR,
  monthly: 1,
  yearly: 1 / MONTHS_PER_YEAR,
  annual: 1 / MONTHS_PER_YEAR,
};

/** Monthly-equivalent cost of one subscription. */
export function monthlyEquivalent(amount: number, frequency?: string | null): number {
  const factor = PER_MONTH_FACTORS[(frequency ?? 'monthly').toLowerCase()] ?? 1;
  return amount * factor;
}
