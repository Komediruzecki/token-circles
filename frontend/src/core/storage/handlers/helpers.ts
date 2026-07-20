/**
 * Shared helpers for local API handlers.
 */
import { getDB, IndexedDBAdapter } from '../idb'

// Singleton: do NOT create additional IndexedDBAdapter instances.
// Multiple instances cause in-memory state divergence (caches, locks).
export const adapter = new IndexedDBAdapter()

export const json = (data: unknown, status = 200, pretty = false): Response => {
  const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const ok = (data: Record<string, unknown> = {}): Response => json({ ok: true, ...data })

export const notFound = (what: string): Response => json({ error: `${what} not found` }, 404)

export function idParam(params: Record<string, string>, key = 'p1'): number {
  return parseInt(params[key], 10)
}

/**
 * Resolve the requested target profile ids from a request's headers, per-request.
 *
 * Reads `X-Profile-Ids` (a JSON array — used for multi-profile household exports) first,
 * then falls back to `X-Profile-Id` (a single id, or a comma-separated list). Returns
 * `undefined` when no profile header is present so callers can fall back to the active
 * profile.
 *
 * This is the ONLY per-request source of a request's target profile in the local router:
 * there is no shared mutable profile state on the adapter, so concurrent requests can
 * never clobber one another's target (which previously let a targeted delete land on the
 * wrong profile).
 */
export function targetProfileIdsFromHeaders(headers?: HeadersInit): number[] | undefined {
  const read = (name: string): string | null => {
    if (!headers) return null
    if (headers instanceof Headers) return headers.get(name)
    if (Array.isArray(headers)) {
      const pair = headers.find(([k]) => k.toLowerCase() === name)
      return pair ? pair[1] : null
    }
    const rec = headers as Record<string, string>
    const key = Object.keys(rec).find((k) => k.toLowerCase() === name)
    return key ? rec[key] : null
  }
  const toIds = (raw: string): number[] =>
    raw
      .split(',')
      .map((x) => parseInt(x, 10))
      .filter((x) => !isNaN(x))

  const idsHeader = read('x-profile-ids')
  if (idsHeader) {
    try {
      const parsed = JSON.parse(idsHeader) as unknown
      if (Array.isArray(parsed)) {
        const ids = parsed.map((x) => parseInt(String(x), 10)).filter((x) => !isNaN(x))
        if (ids.length > 0) return ids
      }
    } catch {
      const ids = toIds(idsHeader)
      if (ids.length > 0) return ids
    }
  }
  const idHeader = read('x-profile-id')
  if (idHeader) {
    const ids = toIds(idHeader)
    if (ids.length > 0) return ids
  }
  return undefined
}

// ── Date / amount helpers ─────────────────────────────────────────────────────

export function getAmount(t: Record<string, unknown>): number {
  return (t.amount_local as number) ?? (t.amount as number) ?? 0
}

export function monthStart(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function monthEnd(y: number, m: number): string {
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

export function nextMonth(y: number, m: number): { year: number; month: number } {
  if (m === 12) return { year: y + 1, month: 1 }
  return { year: y, month: m + 1 }
}

export function prevMonth(y: number, m: number): { year: number; month: number } {
  if (m === 1) return { year: y - 1, month: 12 }
  return { year: y, month: m - 1 }
}

export function endOfNextMonth(startDate: string): string {
  const d = new Date(startDate)
  const origDay = d.getDate()
  const targetMonth = d.getMonth() + 1
  d.setMonth(targetMonth, 1)
  // If adding one month overflowed the day (e.g. Jan 31 -> Mar 3), clamp to last
  // valid day of the target month. Otherwise use the original day.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(origDay, lastDay))
  return d.toISOString().slice(0, 10)
}

// ── Shared data helpers ───────────────────────────────────────────────────────

/** Fetch all records from a store across current profile IDs */
export async function getAllForProfiles(storeName: string): Promise<Record<string, unknown>[]> {
  const db = await getDB()
  const pids = adapter.getCurrentProfileIds()
  const all: Record<string, unknown>[] = []
  for (const pid of pids) {
    const rows = await db.getAllFromIndex(storeName, 'by_profile', pid)
    all.push(...rows)
  }
  return all
}

/** Build a category ID → category lookup map for the current profile */
export async function buildCategoryMap(): Promise<Map<number, Record<string, unknown>>> {
  const db = await getDB()
  const pid = await adapter.getCurrentProfileId()
  const cats = await db.getAllFromIndex('categories', 'by_profile', pid)
  return new Map((cats as Record<string, unknown>[]).map((c) => [c.id as number, c]))
}

/** Best-effort MIME type from a filename extension */
export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    pdf: 'application/pdf',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return ext && mimeMap[ext] ? mimeMap[ext] : 'application/octet-stream'
}
