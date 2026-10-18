/**
 * What both scans of a person's charges read them by: merchant text normalised, days, cadences,
 * and the amount a run of charges keeps to. The subscription scan (subscriptionDetection.ts) names
 * what it finds from the catalogue and the brand registry; the recurring-payment finder
 * (recurringPayments.ts) finds what has no name there. Pure, no signals and no fetching.
 */

export type DetectedFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeMerchantText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Bucket a median day-gap into a bill frequency; null = no clear cadence. */
export function cadenceFromGapDays(gap: number): DetectedFrequency | null {
  if (gap >= 5 && gap <= 9) return 'weekly'
  if (gap >= 11 && gap <= 17) return 'biweekly'
  if (gap >= 24 && gap <= 38) return 'monthly'
  if (gap >= 330 && gap <= 400) return 'yearly'
  return null
}

export function parseDay(date: string): number {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime()
}

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addPeriod(dateMs: number, frequency: DetectedFrequency): number {
  if (frequency === 'weekly') return dateMs + 7 * DAY_MS
  if (frequency === 'biweekly') return dateMs + 14 * DAY_MS
  const d = new Date(dateMs)
  if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
  else d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.getTime()
}

export interface GroupTxn {
  amount: number
  dateMs: number
  date: string
  currency: string | null
  raw: string
}

const sameAmount = (a: number, ref: number) => Math.abs(a - ref) <= Math.max(0.5, ref * 0.05)

/**
 * The recurring-amount evidence within a group: cluster charges by amount and
 * pick the cluster that looks like the plan — the one holding the most recent
 * charge when it repeats, else the largest repeating cluster. Returns null when
 * no amount repeats (one-off shopping, or a single charge). This keeps a real
 * "AMAZON PRIME 8.99" cadence detectable amid unrelated "AMAZON.DE" orders that
 * share the group, and follows price changes once the new price has recurred.
 */
export function pickAmountCluster<T extends GroupTxn>(txns: T[]): T[] | null {
  if (txns.length < 2) return null
  const byAmount = [...txns].sort((a, b) => a.amount - b.amount)
  const clusters: T[][] = []
  for (const txn of byAmount) {
    const last = clusters[clusters.length - 1]
    if (last && sameAmount(txn.amount, median(last.map((t) => t.amount)))) last.push(txn)
    else clusters.push([txn])
  }
  const repeating = clusters.filter((c) => c.length >= 2)
  if (repeating.length === 0) return null
  const latestMs = Math.max(...txns.map((t) => t.dateMs))
  const withLatest = repeating.find((c) => c.some((t) => t.dateMs === latestMs))
  const best =
    withLatest ??
    repeating.sort(
      (a, b) =>
        b.length - a.length ||
        Math.max(...b.map((t) => t.dateMs)) - Math.max(...a.map((t) => t.dateMs))
    )[0]
  return [...best].sort((a, b) => a.dateMs - b.dateMs)
}

/** The day-gaps between consecutive charges (sorted by day), skipping same-day and next-day pairs. */
export function gapDays(txns: readonly GroupTxn[]): number[] {
  const gaps: number[] = []
  for (let i = 1; i < txns.length; i++) {
    const gap = (txns[i].dateMs - txns[i - 1].dateMs) / DAY_MS
    if (gap >= 2) gaps.push(gap)
  }
  return gaps
}

/** The next charge after `lastMs` at `frequency`, rolled forward so it is never before today. */
export function nextDueDate(lastMs: number, frequency: DetectedFrequency, todayMs: number): string {
  let dueMs = addPeriod(lastMs, frequency)
  while (dueMs < todayMs) dueMs = addPeriod(dueMs, frequency)
  return toIsoDate(dueMs)
}

/** The currency most of the charges are in, or null when none says. */
export function commonCurrency(txns: readonly GroupTxn[]): string | null {
  const counts = new Map<string, number>()
  for (const t of txns) {
    if (t.currency) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
