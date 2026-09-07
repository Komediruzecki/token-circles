/** Month arithmetic on 'YYYY-MM' strings. Pure; the input is sliced, never parsed as a Date. */

/** 'YYYY-MM' of an ISO date or datetime string. */
export const monthOf = (date: string): string => date.slice(0, 7)

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Consecutive runs of months, in order. Input may be unsorted and repeat months. */
export function runs(months: Iterable<string>): Array<{ start: string; length: number }> {
  const sorted = [...new Set(months)].sort()
  const out: Array<{ start: string; length: number }> = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && addMonths(last.start, last.length) === m) last.length++
    else out.push({ start: m, length: 1 })
  }
  return out
}

/** The month in which a run of consecutive months first reached `n`; null if none did. */
export function monthReaching(months: Iterable<string>, n: number): string | null {
  for (const run of runs(months)) if (run.length >= n) return addMonths(run.start, n - 1)
  return null
}

/**
 * Consecutive months ending in `nowMonth`, or in the month before it when the current one is
 * not (yet) in the set: the current month is allowed to be in progress.
 */
export function currentStreak(months: Set<string>, nowMonth: string): number {
  let m = months.has(nowMonth) ? nowMonth : addMonths(nowMonth, -1)
  let n = 0
  while (months.has(m)) {
    n++
    m = addMonths(m, -1)
  }
  return n
}
