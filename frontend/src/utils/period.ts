/**
 * period.ts — the single source of truth for the app's "current period".
 *
 * Every page used to reinvent month/year (or from→to) as local signals with its
 * own month-name arrays and start/end-of-month math. This module replaces all of
 * that: one canonical `Period` object with three modes, plus pure helpers to
 * resolve it to a fetch range, format it, step it, and (de)serialize it to the
 * URL hash. No SolidJS in here — see `core/periodStore.ts` for the reactive glue.
 */

export type PeriodMode = 'month' | 'range' | 'year'

export type PeriodPreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'ytd'
  | 'last30'
  | 'last90'
  | 'all'
  | 'custom'

export interface Period {
  mode: PeriodMode
  year: number
  /** 0–11, present for `month` mode. */
  month?: number
  /** ISO `YYYY-MM-DD`, present for `range` mode. */
  from?: string
  to?: string
  /** Which quick-pill produced this period (drives pill highlight); `custom` = hand-picked. */
  preset?: PeriodPreset
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** The trimmed pill set (decision: essentials only; custom range lives in the orbit). */
export interface PeriodPill {
  id: Exclude<PeriodPreset, 'custom'>
  label: string
  short: string
}

export const PERIOD_PILLS: PeriodPill[] = [
  { id: 'thisMonth', label: 'This month', short: 'This mo.' },
  { id: 'lastMonth', label: 'Last month', short: 'Last mo.' },
  { id: 'ytd', label: 'Year to date', short: 'YTD' },
  { id: 'last30', label: 'Last 30 days', short: '30D' },
  { id: 'last90', label: 'Last 90 days', short: '90D' },
  { id: 'all', label: 'All time', short: 'All' },
]

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

/** Local-timezone ISO date (`YYYY-MM-DD`) — avoids the UTC off-by-one from toISOString(). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1)
}

function endOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0)
}

function addDays(d: Date, days: number): Date {
  const n = new Date(d)
  n.setDate(n.getDate() + days)
  return n
}

/** Whole-day inclusive span between two ISO dates. */
function daySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

// ── Construction ─────────────────────────────────────────────────────────────

/** The default focus period: the current calendar month. */
export function defaultPeriod(now: Date = new Date()): Period {
  return { mode: 'month', year: now.getFullYear(), month: now.getMonth() }
}

export function monthPeriod(year: number, month: number): Period {
  // Normalize overflow/underflow (month -1 → Dec of prior year, etc.).
  const d = new Date(year, month, 1)
  return { mode: 'month', year: d.getFullYear(), month: d.getMonth() }
}

export function yearPeriod(year: number): Period {
  return { mode: 'year', year }
}

/** Build a period from a quick-pill. `custom` is not a pill and returns the default. */
export function fromPill(pill: PeriodPreset, now: Date = new Date()): Period {
  const year = now.getFullYear()
  switch (pill) {
    case 'thisMonth':
      return { mode: 'month', year, month: now.getMonth(), preset: 'thisMonth' }
    case 'lastMonth': {
      const d = new Date(year, now.getMonth() - 1, 1)
      return { mode: 'month', year: d.getFullYear(), month: d.getMonth(), preset: 'lastMonth' }
    }
    case 'ytd':
      return { mode: 'range', year, from: `${year}-01-01`, to: isoDate(now), preset: 'ytd' }
    case 'last30':
      return {
        mode: 'range',
        year,
        from: isoDate(addDays(now, -29)),
        to: isoDate(now),
        preset: 'last30',
      }
    case 'last90':
      return {
        mode: 'range',
        year,
        from: isoDate(addDays(now, -89)),
        to: isoDate(now),
        preset: 'last90',
      }
    case 'all':
      return { mode: 'range', year, from: '1970-01-01', to: isoDate(now), preset: 'all' }
    default:
      return defaultPeriod(now)
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** Every mode resolves to an inclusive ISO date range — the one shape fetches need. */
export function toRange(p: Period, now: Date = new Date()): { from: string; to: string } {
  if (p.mode === 'range') {
    return { from: p.from ?? isoDate(now), to: p.to ?? isoDate(now) }
  }
  if (p.mode === 'year') {
    return { from: `${p.year}-01-01`, to: `${p.year}-12-31` }
  }
  const month = p.month ?? now.getMonth()
  return { from: isoDate(startOfMonth(p.year, month)), to: isoDate(endOfMonth(p.year, month)) }
}

/** `YYYY-MM` for the focus month (month mode) or the range's start month. */
export function toYYYYMM(p: Period, now: Date = new Date()): string {
  if (p.mode === 'month') return `${p.year}-${pad2((p.month ?? now.getMonth()) + 1)}`
  const { from } = toRange(p, now)
  return from.slice(0, 7)
}

function formatRange(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  const sameYear = a.getFullYear() === b.getFullYear()
  const left = `${a.getDate()} ${MONTH_NAMES_SHORT[a.getMonth()]}${sameYear ? '' : ` ${a.getFullYear()}`}`
  const right = `${b.getDate()} ${MONTH_NAMES_SHORT[b.getMonth()]} ${b.getFullYear()}`
  return `${left} – ${right}`
}

/** Human label: "July 2026", "2026", "Year to date", "12 Jun – 5 Jul 2026". */
export function label(p: Period, now: Date = new Date()): string {
  if (p.mode === 'month') return `${MONTH_NAMES[p.month ?? now.getMonth()]} ${p.year}`
  if (p.mode === 'year') return `${p.year}`
  // range
  switch (p.preset) {
    case 'ytd':
      return 'Year to date'
    case 'last30':
      return 'Last 30 days'
    case 'last90':
      return 'Last 90 days'
    case 'all':
      return 'All time'
    default:
      return p.from && p.to ? formatRange(p.from, p.to) : 'Custom range'
  }
}

// ── Stepping ─────────────────────────────────────────────────────────────────

/** Step forward/back: month by a month, year by a year, range by its own length. */
export function shift(p: Period, dir: -1 | 1): Period {
  if (p.mode === 'year') return { ...p, year: p.year + dir, preset: undefined }
  if (p.mode === 'month') {
    // Stepping a month drops any pill highlight (it's no longer "this/last month").
    return { ...monthPeriod(p.year, (p.month ?? 0) + dir), preset: undefined }
  }
  // range
  if (p.preset === 'all' || !p.from || !p.to) return p // "all" doesn't step
  const len = daySpan(p.from, p.to)
  const from = new Date(`${p.from}T00:00:00`)
  const to = new Date(`${p.to}T00:00:00`)
  return {
    mode: 'range',
    year: addDays(from, len * dir).getFullYear(),
    from: isoDate(addDays(from, len * dir)),
    to: isoDate(addDays(to, len * dir)),
    preset: 'custom',
  }
}

// ── Comparison ───────────────────────────────────────────────────────────────

export function periodsEqual(a: Period, b: Period): boolean {
  if (a.mode !== b.mode) return false
  if (a.mode === 'month') return a.year === b.year && a.month === b.month
  if (a.mode === 'year') return a.year === b.year
  return a.from === b.from && a.to === b.to
}

// ── Hash (de)serialization ───────────────────────────────────────────────────

const PRESET_NAMES: PeriodPreset[] = ['thisMonth', 'lastMonth', 'ytd', 'last30', 'last90', 'all']

/**
 * Serialize into flat query params for the URL hash:
 *   month  → { period: "2026-07" }
 *   year   → { period: "2026" }
 *   preset → { period: "ytd" }        (any range/month pill)
 *   custom → { from, to }
 */
export function serializePeriod(p: Period): Record<string, string> {
  if (p.preset && p.preset !== 'custom') return { period: p.preset }
  if (p.mode === 'month') return { period: toYYYYMM(p) }
  if (p.mode === 'year') return { period: `${p.year}` }
  if (p.from && p.to) return { from: p.from, to: p.to }
  return {}
}

/** Inverse of serializePeriod; returns null when the params carry no period. */
export function parsePeriod(params: Record<string, string>, now: Date = new Date()): Period | null {
  const raw = params.period
  if (raw) {
    if ((PRESET_NAMES as string[]).includes(raw)) return fromPill(raw as PeriodPreset, now)
    const m = /^(\d{4})-(\d{2})$/.exec(raw)
    if (m) return monthPeriod(Number(m[1]), Number(m[2]) - 1)
    if (/^\d{4}$/.test(raw)) return yearPeriod(Number(raw))
  }
  if (params.from && params.to) {
    return {
      mode: 'range',
      year: Number(params.from.slice(0, 4)),
      from: params.from,
      to: params.to,
      preset: 'custom',
    }
  }
  return null
}
